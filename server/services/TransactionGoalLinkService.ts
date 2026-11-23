import { db } from "../db";
import {
  accounts,
  goalContributions,
  goals,
  householdMembers,
  transactionGoalLinks,
  transactions,
  type Goal,
} from "@shared/schema";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../utils/errorHandler";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { goalActivityLogService } from "./GoalActivityLogService";
import { businessAuditService } from "./BusinessAuditService";
import { Money } from "../core/money";
import { transactionRepository } from "../repositories/TransactionRepository";
import { validateTransactionLink } from "./TransactionGoalLinkValidation";
import type { HouseholdContext } from "../middleware/householdGuard";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import { can } from "../core/authz/capabilities";
import {
  assertWithinTarget, notifyGoalMilestone, toGoalCurrency,
} from "./goal/GoalProgressSources";
import { PENDING_EFFECT, refoldGoalProgress, sourceTimeSql } from "./goal/GoalProgressFold";
import { goalsWithHiddenProgress, readGoalSourceVisibility } from "./goal/GoalViewerProgress";

/** The actor and request origin a goal write records in the audit log, inside its transaction. */
export interface GoalWriteAudit {
  userId: string | null;
  ipAddress?: string;
}

/** What a link request asks for; an explicit amount keeps the currency it was sent in. */
export interface LinkTransactionRequest {
  transactionId: string;
  linkType: "contribution" | "spending";
  amount?: { amount: string; currency: string };
  /** NEW-29: the caller accepts an explicit contribution taking progress past the target. */
  confirmOverfund?: boolean;
  /** The requesting member; whether they can see the goal's progress decides the overfund check. */
  viewer?: HouseholdContext;
}

const NOT_VISIBLE = "Transaction not found or not visible";

