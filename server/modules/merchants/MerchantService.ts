/**
 * Merchant Service
 *
 * Business logic for merchant management.
 *
 * @module services/MerchantService
 */

import { db } from "../../db";
import {
  merchantAliases,
  merchantMergeHistory,
  merchants,
  transactions,
} from "@shared/schema";
import {
  eq,
  and,
  ilike,
  desc,
  isNull,
  or,
  sql,
  count,
  inArray,
} from "drizzle-orm";
import { NotFoundError, ConflictError } from "../../core/errors";
import { withTransaction } from "../../utils/withTransaction";

export interface CreateMerchantInput {
  name: string;
  logoUrl?: string | null;
  category?: string | null;
  defaultCategoryId?: string | null;
  notes?: string | null;
  isActive?: boolean;
  iconType?: string | null;
  customIcon?: string | null;
}

export interface UpdateMerchantInput {
  name?: string;
  logoUrl?: string | null;
  category?: string | null;
  defaultCategoryId?: string | null;
  notes?: string | null;
  isActive?: boolean;
  iconType?: string | null;
  customIcon?: string | null;
}

export interface ListMerchantsOptions {
  search?: string;
  includeHidden?: boolean;
}

export interface MergeResult {
  merged: boolean;
  targetId: string;
  mergeHistoryId: string;
  mergedTransactionCount: number;
}

export interface UndoMergeResult {
  restoredMerchant: typeof merchants.$inferSelect;
  target: typeof merchants.$inferSelect;
}

const DEFAULT_ZAMBIAN_MERCHANTS: Array<
  Pick<CreateMerchantInput, "name" | "category" | "iconType">
> = [
  { name: "Shoprite", category: "Retail & Shopping", iconType: "logo" },
  { name: "Pick n Pay", category: "Retail & Shopping", iconType: "logo" },
  { name: "Game Stores", category: "Retail & Shopping", iconType: "logo" },
  { name: "Airtel Money", category: "Telecommunications", iconType: "logo" },
  { name: "MTN Mobile Money", category: "Telecommunications", iconType: "logo" },
  { name: "Zamtel", category: "Telecommunications", iconType: "logo" },
  { name: "ZESCO", category: "Utilities", iconType: "logo" },
  { name: "NWSC", category: "Utilities", iconType: "logo" },
  { name: "Zanaco", category: "Banking & Finance", iconType: "logo" },
  { name: "FNB Zambia", category: "Banking & Finance", iconType: "logo" },
  { name: "TotalEnergies", category: "Transportation", iconType: "logo" },
  { name: "Puma Energy", category: "Transportation", iconType: "logo" },
];

function normalizeMerchantName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function readMergedTransactionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((id): id is string => typeof id === "string");
}

class MerchantService {
  async list(householdId: string, options: ListMerchantsOptions = {}) {
    const conditions = [eq(merchants.householdId, householdId)];

    if (!options.includeHidden) {
      conditions.push(
        or(eq(merchants.isActive, true), isNull(merchants.isActive))!,
      );
    }

    if (options.search) {
      conditions.push(ilike(merchants.name, `%${options.search}%`));
    }

    return await db
      .select()
      .from(merchants)
      .where(and(...conditions))
      .orderBy(desc(merchants.transactionCount));
  }

  async getById(id: string, householdId: string) {
    const [merchant] = await db
      .select()
      .from(merchants)
      .where(and(eq(merchants.id, id), eq(merchants.householdId, householdId)))
      .limit(1);

    if (!merchant) {
      throw new NotFoundError("Merchant not found");
    }

    return merchant;
  }

  async getDetails(id: string, householdId: string) {
    const merchant = await this.getById(id, householdId);
    const aliases = await db
      .select()
      .from(merchantAliases)
      .where(eq(merchantAliases.merchantId, id));

    return { merchant, aliases };
  }

  async findDuplicates(householdId: string) {
    const merchantList = await this.list(householdId, { includeHidden: true });
    const groups = new Map<string, typeof merchantList>();

    for (const merchant of merchantList) {
      const key = normalizeMerchantName(merchant.name);
      if (!key) continue;

      const group = groups.get(key) || [];
      group.push(merchant);
      groups.set(key, group);
    }

    return [...groups.values()]
      .filter((group) => group.length > 1)
      .map((group) => ({ merchants: group, similarity: 100 }));
  }

  async autocomplete(householdId: string, query: string, limit = 25) {
    const merchantList = await this.list(householdId, { search: query });
    return merchantList.slice(0, limit);
  }

