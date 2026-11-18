/**
 * Filter Presets Module - Service Layer
 *
 * Business logic for saving and managing filter presets.
 * Allows users to save frequently used filter combinations.
 *
 * @module modules/filter-presets/filter-presets.service
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../../db";
import { filterPresets, type FilterPreset } from "@shared/schema";
import { NotFoundError, ConflictError } from "../../core/errors";
import { logger } from "../../utils/logger";
import {
  withTransaction,
  type TransactionType,
} from "../../utils/withTransaction";
import { isPostgresError } from "../../utils/postgresError";

type PresetQueryRunner = typeof db | TransactionType;

const DEFAULT_INDEX_NAME = "filter_presets_one_default_per_scope";
const FILTER_PRESET_DEFAULT_LOCK_NAMESPACE = 0x66707273; // "fprs"

function isDefaultScopeUniqueViolation(error: unknown): boolean {
  return isPostgresError(error, "23505", DEFAULT_INDEX_NAME);
}

function translateDefaultScopeError(error: unknown): never {
  if (isDefaultScopeUniqueViolation(error)) {
    throw new ConflictError(
      "Default filter preset was changed by another request. Please retry.",
    );
  }
  throw error;
}

const NAME_INDEX_NAME = "filter_presets_name_unique_per_scope";

function isNameUniqueViolation(error: unknown): boolean {
  return isPostgresError(error, "23505", NAME_INDEX_NAME);
}

// The read-then-insert name check above the inserts gives a friendly error on
// the common path; the unique index is the backstop for concurrent writers,
// and this translates its 23505 into the same 409 contract.
function translatePresetWriteError(error: unknown, name?: string): never {
  if (isNameUniqueViolation(error)) {
    throw new ConflictError(
      name
        ? `A preset named "${name}" already exists in this context`
        : "A preset with this name already exists in this context",
    );
  }
  translateDefaultScopeError(error);
}

export interface CreateFilterPresetInput {
  householdId: string;
  userId: string;
  name: string;
  context: "transactions" | "reports" | "budget" | "cashflow";
  filters: Record<string, unknown>;
  isDefault?: boolean;
  isShared?: boolean;
}

export interface UpdateFilterPresetInput {
  name?: string;
  filters?: Record<string, unknown>;
  isDefault?: boolean;
  isShared?: boolean;
}

export class FilterPresetsService {
  private async lockDefaultScope(
    tx: TransactionType,
    householdId: string,
    userId: string,
    context: string,
  ): Promise<void> {
    const lockKey = `${householdId}:${userId}:${context}`;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${FILTER_PRESET_DEFAULT_LOCK_NAMESPACE}::int4, hashtext(${lockKey}))`,
    );
  }

  private async clearDefaultScope(
    queryRunner: PresetQueryRunner,
    householdId: string,
    userId: string,
    context: string,
  ): Promise<void> {
    await queryRunner
      .update(filterPresets)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(filterPresets.householdId, householdId),
          eq(filterPresets.userId, userId),
          eq(filterPresets.context, context),
          eq(filterPresets.isDefault, true),
        ),
      );
  }

  /**
   * List all presets for a user in a specific context
   */
  async listPresets(
    householdId: string,
    userId: string,
    context?: string,
  ): Promise<FilterPreset[]> {
    const conditions = [eq(filterPresets.householdId, householdId)];

    // Include user's own presets and shared household presets
    // For simplicity, we'll filter shared presets in memory
    if (context) {
      conditions.push(eq(filterPresets.context, context));
    }

    const results = await db
      .select()
      .from(filterPresets)
      .where(and(...conditions))
      .orderBy(desc(filterPresets.createdAt));

    // Filter to show user's own presets and shared presets from others
    return results.filter(
      (preset) => preset.userId === userId || preset.isShared,
    );
  }

  /**
   * Get a specific preset by ID
   */
  async getPresetById(
    id: string,
    householdId: string,
    userId: string,
  ): Promise<FilterPreset> {
    const [preset] = await db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.id, id),
          eq(filterPresets.householdId, householdId),
        ),
      );

    if (!preset) {
      throw new NotFoundError("Filter preset not found");
    }

    // Check access - user can see their own or shared presets
    if (preset.userId !== userId && !preset.isShared) {
      throw new NotFoundError("Filter preset not found");
    }

    return preset;
  }

  /**
   * Create a new filter preset
   */
  async createPreset(data: CreateFilterPresetInput): Promise<FilterPreset> {
    const { householdId, userId, name, context, filters, isDefault, isShared } =
      data;

    const createWithRunner = async (
      queryRunner: PresetQueryRunner,
    ): Promise<FilterPreset> => {
      // Check for duplicate name in same context for this user
      const existing = await queryRunner
        .select()
        .from(filterPresets)
        .where(
          and(
            eq(filterPresets.householdId, householdId),
            eq(filterPresets.userId, userId),
            eq(filterPresets.context, context),
            eq(filterPresets.name, name),
          ),
        );

      if (existing.length > 0) {
        throw new ConflictError(
          `A preset named "${name}" already exists in this context`,
        );
      }

      if (isDefault) {
        await this.clearDefaultScope(queryRunner, householdId, userId, context);
      }

      const [preset] = await queryRunner
        .insert(filterPresets)
        .values({
          householdId,
          userId,
          name,
          context,
          filters,
          isDefault: isDefault ?? false,
          isShared: isShared ?? false,
        })
        .returning();

      logger.info("Created filter preset", {
        presetId: preset.id,
        householdId,
        userId,
        context,
        name,
      });

      return preset;
    };

    try {
      if (!isDefault) {
        return await createWithRunner(db);
      }

      return await withTransaction(async (tx) => {
        await this.lockDefaultScope(tx, householdId, userId, context);
        return createWithRunner(tx);
      });
    } catch (error) {
      translatePresetWriteError(error, name);
    }
  }

  /**
   * Update an existing preset
   */
  async updatePreset(
    id: string,
    householdId: string,
    userId: string,
    data: UpdateFilterPresetInput,
  ): Promise<FilterPreset> {
    try {
      return await withTransaction(async (tx) => {
        // Verify preset exists and user owns it
        const [existing] = await tx
          .select()
          .from(filterPresets)
          .where(
            and(
              eq(filterPresets.id, id),
              eq(filterPresets.householdId, householdId),
            ),
          );

        if (!existing) {
          throw new NotFoundError("Filter preset not found");
        }

        if (existing.userId !== userId) {
          throw new NotFoundError("Filter preset not found"); // Don't reveal it exists
        }

        if (data.isDefault === true) {
          await this.lockDefaultScope(tx, householdId, userId, existing.context);
        }

        // Check for duplicate name if name is being changed
        if (data.name && data.name !== existing.name) {
          const duplicate = await tx
            .select()
            .from(filterPresets)
            .where(
              and(
                eq(filterPresets.householdId, householdId),
                eq(filterPresets.userId, userId),
                eq(filterPresets.context, existing.context),
                eq(filterPresets.name, data.name),
              ),
            );

          if (duplicate.length > 0) {
            throw new ConflictError(
              `A preset named "${data.name}" already exists in this context`,
            );
          }
        }

        // If setting as default, clear and set inside the same transaction.
        if (data.isDefault === true) {
          await this.clearDefaultScope(tx, householdId, userId, existing.context);
        }

        const [updated] = await tx
          .update(filterPresets)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(eq(filterPresets.id, id))
          .returning();

        logger.info("Updated filter preset", { presetId: id, householdId });

        return updated;
      });
    } catch (error) {
      translatePresetWriteError(error, data.name);
    }
  }

  /**
   * Delete a preset
   */
  async deletePreset(
    id: string,
    householdId: string,
    userId: string,
  ): Promise<void> {
    // Verify preset exists and user owns it
    const [existing] = await db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.id, id),
          eq(filterPresets.householdId, householdId),
        ),
      );

    if (!existing) {
      throw new NotFoundError("Filter preset not found");
    }

    if (existing.userId !== userId) {
      throw new NotFoundError("Filter preset not found");
    }

    await db.delete(filterPresets).where(eq(filterPresets.id, id));

    logger.info("Deleted filter preset", { presetId: id, householdId });
  }

  /**
   * Get the default preset for a user in a specific context
   */
  async getDefaultPreset(
    householdId: string,
    userId: string,
    context: string,
  ): Promise<FilterPreset | null> {
    const [preset] = await db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.householdId, householdId),
          eq(filterPresets.userId, userId),
          eq(filterPresets.context, context),
          eq(filterPresets.isDefault, true),
        ),
      );

    return preset ?? null;
  }
}

export const filterPresetsService = new FilterPresetsService();
