import { and, eq, inArray } from "drizzle-orm";
import { accounts, categories, householdMembers, households, merchants, recurringTransactionLinks, recurringTransactions, transactions, type Transaction } from "@shared/schema";
import { patternOptionsSchema } from "@shared/recurring-pattern";
import type { ConfirmPatternInput } from "../../modules/recurring/recurring.validation";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { db } from "../../db";
import { can } from "../../core/authz/capabilities";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { toMoneyDto } from "../../core/money";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { businessAuditService } from "../BusinessAuditService";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import { isPostgresError } from "../../utils/postgresError";
import type { TransactionType } from "../../utils/withTransaction";
import { getVisibleRecurringRuleById } from "./RecurringAudienceQuery";
import { denominationIssue, readPatternTimezone, readSignedPatterns, rescanIssue, resolvePatternWindow, type SignedPattern } from "./RecurringPatternSelection";
import { PATTERN_ORIGIN_ACTION } from "./RecurringPatternProvenance";
import { recordRecurringDenomination } from "./RecurringDenomination";

const normalize = (ids: string[]) => Array.from(new Set(ids.map(id => id.toLowerCase()))).sort();
const sameIds = (a: string[], b: string[]) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
function matchesPreview(input: ConfirmPatternInput, derived: SignedPattern) {
  return input.name === derived.name && input.type === derived.type &&
    (input.merchantId?.toLowerCase() ?? null) === derived.merchantId && input.frequency === derived.frequency &&
    JSON.stringify(input.estimatedAmount) === JSON.stringify(toMoneyDto(derived.estimatedAmount, derived.currency)) &&
    input.suggestedStartDate === derived.suggestedStartDate && input.suggestedNextDueDate === derived.suggestedNextDueDate &&
    (input.dayOfMonth ?? undefined) === derived.dayOfMonth && (input.dayOfWeek ?? undefined) === derived.dayOfWeek &&
    (input.amountVariance === undefined || input.amountVariance === derived.amountVariance) &&
    (input.confidence === undefined || input.confidence === derived.confidence) &&
    (input.occurrences === undefined || input.occurrences === derived.occurrences);
}
async function assertUnclaimed(tx: TransactionType, sources: Transaction[], actor: HouseholdContext) {
  const links = await tx.select().from(recurringTransactionLinks).where(inArray(recurringTransactionLinks.transactionId, sources.map(source => source.id)));
  const parentIds = normalize([...links.map(link => link.recurringTransactionId), ...sources.flatMap(source => source.recurringTransactionId ? [source.recurringTransactionId] : [])]);
  // Read solely to choose a safe refusal. Never acquire an old parent lock after a source.
  for (const parentId of parentIds) await getVisibleRecurringRuleById(parentId, actor, tx);
  if (parentIds.length || sources.some(source => source.isRecurring)) throw new ConflictError("Recurring link state changed. Scan again.");
}
async function lockReferences(tx: TransactionType, sources: Transaction[], accountId: string, input: ConfirmPatternInput, actor: HouseholdContext) {
  const ids = normalize([accountId, ...sources.map(source => source.accountId)]);
  const locked = await tx.select().from(accounts).where(and(inArray(accounts.id, ids), visibleAccountPredicate(actor)))
    .orderBy(accounts.id).for("share");
  if (locked.length !== ids.length) throw new NotFoundError("Recurring pattern");
  const categoryIds = normalize(sources.flatMap(source => source.categoryId ? [source.categoryId] : []));
  const merchantIds = normalize([...sources.flatMap(source => source.merchantId ? [source.merchantId] : []), ...(input.merchantId ? [input.merchantId] : [])]);
  if (categoryIds.length) {
    // Historical archived/deleted categories remain legitimate source metadata.
    const rows = await tx.select().from(categories).where(and(inArray(categories.id, categoryIds), eq(categories.householdId, actor.householdId))).orderBy(categories.id).for("share");
    if (rows.length !== categoryIds.length) throw new NotFoundError("Recurring pattern");
  }
  if (merchantIds.length) {
    const rows = await tx.select().from(merchants).where(and(inArray(merchants.id, merchantIds), eq(merchants.householdId, actor.householdId))).orderBy(merchants.id).for("share");
    if (rows.length !== merchantIds.length) throw new NotFoundError("Recurring pattern");
  }
  return locked;
}
export async function confirmVisiblePattern(input: ConfirmPatternInput, accountId: string, actor: HouseholdContext, ipAddress?: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async tx => {
        const [grant] = await tx.select().from(householdMembers).where(and(eq(householdMembers.householdId, actor.householdId), eq(householdMembers.userId, actor.userId))).for("share");
        if (!grant) throw new NotFoundError("Recurring pattern");
        if (!can(grant.role, "financial.write") || !can(actor.role, "financial.write")) throw new ForbiddenError("Financial write access required");
        const currentActor = { ...actor, role: grant.role };
        const requestedIds = normalize([...input.sampleTransactionIds, ...(input.selection?.contributorIds ?? [])]);
        const requested = await tx.select().from(transactions).where(and(inArray(transactions.id, requestedIds), visibleTransactionPredicate(currentActor))).orderBy(transactions.id);
        if (requested.length !== requestedIds.length) throw new NotFoundError("Recurring pattern");
        await assertUnclaimed(tx, requested, currentActor);
        const clock = await readPatternTimezone(tx, actor.userId);
        const options = input.selection?.options ?? patternOptionsSchema.parse({});
        const window = resolvePatternWindow(options, clock.timezone);
        // This is a personal history preview, not a household scheduling policy.
        if (input.selection && (input.selection.startDate !== window.startDate || input.selection.endDate !== window.endDate ||
          input.selection.timezone !== clock.timezone || input.selection.timezoneSource !== clock.timezoneSource)) throw new ConflictError(rescanIssue);
        const candidates = await readSignedPatterns(tx, currentActor, options, window);
        const matches = candidates.filter(({ pattern }) => input.selection
          ? pattern.selection?.groupKey === input.selection.groupKey
          : sameIds(pattern.selection?.contributorIds ?? [], input.sampleTransactionIds));
        const selected = matches.length === 1 ? matches[0] : undefined;
        // Validate every supplied reference even when it cannot derive a group.
        // These provisional locks are taken only after all selected source locks below.
        if (!selected) {
          const sources = await tx.select().from(transactions).where(and(inArray(transactions.id, requestedIds), visibleTransactionPredicate(currentActor))).orderBy(transactions.id).for("update");
          await lockReferences(tx, sources, accountId, input, currentActor);
          if (sources.length !== requestedIds.length) throw new NotFoundError("Recurring pattern");
          throw new ConflictError(rescanIssue);
        }
        const selectedIds = selected.pattern.selection!.contributorIds;
        if (input.selection && (input.selection.fingerprint !== selected.pattern.selection!.fingerprint ||
          JSON.stringify(input.selection.contributorIds) !== JSON.stringify(selectedIds) ||
          !sameIds(input.sampleTransactionIds, selected.pattern.sampleTransactionIds))) throw new ConflictError(rescanIssue);
        const sources = await tx.select().from(transactions).where(and(inArray(transactions.id, selectedIds), visibleTransactionPredicate(currentActor))).orderBy(transactions.id).for("update");
        if (sources.length !== selectedIds.length) throw new NotFoundError("Recurring pattern");
        const lockedAccounts = await lockReferences(tx, sources, accountId, input, currentActor);
        const [lockedHousehold] = await tx.select().from(households).where(eq(households.id, actor.householdId)).for("share");
        if (!lockedHousehold) throw new NotFoundError("Recurring pattern");
        const lockedClock = await readPatternTimezone(tx, actor.userId, true);
        if (JSON.stringify(lockedClock) !== JSON.stringify(clock)) throw new ConflictError(rescanIssue);
        await assertUnclaimed(tx, sources, currentActor);
        if (lockedHousehold.currency !== "ZMW" || lockedAccounts.some(account => account.currency !== "ZMW") || sources.some(source => source.currency !== "ZMW") || selected.pattern.confirmationIssue) throw new ValidationError(denominationIssue, [{ field: "accountId", message: denominationIssue }]);
        if ((!input.selection && (input.confidence === undefined || input.amountVariance === undefined || input.occurrences === undefined)) ||
          !matchesPreview(input, selected.pattern)) throw new ConflictError(rescanIssue);
        const pattern = selected.pattern;
        const [inserted] = await tx.insert(recurringTransactions).values({
          householdId: actor.householdId, accountId: accountId.toLowerCase(), name: pattern.name,
          amount: pattern.estimatedAmount, amountType: pattern.amountTolerance > 0 ? "variable" : "fixed", amountTolerance: pattern.amountTolerance,
          type: pattern.type, frequency: pattern.frequency as "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly",
          startDate: pattern.suggestedStartDate, nextDueDate: pattern.suggestedNextDueDate,
          dayOfMonth: pattern.dayOfMonth ?? null, dayOfWeek: pattern.dayOfWeek ?? null,
          merchantId: pattern.merchantId, detectionMethod: "suggested", detectionConfidence: pattern.confidence,
        }).returning();
        await recurringRepository.logHistory({ recurringTransactionId: inserted.id, action: "created", newState: inserted, performedBy: actor.userId }, tx);
        for (const source of [...sources].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
          await recurringRepository.createLink({ recurringTransactionId: inserted.id, transactionId: source.id,
            matchMethod: "confirmed", matchConfidence: pattern.confidence,
            // These are observed historical occurrences, not predictions made at the next due date.
            expectedDate: source.date, actualDate: source.date, expectedAmount: pattern.estimatedAmount, actualAmount: source.amount, status: "linked" }, tx);
          await tx.update(transactions).set({ isRecurring: true, recurringTransactionId: inserted.id, updatedAt: new Date() }).where(eq(transactions.id, source.id));
          await recurringRepository.logHistory({ recurringTransactionId: inserted.id, action: "linked", linkedTransactionId: source.id,
            newState: { matchMethod: "confirmed", matchConfidence: pattern.confidence }, performedBy: actor.userId }, tx);
        }
        const ordered = [...sources].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
        const rule = await recurringRepository.update(inserted.id, actor.householdId, { totalOccurrences: sources.length,
          lastOccurredDate: ordered[ordered.length - 1].date, nextDueDate: pattern.suggestedNextDueDate }, tx);
        if (!rule) throw new NotFoundError("Recurring pattern");
        await recurringRepository.logHistory({ recurringTransactionId: rule.id, action: PATTERN_ORIGIN_ACTION,
          newState: { version: 1, currency: "ZMW", selection: pattern.selection, contributors: ordered.map(source => ({ transactionId: source.id,
            accountId: source.accountId, categoryId: source.categoryId, merchantId: source.merchantId })) }, performedBy: actor.userId }, tx);
        await recordRecurringDenomination(tx, rule, "ZMW", actor.userId, "pattern");
        await businessAuditService.logCreate({ tx, userId: actor.userId, householdId: actor.householdId, entityId: rule.id,
          entityType: "recurring_rule", newValue: { pattern: true, name: rule.name }, ipAddress });
        return rule;
      }, { isolationLevel: "serializable" });
    } catch (error) {
      if (!isPostgresError(error, "40001") && !isPostgresError(error, "40P01")) throw error;
      if (attempt >= 3) throw new ConflictError(rescanIssue);
    }
  }
}
