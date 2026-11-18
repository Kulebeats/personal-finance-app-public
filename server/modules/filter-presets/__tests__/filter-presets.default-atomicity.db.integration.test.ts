/**
 * Filter preset default atomicity - REAL DB.
 *
 * Proves the production invariant for saved filter defaults:
 * one user may have at most one default preset per household/context. The
 * service should serialize contended "make default" requests and the database
 * unique index remains the final backstop.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "../../../db";
import { filterPresetsService } from "../filter-presets.service";
import {
  filterPresets,
  householdMembers,
  households,
  users,
} from "@shared/schema";
import {
  createTestHousehold,
  createTestUser,
} from "../../../__tests__/fixtures";
import { getPostgresError } from "../../../utils/postgresError";

const DEFAULT_INDEX_NAME = "filter_presets_one_default_per_scope";

describe("Filter preset default atomicity", () => {
  const createdHouseholdIds: string[] = [];
  const createdUserIds: string[] = [];
  let createdDefaultIndex = false;

  async function ensureDefaultIndex() {
    const existing = await db.execute(sql`
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ${DEFAULT_INDEX_NAME}
    `);

    if (existing.rows.length > 0) return;

    await db.execute(sql`
      UPDATE filter_presets
      SET is_default = false, updated_at = now()
      WHERE id IN (
        SELECT id
        FROM (
          SELECT
            id,
            row_number() OVER (
              PARTITION BY household_id, user_id, context
              ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
            ) AS rn
          FROM filter_presets
          WHERE is_default = true
        ) ranked
        WHERE ranked.rn > 1
      )
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX ${sql.identifier(DEFAULT_INDEX_NAME)}
      ON filter_presets (household_id, user_id, context)
      WHERE is_default = true
    `);
    createdDefaultIndex = true;
  }

  async function seedScope(label: string) {
    const suffix = `${label}-${randomUUID().slice(0, 8)}`;
    const user = createTestUser({
      email: `filter-default-${suffix}@example.com`,
      username: `filter_default_${suffix.replace(/-/g, "_")}`,
    });
    const household = createTestHousehold(user.id, {
      name: `Filter Default ${suffix}`,
    });

    await db.insert(households).values({
      id: household.id,
      name: household.name,
      currency: household.currency,
    });
    await db.insert(users).values({
      id: user.id,
      email: user.email,
      username: user.username,
      passwordHash: user.passwordHash,
      fullName: user.fullName,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId: household.id,
      userId: user.id,
      role: "owner",
      joinedAt: new Date(),
    });

    createdHouseholdIds.push(household.id);
    createdUserIds.push(user.id);

    return { householdId: household.id, userId: user.id };
  }

  async function defaultPresets(householdId: string, userId: string) {
    return db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.householdId, householdId),
          eq(filterPresets.userId, userId),
          eq(filterPresets.context, "transactions"),
          eq(filterPresets.isDefault, true),
        ),
      );
  }

  beforeAll(async () => {
    await ensureDefaultIndex();
  });

  afterAll(async () => {
    try {
      for (const householdId of createdHouseholdIds) {
        await db
          .delete(filterPresets)
          .where(eq(filterPresets.householdId, householdId));
        await db
          .delete(householdMembers)
          .where(eq(householdMembers.householdId, householdId));
        await db.delete(households).where(eq(households.id, householdId));
      }
      for (const userId of createdUserIds) {
        await db.delete(users).where(eq(users.id, userId));
      }
      if (createdDefaultIndex) {
        await db.execute(
          sql`DROP INDEX IF EXISTS ${sql.identifier(DEFAULT_INDEX_NAME)}`,
        );
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("filter preset default atomicity cleanup error", error);
    }
  });

  it("database rejects two default presets for the same household/user/context", async () => {
    const { householdId, userId } = await seedScope("db");

    await db.insert(filterPresets).values({
      householdId,
      userId,
      name: "Primary",
      context: "transactions",
      filters: { type: "expense" },
      isDefault: true,
      isShared: false,
    });

    let duplicateError: unknown;
    try {
      await db.insert(filterPresets).values({
        householdId,
        userId,
        name: "Duplicate Default",
        context: "transactions",
        filters: { type: "income" },
        isDefault: true,
        isShared: false,
      });
    } catch (error) {
      duplicateError = error;
    }

    expect(getPostgresError(duplicateError)).toMatchObject({
      code: "23505",
      constraint: DEFAULT_INDEX_NAME,
    });

    await expect(defaultPresets(householdId, userId)).resolves.toHaveLength(1);
  });

  it("serializes concurrent default creates and leaves exactly one default", async () => {
    const { householdId, userId } = await seedScope("create-race");

    const results = await Promise.allSettled([
      filterPresetsService.createPreset({
        householdId,
        userId,
        name: "Race A",
        context: "transactions",
        filters: { category: "food" },
        isDefault: true,
      }),
      filterPresetsService.createPreset({
        householdId,
        userId,
        name: "Race B",
        context: "transactions",
        filters: { category: "transport" },
        isDefault: true,
      }),
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);

    const allPresets = await db
      .select()
      .from(filterPresets)
      .where(
        and(
          eq(filterPresets.householdId, householdId),
          eq(filterPresets.userId, userId),
          eq(filterPresets.context, "transactions"),
        ),
      );
    expect(allPresets).toHaveLength(2);
    expect(allPresets.filter((preset) => preset.isDefault)).toHaveLength(1);
  });

  it("serializes concurrent default updates and leaves exactly one default", async () => {
    const { householdId, userId } = await seedScope("update-race");
    const [presetA, presetB] = await db
      .insert(filterPresets)
      .values([
        {
          householdId,
          userId,
          name: "Update Race A",
          context: "transactions",
          filters: { account: "a" },
          isDefault: false,
          isShared: false,
        },
        {
          householdId,
          userId,
          name: "Update Race B",
          context: "transactions",
          filters: { account: "b" },
          isDefault: false,
          isShared: false,
        },
      ])
      .returning();

    const results = await Promise.allSettled([
      filterPresetsService.updatePreset(presetA.id, householdId, userId, {
        isDefault: true,
      }),
      filterPresetsService.updatePreset(presetB.id, householdId, userId, {
        isDefault: true,
      }),
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    await expect(defaultPresets(householdId, userId)).resolves.toHaveLength(1);
  });
});
