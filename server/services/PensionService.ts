import { db } from "../db";
import {
  accounts,
  households,
  pensionHoldings,
  pensionContributions,
  type InsertPensionHolding,
  type PensionHolding,
} from "@shared/schema";
import { eq, and, isNull, or, type SQL } from "drizzle-orm";
import { Money } from "../core/money";
import { NotFoundError, ValidationError } from "../core/errors";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { businessAuditService } from "./BusinessAuditService";
import type { PensionContributionInput } from "../routes/investment-pension.validation";
import type { HouseholdContext } from "../core/authz/implicit-household-context";
import { readableMembershipPredicate, visibleAccountPredicate } from "../core/authz/transaction-visibility";
import { lockInvestmentWriterIdentity, type InvestmentSourceSession } from "../modules/investments/investmentTransactionAccess";

type PensionWriter = { actor: HouseholdContext; session: InvestmentSourceSession; ipAddress?: string };

/**
 * A-56: a pension carries the custody of its account, like other holdings. One
 * in a private account is its owner's; one with no account is the household's.
 * Callers left-join `accounts` on the holding's account.
 */
function visiblePensionPredicate(actor: HouseholdContext): SQL {
  return and(
    eq(pensionHoldings.householdId, actor.householdId),
    or(
      and(isNull(pensionHoldings.accountId), readableMembershipPredicate(actor)),
      visibleAccountPredicate(actor),
    ),
  )!;
}

async function lockPensionCustody(tx: TransactionType, actor: HouseholdContext, id: string, resource: string) {
  const [account] = await tx.select({ currency: accounts.currency, isPrivate: accounts.isPrivate })
    .from(accounts).where(and(eq(accounts.id, id), visibleAccountPredicate(actor))).for("share");
  if (!account) throw new NotFoundError(resource);
  return account;
}

export class PensionService {
  async getHoldings(actor: HouseholdContext): Promise<PensionHolding[]> {
    const rows = await db
      .select({ holding: pensionHoldings })
      .from(pensionHoldings)
      .leftJoin(accounts, eq(accounts.id, pensionHoldings.accountId))
      .where(visiblePensionPredicate(actor));
    return rows.map((row) => row.holding);
  }

  // FIX AUTH-PENSION-001 + A-56: only a holding the actor can see; else 404.
  async getContributions(pensionHoldingId: string, actor: HouseholdContext) {
    const rows = await db
      .select({ contribution: pensionContributions })
      .from(pensionHoldings)
      .leftJoin(accounts, eq(accounts.id, pensionHoldings.accountId))
      .leftJoin(pensionContributions, eq(pensionContributions.pensionHoldingId, pensionHoldings.id))
      .where(and(eq(pensionHoldings.id, pensionHoldingId), visiblePensionPredicate(actor)))
      .orderBy(pensionContributions.date);

    if (!rows.length) throw new NotFoundError("Pension holding");
    return rows.flatMap(({ contribution }) => contribution ? [contribution] : []);
  }

  // FIX AUTH-PENSION-002: Validate account ownership before creating holding.
  // NEW-32: the holding and its audit row commit together (Rule 9).
  async addHolding(
    data: InsertPensionHolding,
    context: PensionWriter,
  ) {
    return withTransaction(async (tx) => {
      const actor = await lockInvestmentWriterIdentity(tx, context.actor, context.session);
      const householdId = actor.householdId;
      const custody = data.accountId ? await lockPensionCustody(tx, actor, data.accountId, "Account") : null;
      const [holding] = await tx.insert(pensionHoldings).values({ ...data, householdId }).returning();
      await businessAuditService.logCreate({
        tx,
        userId: actor.userId,
        householdId: custody?.isPrivate ? null : householdId,
        entityType: "pension_holding",
        entityId: holding.id,
        ipAddress: context.ipAddress,
        newValue: {
          providerName: holding.providerName, pensionType: holding.pensionType,
          accountId: holding.accountId, currentBalance: holding.currentBalance,
        },
      });
      return holding;
    });
  }

  /**
   * Record a contribution (NEW-24). One database transaction: the holding is
   * locked FOR UPDATE before its balance is read and changed, and the audit row
   * is written through the same `tx`, so a failed audit undoes the whole write.
   */
  async addContribution(
    input: PensionContributionInput,
    context: PensionWriter & { pensionHoldingId: string },
  ) {
    return withTransaction(async (tx) => {
      // Match the investment writer's order: household, member and session,
      // then holding and custody account. Keep both locks through the audit.
      const actor = await lockInvestmentWriterIdentity(tx, context.actor, context.session);
      const [holding] = await tx
        .select()
        .from(pensionHoldings)
        .where(and(eq(pensionHoldings.id, context.pensionHoldingId), eq(pensionHoldings.householdId, actor.householdId)))
        .for("update")
        .limit(1);
      if (!holding) throw new NotFoundError("Pension holding");
      const custody = holding.accountId ? await lockPensionCustody(tx, actor, holding.accountId, "Pension holding") : null;
      const currency = custody?.currency ?? await this.householdCurrency(tx, actor.householdId);
      if (input.totalContribution.currency !== currency) {
        throw new ValidationError(`Contribution currency must be ${currency}`, [
          { field: "totalContribution.currency", message: `Must match the pension's currency (${currency})` },
        ]);
      }

      const [contribution] = await tx.insert(pensionContributions).values({
        pensionHoldingId: holding.id,
        date: input.date,
        employeeContribution: input.employeeContribution.amount,
        employerContribution: input.employerContribution.amount,
        totalContribution: input.totalContribution.amount,
      }).returning();

      // FIX DATA-PENSION-002: Use Money class for precise balance updates
      const balanceBefore = new Money(holding.currentBalance || "0", currency);
      const balanceAfter = balanceBefore.add(new Money(input.totalContribution.amount, currency));
      await tx
        .update(pensionHoldings)
        .set({ currentBalance: balanceAfter.toString(), updatedAt: new Date() })
        .where(eq(pensionHoldings.id, holding.id));

      await businessAuditService.logCreate({
        tx,
        userId: actor.userId,
        householdId: custody?.isPrivate ? null : actor.householdId,
        entityType: "pension_contribution",
        entityId: contribution.id,
        newValue: {
          date: contribution.date,
          employeeContribution: contribution.employeeContribution,
          employerContribution: contribution.employerContribution,
          totalContribution: contribution.totalContribution,
          currency,
        },
        ipAddress: context.ipAddress,
        metadata: {
          pensionHoldingId: holding.id,
          balanceBefore: balanceBefore.toString(),
          balanceAfter: balanceAfter.toString(),
          // A contribution moves the pension balance only; no ledger cash is posted (NEW-24).
          cashMoved: false,
        },
      });
      return { ...contribution, cashMoved: false as const };
    });
  }

  /** Accountless holdings use the household currency. */
  private async householdCurrency(tx: TransactionType, householdId: string): Promise<string> {
    const [household] = await tx.select({ currency: households.currency }).from(households)
      .where(eq(households.id, householdId)).limit(1);
    return household?.currency ?? "ZMW";
  }
}

export const pensionService = new PensionService();
