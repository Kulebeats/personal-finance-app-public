import { and, eq } from "drizzle-orm";
import { householdMembers, recurringTransactionLinks, recurringTransactions, transactions, type RecurringTransaction } from "@shared/schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { db } from "../../db";
import { can } from "../../core/authz/capabilities";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { ConflictError, ForbiddenError, NotFoundError } from "../../utils/errorHandler";
import { isPostgresError } from "../../utils/postgresError";
import { getVisibleRecurringRuleById } from "./RecurringAudienceQuery";
import { lockRecurringReferences, orderedIds } from "./RecurringAudienceReferences";
import { auditRecurringRule, type RecurringAuditRequest } from "./RecurringRuleAudit";
import { lockHouseholdBeforeMembers } from "./withWritableRecurringRule";

export async function unlinkVisibleRecurringSource(
  recurringId: string, requestedLinkId: string, actor: HouseholdContext,
  /** Request context for the UNLINK audit row, written in the unlink's transaction (FIN-13). */
  audit?: RecurringAuditRequest,
) {
  const targetId = recurringId.toLowerCase(), linkId = requestedLinkId.toLowerCase();
  for (let attempt = 1; ; attempt++) {
    let visibilityChecked = false;
    try {
      return await db.transaction(async tx => {
        await lockHouseholdBeforeMembers(tx, actor.householdId);
        const [grant] = await tx.select({ role: householdMembers.role }).from(householdMembers)
          .where(and(eq(householdMembers.householdId, actor.householdId), eq(householdMembers.userId, actor.userId))).for("share");
        if (!grant) throw new NotFoundError("Link");
        if (!can(grant.role, "financial.write") || !can(actor.role, "financial.write")) throw new ForbiddenError("Financial write access required");
        const currentActor = { ...actor, role: grant.role };
        await getVisibleRecurringRuleById(targetId, currentActor, tx);
        const [selected] = await tx.select().from(recurringTransactionLinks).where(and(eq(recurringTransactionLinks.id, linkId), eq(recurringTransactionLinks.recurringTransactionId, targetId)));
        if (!selected) throw new NotFoundError("Link");
        const [source] = await tx.select().from(transactions).where(and(eq(transactions.id, selected.transactionId), visibleTransactionPredicate(currentActor)));
        if (!source) throw new NotFoundError("Link");
        const plannedLinks = await tx.select().from(recurringTransactionLinks).where(eq(recurringTransactionLinks.transactionId, source.id)).orderBy(recurringTransactionLinks.id);
        const parentIds = orderedIds(plannedLinks.map(link => link.recurringTransactionId));
        for (const id of parentIds) await getVisibleRecurringRuleById(id, currentActor, tx);
        visibilityChecked = true;
        const parents: RecurringTransaction[] = [];
        for (const id of parentIds) {
          const query = tx.select().from(recurringTransactions).where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.householdId, actor.householdId)));
          // Retain public busy-survivor refusal, with every parent acquired before sources.
          const [parent] = await (id === targetId ? query.for("update") : query.for("update", { noWait: true }));
          if (!parent) throw new NotFoundError("Link");
          parents.push(parent);
        }
        if (!parents.some(parent => parent.id === targetId)) throw new NotFoundError("Link");
        const audience = await lockRecurringReferences(tx, parents, actor.householdId, currentActor, { lockTransactionsForUpdate: true });
        for (const id of parentIds) await getVisibleRecurringRuleById(id, currentActor, tx);
        const links = await tx.select().from(recurringTransactionLinks).where(eq(recurringTransactionLinks.transactionId, source.id)).orderBy(recurringTransactionLinks.id).for("update");
        const expected = new Map(plannedLinks.map(link => [link.id, link.recurringTransactionId]));
        if (links.length !== expected.size || links.some(link => expected.get(link.id) !== link.recurringTransactionId)) throw new ConflictError("Recurring link state changed");
        const link = links.find(link => link.id === linkId && link.recurringTransactionId === targetId);
        const transaction = audience.sources.find(row => row.id === source.id);
        if (!link || !transaction) throw new NotFoundError("Link");
        const survivorIds = orderedIds(links.filter(row => row.id !== linkId).map(row => row.recurringTransactionId));
        const pointer = transaction.recurringTransactionId;
        if (!transaction.isRecurring || !pointer || (pointer !== targetId && !survivorIds.includes(pointer)) || (pointer === targetId && survivorIds.length > 1)) {
          throw new ConflictError("Recurring link state changed");
        }
        await tx.delete(recurringTransactionLinks).where(and(eq(recurringTransactionLinks.id, linkId), eq(recurringTransactionLinks.recurringTransactionId, targetId)));
        if (pointer === targetId) {
          const successor = survivorIds[0] ?? null;
          const updated = await transactionRepository.update(transaction.id, actor.householdId, { isRecurring: successor !== null, recurringTransactionId: successor }, undefined, tx);
          if (!updated.transaction) throw new NotFoundError("Link");
        }
        await recurringRepository.logHistory({ recurringTransactionId: targetId, action: "unlinked", linkedTransactionId: transaction.id, performedBy: actor.userId }, tx);
        if (audit) {
          await auditRecurringRule(tx, "UNLINK", link.recurringTransactionId, actor, audit, {
            metadata: { transactionId: link.transactionId, linkId: link.id },
          });
        }
        return { id: link.id, transactionId: link.transactionId, recurringTransactionId: link.recurringTransactionId };
      }, { isolationLevel: "serializable" });
    } catch (error) {
      if (isPostgresError(error, "40001") || isPostgresError(error, "40P01")) {
        if (attempt < 3) continue;
        throw new ConflictError("Recurring link state changed");
      }
      if (error instanceof NotFoundError) throw new NotFoundError("Link");
      if (isPostgresError(error, "55P03")) {
        if (!visibilityChecked) throw new NotFoundError("Link");
        throw new ConflictError("Recurring link state changed");
      }
      throw error;
    }
  }
}
