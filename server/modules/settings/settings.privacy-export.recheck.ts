/**
 * Personal-export manifest and its source re-check (A-35, A-27).
 *
 * An export stays downloadable only while every captured source is still
 * readable by its requester. A source that is now hidden, or gone (deleted by
 * its owner), revokes the export: fail closed. Version 1 manifests keep the
 * version 1 rule (accounts and transactions only).
 *
 * Locks: the download first re-checks everything with plain reads and reads
 * its file holding no lock. Only then does it take membership, transactions
 * and accounts FOR SHARE (the version 1 sources, in the ordinary writer's
 * order) and re-check those under the lock until its audit row commits
 * ({@link areLedgerSourcesStillReadable}). The version 2 sets (goals, rules,
 * holdings, bonds, bond payments, bills, receipts, investment activity) are
 * plain reads only: a re-point committed after the read is the same as a
 * download that finished just before it.
 */
import { and, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  accounts, grzBondPayments, grzBonds, grzTBills, holdings, investmentTransactions, pendingReceipts, recurringTransactions,
  transactions,
} from "@shared/schema";
import {
  PERSONAL_EXPORT_ARCHIVE_VERSION, PERSONAL_EXPORT_TYPE, type PersonalExportSections,
} from "@shared/personal-data-export";
import type { TransactionType } from "../../utils/withTransaction";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { retainedAccountPredicate, retainedTransactionPredicate } from "../../core/authz/transaction-visibility";
import { visibleHoldingPredicate, visibleInvestmentTransactionPredicate } from "../../core/authz/investment-visibility";
import { visibleReceiptPredicate } from "../../core/authz/receipt-visibility";
import { visibleRulePredicate } from "../../services/recurring/RecurringAudienceQuery";
import { readGoalSourceVisibility } from "../../services/goal/GoalViewerProgress";
import {
  visibleBillPredicate, visibleBondPaymentPredicate, visibleBondPredicate,
} from "../../services/grz/holdingVisibility";
import type { InventorySources } from "./settings.privacy-export.sections";
import type { ActivitySources } from "./settings.privacy-export.activity";

const INVENTORY_SOURCE_KEYS = [
  "sourceGoalIds", "sourceRuleIds", "sourceHoldingIds", "sourceBondIds", "sourceBondPaymentIds", "sourceTBillIds", "sourceReceiptIds",
] as const satisfies readonly (keyof InventorySources)[];

export interface PersonalExportManifest extends Partial<InventorySources>, Partial<ActivitySources> {
  kind: typeof PERSONAL_EXPORT_TYPE;
  version: number;
  /** Household the snapshot was taken from; null without a household. */
  householdId: string | null;
  sha256: string;
  sizeBytes: number;
  sections: PersonalExportSections;
  /** Source evidence may be absent on legacy manifests. */
  sourceAccountIds?: string[];
  sourceTransactionIds?: string[];
}

export type HouseholdRole = HouseholdContext["role"];

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

function isSourceIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id: unknown) => typeof id === "string" && UUID.test(id));
}

export function readManifest(value: unknown): PersonalExportManifest | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as Partial<PersonalExportManifest>;
  if (manifest.kind !== PERSONAL_EXPORT_TYPE || typeof manifest.sha256 !== "string") return null;
  if (manifest.householdId !== null && typeof manifest.householdId !== "string") return null;
  const lists = ["sourceAccountIds", "sourceTransactionIds", "sourceInvestmentActivityIds", ...INVENTORY_SOURCE_KEYS] as const;
  if (lists.some(key => manifest[key] !== undefined && !isSourceIdList(manifest[key]))) return null;
  return manifest as PersonalExportManifest;
}

const anyId = (column: AnyPgColumn, ids: readonly string[]) => sql`${column} = ANY(${sql.param([...ids])}::uuid[])`;

/** The version 1 sources, under the original locks. */
async function ledgerSourcesReadable(
  tx: TransactionType, actor: HouseholdContext, manifest: PersonalExportManifest, lock: boolean,
): Promise<boolean> {
  if (!manifest.sourceAccountIds || !manifest.sourceTransactionIds) return false;
  const sourceAccountIds = new Set(manifest.sourceAccountIds);
  const sourceTransactionIds = [...new Set(manifest.sourceTransactionIds)];
  if (sourceAccountIds.size !== manifest.sections?.accounts ||
      sourceTransactionIds.length !== manifest.sections?.transactions) return false;
  // Hold membership, transactions, then accounts in the ordinary writer's
  // order. Include current account references if a transaction was moved.
  if (sourceTransactionIds.length) {
    const query = tx.select({ id: transactions.id, accountId: transactions.accountId }).from(transactions)
      .where(and(anyId(transactions.id, sourceTransactionIds), retainedTransactionPredicate(actor)))
      .orderBy(transactions.id);
    const visible = lock ? await query.for("share") : await query;
    if (visible.length !== sourceTransactionIds.length) return false;
    for (const transaction of visible) sourceAccountIds.add(transaction.accountId);
  }
  if (!sourceAccountIds.size) return true;
  const query = tx.select({ id: accounts.id }).from(accounts)
    .where(and(anyId(accounts.id, [...sourceAccountIds]), retainedAccountPredicate(actor)))
    .orderBy(accounts.id);
  const visible = lock ? await query.for("share") : await query;
  return visible.length === sourceAccountIds.size;
}

