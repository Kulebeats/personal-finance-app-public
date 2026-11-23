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
} from "@shared/schema";
import {
  eq,
  and,
  ilike,
  desc,
  isNull,
  or,
} from "drizzle-orm";
import { NotFoundError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { merchantColumnsWithCount, visibleMerchantTransactionCount } from "./merchants.counts";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { lockMerchantLogoFolder, logoFolderHouseholdOf } from "./merchants.logo-paths";
import {
  assertMerchantNameFree,
  lockAndListClaimedMerchantNames,
  lockMerchantNames,
} from "./merchants.name-guard";

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

/**
 * A merchant that starts showing an uploaded logo holds that folder's lock
 * until commit, so the orphan sweep cannot retire the file meanwhile.
 */
async function lockLogoFolderOf(tx: TransactionType, logoUrl: string | null | undefined): Promise<void> {
  const folderHouseholdId = logoFolderHouseholdOf(logoUrl);
  if (folderHouseholdId) await lockMerchantLogoFolder(tx, folderHouseholdId);
}

class MerchantService {
  /** Merchants in the caller's household; transactionCount is counted at read time. */
  async list(actor: HouseholdContext, options: ListMerchantsOptions = {}) {
    const conditions = [eq(merchants.householdId, actor.householdId)];

    if (!options.includeHidden) {
      conditions.push(
        or(eq(merchants.isActive, true), isNull(merchants.isActive))!,
      );
    }

    if (options.search) {
      conditions.push(ilike(merchants.name, `%${options.search}%`));
    }

    return await db
      .select(merchantColumnsWithCount(actor))
      .from(merchants)
      .where(and(...conditions))
      .orderBy(desc(visibleMerchantTransactionCount(actor)));
  }

  async getById(id: string, actor: HouseholdContext) {
    const [merchant] = await db
      .select(merchantColumnsWithCount(actor))
      .from(merchants)
      .where(and(eq(merchants.id, id), eq(merchants.householdId, actor.householdId)))
      .limit(1);

    if (!merchant) {
      throw new NotFoundError("Merchant not found");
    }

    return merchant;
  }

  async getDetails(id: string, actor: HouseholdContext) {
    const merchant = await this.getById(id, actor);
    const aliases = await db
      .select()
      .from(merchantAliases)
      .where(eq(merchantAliases.merchantId, id));

    return { merchant, aliases };
  }

  async findDuplicates(actor: HouseholdContext) {
    const merchantList = await this.list(actor, { includeHidden: true });
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

  async autocomplete(actor: HouseholdContext, query: string, limit = 25) {
    const merchantList = await this.list(actor, { search: query });
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
    // A default is skipped when any merchant name OR alias already claims it
    // (merchants.name-guard), compared normalised (case and punctuation).
    const created = await withTransaction(async (tx) => {
      const claimed = await lockAndListClaimedMerchantNames(tx, householdId);
      const claimedNames = new Set(claimed.map((name) => normalizeMerchantName(name)));
      const toCreate = DEFAULT_ZAMBIAN_MERCHANTS.filter(
        (merchant) => !claimedNames.has(normalizeMerchantName(merchant.name)),
      );
      if (toCreate.length === 0) {
        return [];
      }
      return tx
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
    });

    return {
      inserted: created.length,
      skipped: DEFAULT_ZAMBIAN_MERCHANTS.length - created.length,
      merchants: created,
    };
  }

  async create(householdId: string, data: CreateMerchantInput) {
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

    // Name and alias share one namespace; see merchants.name-guard.
    return withTransaction(async (tx) => {
      await lockMerchantNames(tx, householdId);
      await assertMerchantNameFree(tx, householdId, data.name);
      await lockLogoFolderOf(tx, data.logoUrl);
      const [created] = await tx.insert(merchants).values({
        householdId,
        name: data.name,
        logoUrl: data.logoUrl ?? null,
        category: data.category ?? null,
        defaultCategoryId: data.defaultCategoryId ?? null,
        notes: data.notes ?? null,
        isActive: data.isActive ?? true,
        iconType: data.iconType ?? "logo",
        customIcon: data.customIcon ?? null,
      }).returning();
      return created;
    });
  }

  async update(id: string, householdId: string, data: UpdateMerchantInput) {
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

    return withTransaction(async (tx) => {
      // A rename joins the shared name/alias namespace; see merchants.name-guard.
      if (data.name) {
        await lockMerchantNames(tx, householdId);
        await assertMerchantNameFree(tx, householdId, data.name, id);
      }
      await lockLogoFolderOf(tx, data.logoUrl);
      const [updated] = await tx
        .update(merchants)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(merchants.id, id), eq(merchants.householdId, householdId)))
        .returning();
      if (!updated) {
        throw new NotFoundError("Merchant not found");
      }
      return updated;
    });
  }
}

export const merchantService = new MerchantService();
