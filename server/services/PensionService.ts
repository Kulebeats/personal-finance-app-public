import { db } from "../db";
import {
  pensionHoldings,
  pensionContributions,
  type InsertPensionHolding,
  type InsertPensionContribution,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { accountRepository } from "../repositories/AccountRepository";
import { Money } from "../core/money";

export class PensionService {
  async getHoldings(householdId: string) {
    return await db
      .select()
      .from(pensionHoldings)
      .where(eq(pensionHoldings.householdId, householdId));
  }

  // FIX AUTH-PENSION-001: Enforce household isolation for contributions
  async getContributions(pensionHoldingId: string, householdId: string) {
    // First verify the holding belongs to the household
    const [holding] = await db
      .select()
      .from(pensionHoldings)
      .where(
        and(
          eq(pensionHoldings.id, pensionHoldingId),
          eq(pensionHoldings.householdId, householdId)
        )
      )
      .limit(1);

    if (!holding) {
      throw new Error("Pension holding not found or access denied");
    }

    return await db
      .select()
      .from(pensionContributions)
      .where(eq(pensionContributions.pensionHoldingId, pensionHoldingId))
      .orderBy(pensionContributions.date);
  }

  // FIX AUTH-PENSION-002: Validate account ownership before creating holding
  async addHolding(data: InsertPensionHolding, householdId: string) {
    // Validate accountId belongs to household if provided
    if (data.accountId) {
      const account = await accountRepository.findById(
        data.accountId,
        householdId
      );
      if (!account) {
        throw new Error(
          "Account not found or does not belong to this household"
        );
      }
    }

    const [holding] = await db.insert(pensionHoldings).values(data).returning();
    return holding;
  }

  // FIX AUTH-PENSION-001: Verify holding ownership before adding contribution
  async addContribution(data: InsertPensionContribution, householdId: string) {
    // Verify the holding belongs to this household
    const [holding] = await db
      .select()
      .from(pensionHoldings)
      .where(
        and(
          eq(pensionHoldings.id, data.pensionHoldingId),
          eq(pensionHoldings.householdId, householdId)
        )
      )
      .limit(1);

    if (!holding) {
      throw new Error("Pension holding not found or access denied");
    }

    const [contribution] = await db
      .insert(pensionContributions)
      .values(data)
      .returning();

    // FIX DATA-PENSION-002: Use Money class for precise balance updates
    const currentBalanceMoney = new Money(holding.currentBalance || "0");
    const contributionMoney = new Money(data.totalContribution);
    const newBalanceMoney = currentBalanceMoney.add(contributionMoney);

    await db
      .update(pensionHoldings)
      .set({ currentBalance: newBalanceMoney.toString() })
      .where(eq(pensionHoldings.id, data.pensionHoldingId));

    return contribution;
  }
}

export const pensionService = new PensionService();