/** Plain read: every listed id still passes its entity's visibility rule. */
async function allVisible(tx: TransactionType, column: AnyPgColumn, ids: readonly string[], visible: SQL): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (!unique.length) return true;
  const rows = await tx.select({ id: column }).from(column.table).where(and(anyId(column, unique), visible));
  return rows.length === unique.length;
}

/** The version 2 sources; each count must match the manifest's section count. */
async function inventorySourcesReadable(
  tx: TransactionType, actor: HouseholdContext, manifest: PersonalExportManifest,
): Promise<boolean> {
  const { sourceGoalIds, sourceRuleIds, sourceHoldingIds, sourceBondIds, sourceBondPaymentIds, sourceTBillIds, sourceReceiptIds } = manifest;
  if (!sourceGoalIds || !sourceRuleIds || !sourceHoldingIds || !sourceBondIds || !sourceBondPaymentIds ||
      !sourceTBillIds || !sourceReceiptIds) return false;
  const counted: [string[], number | undefined][] = [
    [sourceRuleIds, manifest.sections.recurringRules], [sourceHoldingIds, manifest.sections.holdings],
    [sourceBondIds, manifest.sections.grzBonds], [sourceBondPaymentIds, manifest.sections.grzBondPayments],
    [sourceTBillIds, manifest.sections.grzTBills], [sourceReceiptIds, manifest.sections.receipts],
  ];
  if (counted.some(([ids, count]) => new Set(ids).size !== count)) return false;
  if (sourceGoalIds.length) {
    // A goal whose progress was exported must still show it to this member.
    const verdicts = await readGoalSourceVisibility(actor, [...new Set(sourceGoalIds)], tx);
    if (sourceGoalIds.some(id => !verdicts.get(id)?.progressVisible)) return false;
  }
  return await allVisible(tx, recurringTransactions.id, sourceRuleIds, visibleRulePredicate(actor)) &&
    await allVisible(tx, holdings.id, sourceHoldingIds, visibleHoldingPredicate(actor)) &&
    await allVisible(tx, grzBonds.id, sourceBondIds, visibleBondPredicate(actor)) &&
    await allVisible(tx, grzBondPayments.id, sourceBondPaymentIds, visibleBondPaymentPredicate(actor)) &&
    await allVisible(tx, grzTBills.id, sourceTBillIds, visibleBillPredicate(actor)) &&
    await allVisible(tx, pendingReceipts.id, sourceReceiptIds, visibleReceiptPredicate(actor)) &&
    await activitySourcesReadable(tx, actor, manifest);
}

/** Investment activity, on manifests that exported it (earlier version 2 exports did not). */
async function activitySourcesReadable(
  tx: TransactionType, actor: HouseholdContext, manifest: PersonalExportManifest,
): Promise<boolean> {
  if (manifest.sections.investmentActivity === undefined) return true;
  const ids = manifest.sourceInvestmentActivityIds;
  if (!ids || new Set(ids).size !== manifest.sections.investmentActivity) return false;
  return allVisible(tx, investmentTransactions.id, ids, visibleInvestmentTransactionPredicate(actor));
}

function actorFor(userId: string, manifest: PersonalExportManifest, readable: ReadonlyMap<string, HouseholdRole>): HouseholdContext | null {
  const role = manifest.householdId ? readable.get(manifest.householdId) : undefined;
  return manifest.householdId && role ? { userId, householdId: manifest.householdId, role } : null;
}

/**
 * Recheck every captured source under current privacy, with plain reads. A
 * household export without complete source evidence reads as revoked.
 */
export async function isStillReadable(
  tx: TransactionType, userId: string, manifest: PersonalExportManifest | null,
  readable: ReadonlyMap<string, HouseholdRole>,
): Promise<boolean> {
  if (!manifest?.householdId) return true;
  const actor = actorFor(userId, manifest, readable);
  if (!actor) return false;
  if (!await ledgerSourcesReadable(tx, actor, manifest, false)) return false;
  if (manifest.version < PERSONAL_EXPORT_ARCHIVE_VERSION) return true;
  return inventorySourcesReadable(tx, actor, manifest);
}

/**
 * The download's locked tail: the version 1 sources again, FOR SHARE, after
 * the plain re-check and the file read. `readable` must come from a locked
 * membership read in the same transaction.
 */
export async function areLedgerSourcesStillReadable(
  tx: TransactionType, userId: string, manifest: PersonalExportManifest,
  readable: ReadonlyMap<string, HouseholdRole>,
): Promise<boolean> {
  if (!manifest.householdId) return true;
  const actor = actorFor(userId, manifest, readable);
  return actor !== null && ledgerSourcesReadable(tx, actor, manifest, true);
}
