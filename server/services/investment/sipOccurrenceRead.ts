import Decimal from "decimal.js";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { investmentSipConfirmations, investmentSipConfirmedFills,
  investmentSipOccurrenceFences, investmentSipOccurrences, securities } from "@shared/schema";
import { can } from "../../core/authz/capabilities";
import { InternalError, NotFoundError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { InvestmentSourceSession } from "../../modules/investments/investmentTransactionAccess";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { lockSipPlanReader } from "./sipPlanAccess";
import { lockSipOccurrencePlan, visibleSipOccurrenceAccount, type SipOccurrence } from "./sipOccurrenceAccess";
import { safeSipOccurrenceError } from "./sipOccurrenceErrors";

const Exact = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
export type SipOccurrenceReceipt = typeof investmentSipConfirmations.$inferSelect;
export interface SipOccurrenceListQuery {
  state: "all" | "pending" | "closed";
  limit: number;
  before?: string;
}
export interface SipOccurrencePlanned {
  accountId: string;
  securityId: string;
  amount: string;
  currency: string;
  authorizedFrequency: string;
  authorizedInitialDate: string;
}
export interface SipOccurrenceResultFill {
  fillIndex: number;
  purchaseId: string;
  executionDate: string;
  quantity: string;
  price: string;
  fees: string;
  amount: string;
}
export interface SipOccurrenceDetailedClosed {
  planId: string;
  scheduledDate: string;
  state: "closed";
  detailsAvailable: true;
  occurrenceRevision: 1;
  planned: SipOccurrencePlanned;
  result: {
    outcome: "filled" | "partially_filled" | "unfilled";
    fills: SipOccurrenceResultFill[];
    totals: { grossAmount: string; fees: string; amount: string };
  };
}
export type SipOccurrenceRead = SipOccurrenceDetailedClosed | {
  planId: string;
  scheduledDate: string;
  state: "pending";
  detailsAvailable: true;
  occurrenceRevision: 0;
  planned: SipOccurrencePlanned;
  permittedActions: Array<"confirm">;
} | {
  planId: string;
  scheduledDate: string;
  state: "closed";
  detailsAvailable: false;
};

function planned(occurrence: SipOccurrence): SipOccurrencePlanned {
  return {
    accountId: occurrence.accountId, securityId: occurrence.securityId,
    amount: occurrence.plannedAmount, currency: occurrence.currency,
    authorizedFrequency: occurrence.authorizedFrequency,
    authorizedInitialDate: occurrence.authorizedInitialDate,
  };
}

export async function readClosedSipOccurrence(tx: TransactionType, occurrence: SipOccurrence,
  receipt?: SipOccurrenceReceipt): Promise<SipOccurrenceDetailedClosed> {
  const [recorded] = receipt ? [receipt] : await tx.select().from(investmentSipConfirmations).where(and(
    eq(investmentSipConfirmations.planId, occurrence.planId),
    eq(investmentSipConfirmations.originalDueDate, occurrence.originalDueDate),
    eq(investmentSipConfirmations.householdId, occurrence.householdId),
  ));
  if (!recorded || occurrence.state !== "closed" || occurrence.occurrenceRevision !== 1) {
    throw new InternalError("Recorded occurrence details are unavailable.");
  }
  const rows = await tx.select().from(investmentSipConfirmedFills)
    .where(eq(investmentSipConfirmedFills.confirmationId, recorded.id)).orderBy(asc(investmentSipConfirmedFills.fillIndex));
  if (rows.length !== recorded.fillCount || rows.some((row, index) => row.fillIndex !== index || !row.postingConfirmed)) {
    throw new InternalError("Recorded occurrence details are unavailable.");
  }
  const outcome = recorded.outcome;
  if (outcome !== "filled" && outcome !== "partially_filled" && outcome !== "unfilled") {
    throw new InternalError("Recorded occurrence details are unavailable.");
  }
  let gross = new Exact(0);
  let fees = new Exact(0);
  let amount = new Exact(0);
  const fills = rows.map(row => {
    gross = gross.plus(new Exact(row.quantity).times(row.price).toDecimalPlaces(2));
    fees = fees.plus(row.fees);
    amount = amount.plus(row.amount);
    return { fillIndex: row.fillIndex, purchaseId: row.purchaseId, executionDate: row.executionDate,
      quantity: row.quantity, price: row.price, fees: row.fees, amount: row.amount };
  });
  return {
    planId: occurrence.planId, scheduledDate: occurrence.originalDueDate,
    state: "closed", detailsAvailable: true, occurrenceRevision: 1, planned: planned(occurrence),
    result: { outcome, fills, totals: { grossAmount: gross.toFixed(2), fees: fees.toFixed(2), amount: amount.toFixed(2) } },
  };
}

export async function listSipOccurrences(planId: string, query: SipOccurrenceListQuery,
  caller: HouseholdContext, session: InvestmentSourceSession) {
  try {
    return await withTransaction(async tx => {
      const actor = await lockSipPlanReader(tx, caller, session);
      const plan = await lockSipOccurrencePlan(tx, actor, planId, "share");
      await visibleSipOccurrenceAccount(tx, actor, plan.accountId, true);
      const rows = await tx.select({ fence: investmentSipOccurrenceFences, occurrence: investmentSipOccurrences })
        .from(investmentSipOccurrenceFences).leftJoin(investmentSipOccurrences, and(
          eq(investmentSipOccurrences.planId, investmentSipOccurrenceFences.planId),
          eq(investmentSipOccurrences.originalDueDate, investmentSipOccurrenceFences.originalDueDate),
        )).where(and(
          eq(investmentSipOccurrenceFences.planId, plan.id),
          query.before ? lt(investmentSipOccurrenceFences.originalDueDate, query.before) : undefined,
          query.state === "all" ? undefined : eq(investmentSipOccurrenceFences.terminal, query.state === "closed"),
        )).orderBy(desc(investmentSipOccurrenceFences.originalDueDate)).limit(query.limit + 1);
      const data: SipOccurrenceRead[] = [];
      for (const row of rows.slice(0, query.limit)) {
        const occurrence = row.occurrence;
        if (!occurrence) {
          if (!row.fence.terminal) throw new InternalError("Pending occurrence details are unavailable.");
          data.push({ planId: plan.id, scheduledDate: row.fence.originalDueDate, state: "closed", detailsAvailable: false });
          continue;
        }
        if (occurrence.accountId !== plan.accountId || occurrence.householdId !== actor.householdId) {
          throw new NotFoundError("Investment occurrence");
        }
        if (row.fence.terminal) {
          data.push(await readClosedSipOccurrence(tx, occurrence));
          continue;
        }
        if (occurrence.state !== "pending" || occurrence.occurrenceRevision !== 0) {
          throw new InternalError("Pending occurrence details are unavailable.");
        }
        const [security] = await tx.select({ type: securities.type, currency: securities.currency }).from(securities)
          .where(eq(securities.id, occurrence.securityId));
        data.push({ planId: plan.id, scheduledDate: occurrence.originalDueDate, state: "pending", detailsAvailable: true,
          occurrenceRevision: 0, planned: planned(occurrence),
          permittedActions: can(actor.role, "financial.write") && security && security.type !== "tbill"
            && security.currency === occurrence.currency ? ["confirm"] : [] });
      }
      const hasMore = rows.length > query.limit;
      return { data, pagination: { hasMore, nextBefore: hasMore ? data[data.length - 1].scheduledDate : null } };
    });
  } catch (error) {
    throw safeSipOccurrenceError(error);
  }
}