  async getMergeHistory(householdId: string) {
    return await db
      .select({
        id: merchantMergeHistory.id,
        sourceMerchantId: merchantMergeHistory.sourceMerchantId,
        sourceMerchantName: merchantMergeHistory.sourceMerchantName,
        targetMerchantId: merchantMergeHistory.targetMerchantId,
        targetMerchantName: merchants.name,
        mergedAt: merchantMergeHistory.mergedAt,
        canUndo: merchantMergeHistory.canUndo,
        undoExpiresAt: merchantMergeHistory.undoExpiresAt,
      })
      .from(merchantMergeHistory)
      .innerJoin(merchants, eq(merchantMergeHistory.targetMerchantId, merchants.id))
      .where(eq(merchants.householdId, householdId))
      .orderBy(desc(merchantMergeHistory.mergedAt))
      .limit(20);
  }

  async seedDefaults(householdId: string) {
    const existing = await this.list(householdId, { includeHidden: true });
    const existingNames = new Set(
      existing.map((merchant) => normalizeMerchantName(merchant.name)),
    );

    const toCreate = DEFAULT_ZAMBIAN_MERCHANTS.filter(
      (merchant) => !existingNames.has(normalizeMerchantName(merchant.name)),
    );

    if (toCreate.length === 0) {
      return { inserted: 0, skipped: DEFAULT_ZAMBIAN_MERCHANTS.length, merchants: [] };
    }

    const created = await db
      .insert(merchants)
      .values(
        toCreate.map((merchant) => ({
          householdId,
          name: merchant.name,
          category: merchant.category ?? null,
          iconType: merchant.iconType ?? "logo",
          isActive: true,
        })),
      )
      .returning();

    return {
      inserted: created.length,
      skipped: DEFAULT_ZAMBIAN_MERCHANTS.length - created.length,
      merchants: created,
    };
  }

  async create(householdId: string, data: CreateMerchantInput) {
    // Check for existing merchant with same name
    const [existing] = await db
      .select()
      .from(merchants)
      .where(
        and(
          eq(merchants.householdId, householdId),
          sql`LOWER(${merchants.name}) = LOWER(${data.name})`,
        ),
      )
      .limit(1);

    if (existing) {
      throw new ConflictError("A merchant with this name already exists");
    }

    // Validate defaultCategoryId belongs to household (if provided)
    if (data.defaultCategoryId) {
      const { categoryRepository } = await import("../../repositories/CategoryRepository");
      const category = await categoryRepository.findByIdAndHousehold(
        data.defaultCategoryId,
        householdId,
      );
      if (!category) {
        throw new NotFoundError("Category not found or does not belong to household");
      }
    }

    const [created] = await db
      .insert(merchants)
      .values({
        householdId,
        name: data.name,
        logoUrl: data.logoUrl ?? null,
        category: data.category ?? null,
        defaultCategoryId: data.defaultCategoryId ?? null,
        notes: data.notes ?? null,
        isActive: data.isActive ?? true,
        iconType: data.iconType ?? "logo",
        customIcon: data.customIcon ?? null,
      })
      .returning();

    return created;
  }

