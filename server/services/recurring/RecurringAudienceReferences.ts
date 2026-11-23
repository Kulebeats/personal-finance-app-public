import { and, eq, inArray, isNull } from "drizzle-orm";
import { accounts, categories, households, merchants, recurringTransactionHistory, recurringTransactionLinks, transactions,
  type Account, type RecurringTransaction, type Transaction } from "@shared/schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { retainedTransactionOnVisibleAccountPredicate, visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { PATTERN_ORIGIN_ACTION, patternOriginSchema } from "./RecurringPatternProvenance";
import { denominationIssue } from "./RecurringPatternSelection";
import { denominationConfirmationIssue, getVerifiedRecurringRuleCurrency } from "./RecurringDenomination";

export interface RecurringAudienceLockOptions {
  additionalTransactionIds?: string[]; additionalAccountIds?: string[];
  additionalCategoryIds?: string[]; additionalMerchantIds?: string[];
  lockAccountsForUpdate?: boolean; lockTransactionsForUpdate?: boolean;
}
export interface LockedRecurringAudience {
  sources: Transaction[]; accounts: Account[]; householdCurrency?: string | null; verifiedOrigins: boolean;
  currencies: ReadonlyMap<string, "ZMW" | null>;
}
export const orderedIds = (ids: Iterable<string>) => Array.from(new Set(Array.from(ids, id => id.toLowerCase()))).sort();