export class TransactionGoalLinkService {
  async linkTransaction(
    goalId: string,
    householdId: string,
    userId: string | null,
    data: LinkTransactionRequest,
    externalTx?: TransactionType,
    audit?: GoalWriteAudit,
  ) {
    // Fetch transaction with visibility check (CLAUDE.md Rule 11 - verify visibility when linking)
    // This prevents User A from linking User B's private transaction to a goal.
    // A caller's own transaction may hold a source this connection cannot see yet
    // (a contribution from an account, #245); the same check runs inside it below.
    if (!externalTx) await this.getTransactionWithVisibility(data.transactionId, householdId, userId);
    if (data.amount !== undefined && new Money(data.amount.amount).isNegativeOrZero()) {
      throw new ValidationError("Invalid link amount");
    }

    // SCP-334: when an external transaction is provided (e.g. atomic rule
    // application), run the FOR UPDATE link logic inside that same transaction
    // so a failure here rolls back the whole rule apply. Otherwise open our own.
    const operation = async (tx: TransactionType) => {
      // R10.3 lock order matches the transaction writers and unlink:
      // transaction row, then goal, so an edit or delete of the source cannot
      // interleave with this link. Rule 11 again after any wait: the owner
      // may have made the source or its account private meanwhile.
      const viewer = userId ?? "";
      const [transaction] = await tx.select().from(transactions).where(and(
        eq(transactions.id, data.transactionId), eq(transactions.householdId, householdId), isNull(transactions.deletedAt),
        or(eq(transactions.isPrivate, false), eq(transactions.ownerUserId, viewer)),
      )).for("no key update").limit(1);
      if (!transaction) throw new NotFoundError(NOT_VISIBLE);
      const [account] = await tx.select({ currency: accounts.currency }).from(accounts).where(and(
        eq(accounts.id, transaction.accountId), or(eq(accounts.isPrivate, false), eq(accounts.ownerUserId, viewer)),
      )).for("share").limit(1);
      if (!account) throw new NotFoundError(NOT_VISIBLE);

      const [goal] = await tx.select().from(goals)
        .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId)))
        .for("update").limit(1);
      if (!goal) throw new NotFoundError("Goal not found");

      await validateTransactionLink(goal, transaction, data.linkType);
      const [existing] = await tx.select({ id: transactionGoalLinks.id }).from(transactionGoalLinks)
        .where(and(eq(transactionGoalLinks.transactionId, data.transactionId), eq(transactionGoalLinks.goalId, goalId)))
        .limit(1);
      if (existing) throw new ValidationError("Transaction is already linked to this goal");

      const sourceCurrency = transaction.currency ?? account.currency;
      if (data.amount && data.amount.currency !== sourceCurrency) {
        throw new ValidationError("Link amount currency must match the transaction currency", [
          { field: "amount.currency", message: `This transaction is in ${sourceCurrency}` },
        ]);
      }
      const source = new Money(data.amount?.amount ?? transaction.amount, sourceCurrency).abs();
      if (source.isZero()) throw new ValidationError("Invalid link amount");
      const converted = await toGoalCurrency(tx, householdId, source, goal.currency, transaction.date);
      // A member's link follows the over-fund rule whether it names an amount
      // or takes the whole transaction (goals QA F5); a rule's auto-link does not,
      // and a debt goal has no target to overfund (as on the transfer path).
      if (data.linkType === "contribution" && goal.type !== "pay_down" && (data.amount || data.viewer)) {
        await this.assertExplicitWithinTarget(tx, goal, converted.goalAmount, data);
      }
      // A transaction counts toward a goal once (GoalProgressFold): a manual
      // contribution that already cites it rules out a contribution link.
      if (data.linkType === "contribution") await this.assertNotCitedByContribution(tx, goalId, data.transactionId);

      // Written with a pending effect at its applied-order place, then folded.
      const [inserted] = await tx.insert(transactionGoalLinks).values({
        transactionId: data.transactionId,
        goalId,
        amount: converted.goalAmount.toString(),
        linkType: data.linkType,
        linkedBy: userId ?? null,
        linkedAt: sourceTimeSql(goalId),
        amountBasis: data.amount === undefined ? "transaction" : "explicit",
        sourceAmount: converted.sourceAmount.toString(),
        sourceCurrency,
        fxRate: converted.fxRate,
        appliedDelta: PENDING_EFFECT,
      }).returning();
      if (data.linkType === "contribution") {
        await tx.insert(goalContributions).values({
          goalId,
          amount: converted.goalAmount.toString(),
          date: transaction.date,
          notes: transaction.notes ?? null,
          transactionId: data.transactionId,
          appliedDelta: PENDING_EFFECT,
          createdBy: userId ?? null,
          // The mirror shares the link's place (read back at full precision).
          createdAt: sql<Date>`(select ${transactionGoalLinks.linkedAt} from ${transactionGoalLinks} where ${transactionGoalLinks.id} = ${inserted.id})`,
        });
      }
      const { write, net: applied } = await refoldGoalProgress(tx, goal, { from: inserted.id });
      const link = { ...inserted, appliedDelta: applied.toString() };

      await goalActivityLogService.log({
        goalId,
        activityType: "transaction_linked",
        amount: applied,
        previousBalance: write.previous,
        newBalance: write.next,
        metadata: {
          transactionId: data.transactionId,
          transactionName: transaction.name,
          linkType: data.linkType,
        },
        createdBy: userId ?? null,
        tx,
      });

      if (audit) {
        await businessAuditService.log({
          tx, userId: audit.userId, householdId, action: "LINK", entityType: "goal", entityId: goalId,
          details: { transactionId: data.transactionId, linkId: link.id, linkType: data.linkType, amount: link.amount,
            sourceAmount: link.sourceAmount, sourceCurrency, fxRate: link.fxRate, appliedDelta: link.appliedDelta },
          ipAddress: audit.ipAddress,
        });
      }

      if (data.linkType === "contribution") await notifyGoalMilestone(tx, householdId, goal, write.goal);

      return {
        link,
        goal: write.goal,
      };
    };

    return externalTx
      ? await operation(externalTx)
      : await withTransaction(operation);
  }

  async unlinkTransaction(
    goalId: string,
    transactionId: string,
    actor: HouseholdContext,
    audit?: GoalWriteAudit,
  ) {
    const { householdId, userId } = actor;
    return await withTransaction(async (tx) => {
      const [membership] = await tx.select({ role: householdMembers.role })
        .from(householdMembers)
        .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
        .for("share").limit(1);
      if (!membership) throw new NotFoundError("Link");
      if (!can(actor.role, "financial.write") || !can(membership.role, "financial.write")) {
        throw new ForbiddenError("Financial write access required");
      }

      // Match the ledger's transaction-before-account order. NO KEY UPDATE
      // freezes privacy and accountId while allowing FK KEY SHARE locks from
      // an existing goal-link writer that already holds the goal row.
      const [transaction] = await tx.select().from(transactions).where(and(
        eq(transactions.id, transactionId), visibleTransactionPredicate(actor),
      )).for("no key update").limit(1);
      if (!transaction) throw new NotFoundError("Link");

      // A separate locking read rechecks account visibility after any wait;
      // the transaction query's account subquery is not a lock on that row.
      const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(
        eq(accounts.id, transaction.accountId), visibleAccountPredicate(actor),
      )).for("share").limit(1);
      if (!account) throw new NotFoundError("Link");

      const [goal] = await tx.select().from(goals)
        .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId)))
        .for("update").limit(1);
      if (!goal) throw new NotFoundError("Link");

      const [link] = await tx.select().from(transactionGoalLinks)
        .where(and(eq(transactionGoalLinks.transactionId, transactionId), eq(transactionGoalLinks.goalId, goalId)))
        .for("update").limit(1);
      if (!link) throw new NotFoundError("Link");

      // Refold without this link (GoalProgressFold), so a spend that drew on
      // it gives back only what it can still take, then remove it.
      const hidden = await goalsWithHiddenProgress(actor, [goal.id], tx);
      const { write, net: reversed, rebalanced } = await refoldGoalProgress(tx, goal, {
        from: link.id, removedLinkId: link.id, progressHiddenFromEditor: hidden.has(goal.id),
      });
      await tx.delete(transactionGoalLinks).where(eq(transactionGoalLinks.id, link.id));
      if (link.linkType === "contribution") {
        await tx.delete(goalContributions).where(and(
          eq(goalContributions.goalId, goalId), eq(goalContributions.transactionId, transactionId),
        ));
      }

      await goalActivityLogService.log({
        goalId,
        activityType: "transaction_unlinked",
        amount: reversed,
        previousBalance: write.previous,
        newBalance: write.next,
        metadata: {
          transactionId,
          transactionName: transaction.name,
          linkType: link.linkType,
        },
        createdBy: userId,
        tx,
      });

      if (audit) {
        await businessAuditService.log({
          tx, userId, householdId, action: "UNLINK", entityType: "goal", entityId: goalId,
          details: { transactionId, linkId: link.id, linkType: link.linkType, reversedDelta: reversed.toString(), rebalanced },
          ipAddress: audit.ipAddress,
        });
      }

      return {
        success: true,
        goal: write.goal,
      };
    });
  }

  private async assertNotCitedByContribution(tx: TransactionType, goalId: string, transactionId: string) {
    const [cited] = await tx.select({ id: goalContributions.id }).from(goalContributions)
      .where(and(eq(goalContributions.goalId, goalId), eq(goalContributions.transactionId, transactionId))).limit(1);
    if (cited) {
      throw new ConflictError("A contribution to this goal already cites this transaction, so it already counts toward the goal");
    }
  }

  /**
   * NEW-29 for a member's contribution link: the same confirmation rule as a
   * manual contribution. Read after the goal lock, so no other progress source can
   * change the verdict before this link commits.
   */
  private async assertExplicitWithinTarget(tx: TransactionType, goal: Goal, amount: Money, data: LinkTransactionRequest) {
    if (data.confirmOverfund === true) return;
    const progressHidden = data.viewer
      ? (await readGoalSourceVisibility(data.viewer, [goal.id], tx)).get(goal.id)?.progressVisible !== true
      : false;
    assertWithinTarget(goal, amount, false, progressHidden);
  }

  private async getGoal(goalId: string, householdId: string): Promise<Goal> {
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId)))
      .limit(1);

    if (!goal) {
      throw new NotFoundError("Goal not found");
    }

    return goal;
  }

  /**
   * Get transaction with visibility check.
   * Per CLAUDE.md Rule 11: Always check visibility when linking entities across tables.
   * Prevents User A from linking User B's private transaction to a goal.
   */
  private async getTransactionWithVisibility(
    transactionId: string,
    householdId: string,
    userId: string | null
  ) {
    // Use repository method that checks both transaction and account visibility
    const transaction = await transactionRepository.findByIdWithVisibility(
      transactionId,
      householdId,
      userId ?? ""
    );

    if (!transaction) {
      throw new NotFoundError(NOT_VISIBLE);
    }

    return transaction;
  }

  async getLinkedTransactions(goalId: string, actor: HouseholdContext) {
    await this.getGoal(goalId, actor.householdId);

    const rows = await db
      .select({ link: transactionGoalLinks, transaction: transactions })
      .from(transactionGoalLinks)
      .innerJoin(
        transactions,
        eq(transactionGoalLinks.transactionId, transactions.id)
      )
      .where(
        and(
          eq(transactionGoalLinks.goalId, goalId),
          visibleTransactionPredicate(actor)
        )
      )
      .orderBy(desc(transactionGoalLinks.linkedAt));

    return rows.map((row) => ({
      ...row.link,
      transaction: row.transaction,
    }));
  }

  async getLinksForTransaction(transactionId: string, actor: HouseholdContext) {
    const [visibleTransaction] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), visibleTransactionPredicate(actor)))
      .limit(1);

    if (!visibleTransaction) {
      throw new NotFoundError("Transaction");
    }

    const rows = await db
      .select({
        link: transactionGoalLinks,
        goal: {
          id: goals.id,
          name: goals.name,
          type: goals.type,
          goalType: goals.goalType,
          icon: goals.icon,
          color: goals.color,
          customImageUrl: goals.customImageUrl,
          currency: goals.currency,
        },
      })
      .from(transactionGoalLinks)
      .innerJoin(goals, and(
        eq(transactionGoalLinks.goalId, goals.id),
        eq(goals.householdId, actor.householdId),
      ))
      .innerJoin(transactions, eq(transactionGoalLinks.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.id, transactionId),
          visibleTransactionPredicate(actor),
        )
      )
      .orderBy(desc(transactionGoalLinks.linkedAt));

    return rows.map((row) => ({
      ...row.link,
      goal: row.goal,
    }));
  }
}

export const transactionGoalLinkService = new TransactionGoalLinkService();
