import { db } from "../db";
import {
  recurringInvestments,
  recurringExecutionLog,
  type InsertRecurringInvestment,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { accountRepository } from "../repositories/AccountRepository";
import {
  getDuePlans,
  processDueInvestments,
  type SipExecutionResults,
} from "./investment/processDueInvestments";
import {
  processTBillMaturities,
  type TBillMaturityResults,
} from "./investment/processTBillMaturities";

/**
 * Investment automation: recurring SIP/rollover plan CRUD, plus the daily
 * cron cycle (T-Bill maturities + due-plan execution).
 *
 * R6: the cron cycle's per-item processing (locking, idempotency, audit) was
 * split out into server/services/investment/ so this file stays under the
 * server/services LOC limit; see processTBillMaturities.ts and
 * processDueInvestments.ts for the concurrency-safe implementations.
 */
export class InvestmentAutomationService {
  async getActivePlans(householdId: string) {
    return await db
      .select()
      .from(recurringInvestments)
      .where(
        and(
          eq(recurringInvestments.householdId, householdId),
          eq(recurringInvestments.isActive, true)
        )
      );
  }

  async getAllPlans(householdId: string) {
    return await db
      .select()
      .from(recurringInvestments)
      .where(eq(recurringInvestments.householdId, householdId));
  }

  // FIX AUTH-INV-REC-002: Validate account ownership before creating plan
  async createPlan(data: InsertRecurringInvestment, householdId: string) {
    // Validate accountId belongs to household
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

    const [plan] = await db
      .insert(recurringInvestments)
      .values(data)
      .returning();
    return plan;
  }

  // FIX AUTH-INV-REC-001: Enforce household isolation when deactivating plan
  async deactivatePlan(id: string, householdId: string) {
    // Verify the plan belongs to this household
    const [plan] = await db
      .select()
      .from(recurringInvestments)
      .where(
        and(
          eq(recurringInvestments.id, id),
          eq(recurringInvestments.householdId, householdId)
        )
      )
      .limit(1);

    if (!plan) {
      throw new Error("Recurring plan not found or access denied");
    }

    await db
      .update(recurringInvestments)
      .set({ isActive: false })
      .where(eq(recurringInvestments.id, id));
  }

  async logExecution(data: typeof recurringExecutionLog.$inferInsert) {
    const [log] = await db
      .insert(recurringExecutionLog)
      .values(data)
      .returning();
    return log;
  }

  // Logic for daily cron/worker to find due plans
  async getDuePlans() {
    return getDuePlans();
  }

  /**
   * Process T-Bill Maturities (Step 1 of Daily Cycle). Locked, idempotent,
   * audited — see server/services/investment/processTBillMaturities.ts.
   */
  async processTBillMaturities(): Promise<TBillMaturityResults> {
    return processTBillMaturities();
  }

  /**
   * Process all due recurring investment plans (SIP buys + T-Bill
   * rollovers). Locked, idempotent — see
   * server/services/investment/processDueInvestments.ts.
   */
  async processDueInvestments(): Promise<SipExecutionResults> {
    return processDueInvestments();
  }
}

export const investmentAutomationService = new InvestmentAutomationService();
