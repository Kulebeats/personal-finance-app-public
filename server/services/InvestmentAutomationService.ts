import { db } from "../db";
import { recurringExecutionLog } from "@shared/schema";
import type { HouseholdContext } from "../middleware/householdGuard";
import type { InvestmentSourceSession } from "../modules/investments/investmentTransactionAccess";
import { createAuthorizedSipPlan, deactivateVisibleSipPlan, getVisibleSipPlans, reconfirmAuthorizedSipPlan } from "./investment/sipPlanAuthorization";
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
  async getActivePlans(caller: HouseholdContext, session: InvestmentSourceSession) {
    return (await getVisibleSipPlans(caller, session)).filter(plan => plan.isActive);
  }

  async getAllPlans(caller: HouseholdContext, session: InvestmentSourceSession) {
    return getVisibleSipPlans(caller, session);
  }

  async createPlan(data: unknown, caller: HouseholdContext, session: InvestmentSourceSession) {
    return createAuthorizedSipPlan(data, caller, session);
  }

  async authorizePlan(id: string, data: unknown, caller: HouseholdContext, session: InvestmentSourceSession) {
    return reconfirmAuthorizedSipPlan(id, data, caller, session);
  }

  async deactivatePlan(id: string, caller: HouseholdContext, session: InvestmentSourceSession) {
    return deactivateVisibleSipPlan(id, caller, session);
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