  async update(id: string, householdId: string, data: UpdateMerchantInput) {
    // If name is being updated, check for duplicates
    if (data.name) {
      const [existing] = await db
        .select()
        .from(merchants)
        .where(
          and(
            eq(merchants.householdId, householdId),
            sql`LOWER(${merchants.name}) = LOWER(${data.name})`,
            sql`${merchants.id} != ${id}`, // Exclude the current merchant
          ),
        )
        .limit(1);

      if (existing) {
        throw new ConflictError("A merchant with this name already exists");
      }
    }

    // Validate defaultCategoryId belongs to household (if provided)
    if (data.defaultCategoryId) {
      const { categoryRepository } = await import("../../repositories/CategoryRepository");
      const category = await categoryRepository.findByIdAndHousehold(
        data.defaultCategoryId,
        householdId,
      );
      if (!category) {
        throw new NotFoundError("Category not found or does not belong to household");
      }
    }

    const [updated] = await db
      .update(merchants)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(merchants.id, id), eq(merchants.householdId, householdId)))
      .returning();

    if (!updated) {
      throw new NotFoundError("Merchant not found");
    }

    return updated;
  }

  async delete(id: string, householdId: string) {
    // Check if merchant has transactions
    const [result] = await db
      .select({ count: count() })
      .from(transactions)
      .where(
        and(
          eq(transactions.merchantId, id),
          eq(transactions.householdId, householdId),
        ),
      );

    if (result && result.count > 0) {
      throw new ConflictError(
        "Cannot delete merchant with associated transactions",
      );
    }

    // Soft delete by setting isActive = false
    const [updated] = await db
      .update(merchants)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(merchants.id, id), eq(merchants.householdId, householdId)))
      .returning();

    if (!updated) {
      throw new NotFoundError("Merchant not found");
    }

    return updated;
  }

  async merge(
    householdId: string,
    sourceId: string,
    targetId: string,
    options: { mergedBy?: string | null } = {},
  ): Promise<MergeResult> {
    if (sourceId === targetId) {
      throw new ConflictError("Cannot merge a merchant into itself");
    }

    // Get both merchants
    const [source] = await db
      .select()
      .from(merchants)
      .where(
        and(eq(merchants.id, sourceId), eq(merchants.householdId, householdId)),
      )
      .limit(1);

    const [target] = await db
      .select()
      .from(merchants)
      .where(
        and(eq(merchants.id, targetId), eq(merchants.householdId, householdId)),
      )
      .limit(1);

    if (!source || !target) {
      throw new NotFoundError("Source or target merchant not found");
    }

    const result = await withTransaction(async (tx) => {
      const movedTransactions = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.merchantId, sourceId),
            eq(transactions.householdId, householdId),
          ),
        );
      const movedTransactionIds = movedTransactions.map(
        (transaction) => transaction.id,
      );
      const sourceContribution = Math.max(
        source.transactionCount || 0,
        movedTransactionIds.length,
      );
      const newCount =
        (target.transactionCount || 0) + sourceContribution;

      // Re-point the source's transactions onto the target.
      await tx
        .update(transactions)
        .set({ merchantId: targetId, updatedAt: new Date() })
        .where(
          and(
            eq(transactions.merchantId, sourceId),
            eq(transactions.householdId, householdId),
          ),
        );

      // Mark source inactive (merged into target) and zero its count.
      await tx
        .update(merchants)
        .set({ isActive: false, transactionCount: 0, updatedAt: new Date() })
        .where(and(eq(merchants.id, sourceId), eq(merchants.householdId, householdId)));

      // Roll the source's count into the target.
      await tx
        .update(merchants)
        .set({ transactionCount: newCount, updatedAt: new Date() })
        .where(and(eq(merchants.id, targetId), eq(merchants.householdId, householdId)));

      const [history] = await tx
        .insert(merchantMergeHistory)
        .values({
          sourceMerchantId: source.id,
          sourceMerchantName: source.name,
          targetMerchantId: target.id,
          mergedTransactionIds: movedTransactionIds,
          mergedBy: options.mergedBy ?? null,
          canUndo: true,
        })
        .returning({ id: merchantMergeHistory.id });

      return {
        merged: true,
        targetId,
        mergeHistoryId: history.id,
        mergedTransactionCount: movedTransactionIds.length,
      };
    });

    return result;
  }

  async undoMerge(
    householdId: string,
    historyId: string,
  ): Promise<UndoMergeResult> {
    const [history] = await db
      .select({
        id: merchantMergeHistory.id,
        sourceMerchantId: merchantMergeHistory.sourceMerchantId,
        sourceMerchantName: merchantMergeHistory.sourceMerchantName,
        targetMerchantId: merchantMergeHistory.targetMerchantId,
        mergedTransactionIds: merchantMergeHistory.mergedTransactionIds,
        canUndo: merchantMergeHistory.canUndo,
        undoExpiresAt: merchantMergeHistory.undoExpiresAt,
      })
      .from(merchantMergeHistory)
      .innerJoin(merchants, eq(merchantMergeHistory.targetMerchantId, merchants.id))
      .where(
        and(
          eq(merchantMergeHistory.id, historyId),
          eq(merchants.householdId, householdId),
        ),
      )
      .limit(1);

    if (!history) {
      throw new NotFoundError("Merchant merge history not found");
    }

    if (!history.canUndo) {
      throw new ConflictError("Merchant merge has already been undone");
    }

    if (history.undoExpiresAt && history.undoExpiresAt < new Date()) {
      throw new ConflictError("Merchant merge undo period has expired");
    }

    const transactionIds = readMergedTransactionIds(
      history.mergedTransactionIds,
    );

    return await withTransaction(async (tx) => {
      if (transactionIds.length > 0) {
        await tx
          .update(transactions)
          .set({ merchantId: history.sourceMerchantId, updatedAt: new Date() })
          .where(
            and(
              eq(transactions.householdId, householdId),
              eq(transactions.merchantId, history.targetMerchantId),
              inArray(transactions.id, transactionIds),
            ),
          );
      }

      const [restoredMerchant] = await tx
        .update(merchants)
        .set({
          isActive: true,
          transactionCount: transactionIds.length,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(merchants.id, history.sourceMerchantId),
            eq(merchants.householdId, householdId),
          ),
        )
        .returning();

      if (!restoredMerchant) {
        throw new NotFoundError("Source merchant not found");
      }

      const [target] = await tx
        .update(merchants)
        .set({
          transactionCount: sql`GREATEST(COALESCE(${merchants.transactionCount}, 0) - ${transactionIds.length}, 0)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(merchants.id, history.targetMerchantId),
            eq(merchants.householdId, householdId),
          ),
        )
        .returning();

      if (!target) {
        throw new NotFoundError("Target merchant not found");
      }

      await tx
        .update(merchantMergeHistory)
        .set({ canUndo: false })
        .where(eq(merchantMergeHistory.id, history.id));

      return { restoredMerchant, target };
    });
  }
}

export const merchantService = new MerchantService();