/** Parents are already locked. Collect the full graph before acquiring any source/account lock. */
export async function lockRecurringReferences(
  tx: TransactionType, rules: RecurringTransaction[], householdId: string,
  actor?: HouseholdContext, options?: RecurringAudienceLockOptions,
): Promise<LockedRecurringAudience> {
  const ruleIds = orderedIds(rules.map(rule => rule.id));
  const links = await tx.select().from(recurringTransactionLinks).where(inArray(recurringTransactionLinks.recurringTransactionId, ruleIds))
    .orderBy(recurringTransactionLinks.id).for("share");
  const history = await tx.select().from(recurringTransactionHistory).where(inArray(recurringTransactionHistory.recurringTransactionId, ruleIds))
    .orderBy(recurringTransactionHistory.id).for("share");
  // The parent lock serializes the actual normal-create pointer writer. Enumerate
  // first so every source, including pointer-only rows, shares one sorted lock order.
  const pointers = await tx.select({ id: transactions.id, parentId: transactions.recurringTransactionId }).from(transactions)
    .where(and(eq(transactions.householdId, householdId), inArray(transactions.recurringTransactionId, ruleIds))).orderBy(transactions.id);
  const liveSourceIds = new Set(orderedIds(options?.additionalTransactionIds ?? []));
  const sourceIds = new Set(orderedIds([...links.map(link => link.transactionId), ...pointers.map(source => source.id), ...liveSourceIds]));
  const accountIds = new Set(orderedIds([...rules.map(rule => rule.accountId), ...(options?.additionalAccountIds ?? [])]));
  const categoryIds = new Set(options?.additionalCategoryIds ?? []), historicalCategoryIds = new Set<string>();
  const merchantIds = new Set(options?.additionalMerchantIds ?? []);
  const suggestedIds = new Set(rules.filter(rule => rule.detectionMethod === "suggested").map(rule => rule.id));
  const strictSourceIds = new Set(links.filter(link => suggestedIds.has(link.recurringTransactionId)).map(link => link.transactionId));
  for (const pointer of pointers) if (pointer.parentId && suggestedIds.has(pointer.parentId)) strictSourceIds.add(pointer.id);
  const strictAccountIds = new Set(rules.filter(rule => suggestedIds.has(rule.id)).map(rule => rule.accountId));
  if (suggestedIds.size) {
    for (const id of options?.additionalTransactionIds ?? []) strictSourceIds.add(id.toLowerCase());
    for (const id of options?.additionalAccountIds ?? []) strictAccountIds.add(id.toLowerCase());
  }
  function addReferences(state: unknown, strict: boolean) {
    if (!state || typeof state !== "object") return;
    if ("accountId" in state && typeof state.accountId === "string") {
      accountIds.add(state.accountId); if (strict) strictAccountIds.add(state.accountId.toLowerCase());
    }
    if ("categoryId" in state && typeof state.categoryId === "string") categoryIds.add(state.categoryId);
    if ("merchantId" in state && typeof state.merchantId === "string") merchantIds.add(state.merchantId);
  }
  for (const rule of rules) addReferences(rule, suggestedIds.has(rule.id));
  for (const entry of history) {
    const strict = suggestedIds.has(entry.recurringTransactionId);
    if (entry.linkedTransactionId) {
      sourceIds.add(entry.linkedTransactionId); if (strict) strictSourceIds.add(entry.linkedTransactionId);
    } else if (["linked", "unlinked", "processed"].includes(entry.action)) throw new NotFoundError("Recurring rule");
    addReferences(entry.previousState, strict); addReferences(entry.newState, strict);
    if (entry.action === PATTERN_ORIGIN_ACTION) {
      const marker = patternOriginSchema.safeParse(entry.newState);
      if (!marker.success) throw new NotFoundError("Recurring rule");
      for (const source of marker.data.contributors) {
        sourceIds.add(source.transactionId.toLowerCase()); strictSourceIds.add(source.transactionId.toLowerCase());
        liveSourceIds.add(source.transactionId.toLowerCase());
        accountIds.add(source.accountId.toLowerCase()); strictAccountIds.add(source.accountId.toLowerCase());
        if (source.categoryId) historicalCategoryIds.add(source.categoryId);
        if (source.merchantId) merchantIds.add(source.merchantId);
      }
    }
  }
  const sourceList = orderedIds(sourceIds);
  // Retained refs still carry their original audience. Newly selected sources
  // and original pattern contributors require a live transaction after locking.
  const sources = sourceList.length ? await tx.select().from(transactions).where(and(inArray(transactions.id, sourceList),
    actor ? retainedTransactionOnVisibleAccountPredicate(actor) : eq(transactions.householdId, householdId)))
    .orderBy(transactions.id).for(options?.lockTransactionsForUpdate ? "update" : "share") : [];
  if (sources.length !== sourceList.length || sources.some(source => liveSourceIds.has(source.id) && source.deletedAt !== null)) {
    throw new NotFoundError("Recurring rule");
  }
  for (const source of sources) {
    accountIds.add(source.accountId);
    if (strictSourceIds.has(source.id)) {
      if (source.currency !== "ZMW") throw new NotFoundError("Recurring rule");
      strictAccountIds.add(source.accountId);
    }
    // Historical source metadata does not become a newly authored rule category.
    if (source.categoryId) historicalCategoryIds.add(source.categoryId);
    if (source.merchantId) merchantIds.add(source.merchantId);
  }
  const accountList = orderedIds(accountIds);
  const lockedAccounts = await tx.select().from(accounts).where(and(inArray(accounts.id, accountList),
    actor ? visibleAccountPredicate(actor) : and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt))))
    .orderBy(accounts.id).for(options?.lockAccountsForUpdate ? "update" : "share");
  if (lockedAccounts.length !== accountList.length || lockedAccounts.some(account => strictAccountIds.has(account.id) && account.currency !== "ZMW")) throw new NotFoundError("Recurring rule");
  const [household] = await tx.select({ currency: households.currency }).from(households).where(eq(households.id, householdId)).for("share");
  if (!household || (suggestedIds.size && household.currency !== "ZMW")) throw new NotFoundError("Recurring rule");
  for (const [ids, historical] of [[categoryIds, false], [historicalCategoryIds, true]] as const) {
    if (!ids.size) continue;
    const list = orderedIds(ids);
    const rows = await tx.select({ id: categories.id }).from(categories).where(and(inArray(categories.id, list), eq(categories.householdId, householdId), historical ? undefined : isNull(categories.deletedAt)))
      .orderBy(categories.id).for("share");
    if (rows.length !== list.length) throw new NotFoundError("Recurring rule");
  }
  if (merchantIds.size) {
    const list = orderedIds(merchantIds);
    const rows = await tx.select({ id: merchants.id }).from(merchants).where(and(inArray(merchants.id, list), eq(merchants.householdId, householdId))).orderBy(merchants.id).for("share");
    if (rows.length !== list.length) throw new NotFoundError("Recurring rule");
  }
  const verifiedOrigins = rules.every(rule => rule.detectionMethod === "manual" ||
    (rule.detectionMethod === "suggested" && history.filter(entry => entry.recurringTransactionId === rule.id && entry.action === PATTERN_ORIGIN_ACTION).length === 1));
  const currencies = new Map<string, "ZMW" | null>();
  for (const rule of rules) currencies.set(rule.id, await getVerifiedRecurringRuleCurrency(rule.id, householdId, tx));
  return { sources, accounts: lockedAccounts, householdCurrency: household.currency, verifiedOrigins, currencies };
}

/** Visibility ownership is distinct from the financial actor/system audit identity. */
export function recurringPostingMetadata(audience: LockedRecurringAudience, rule: RecurringTransaction, actor?: HouseholdContext) {
  const destination = audience.accounts.find(account => account.id === rule.accountId);
  if (!audience.verifiedOrigins) throw new ValidationError("Recurring origin provenance must be verified before processing this template.");
  if (audience.currencies.get(rule.id) !== "ZMW") throw new ValidationError(denominationConfirmationIssue);
  if (!destination || audience.householdCurrency !== "ZMW" || audience.accounts.some(account => account.currency !== "ZMW") ||
      audience.sources.some(source => source.currency !== "ZMW")) throw new ValidationError(denominationIssue);
  const owners = new Set<string>();
  for (const source of [...audience.accounts, ...audience.sources]) {
    if (source.isPrivate === false) continue;
    if (!source.ownerUserId) throw new ValidationError("Private recurring origins need a known owner before processing.");
    owners.add(source.ownerUserId);
  }
  if (owners.size > 1) throw new ValidationError("Private recurring origins do not share a single owner; resolve this template before processing.");
  return { currency: "ZMW", isPrivate: owners.size > 0,
    ownerUserId: Array.from(owners)[0] ?? actor?.userId ?? null };
}
