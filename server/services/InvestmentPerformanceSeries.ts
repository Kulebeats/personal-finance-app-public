import Decimal from "decimal.js";
import { differenceInCalendarDays } from "date-fns";
import type { PerformanceDataPoint } from "@shared/investment-performance";
import { Money, toMoneyDto } from "../core/money";

export type { PerformanceDataPoint } from "@shared/investment-performance";

export interface PerformanceSnapshot {
  date: string;
  balance: string;
}

// A-08: the flow amount is already in the snapshots' reporting currency.
export interface PerformanceFlow {
  date: string;
  type: "transfer_in" | "transfer_out";
  amount: string;
}

const INDEX_BASE = new Decimal(100);
const INDEX_PLACES = 4;

/** Exact per-date totals in the same reporting currency as the flows. */
function totalsByDate(snapshots: readonly PerformanceSnapshot[], currency: string): Map<string, Money> {
  const totals = new Map<string, Money>();
  for (const snapshot of snapshots) {
    totals.set(snapshot.date, (totals.get(snapshot.date) ?? Money.zero(currency)).add(snapshot.balance));
  }
  return totals;
}

function signedFlowsByDate(flows: readonly PerformanceFlow[]): Map<string, Decimal> {
  const byDate = new Map<string, Decimal>();
  for (const flow of flows) {
    const magnitude = new Decimal(flow.amount).abs();
    const signed = flow.type === "transfer_out" ? magnitude.negated() : magnitude;
    byDate.set(flow.date, (byDate.get(flow.date) ?? new Decimal(0)).plus(signed));
  }
  return byDate;
}

/** Modified Dietz return for one period, flows weighted by days remaining. */
function periodReturn(prevDate: string, prevValue: Decimal, date: string, value: Decimal, flows: Map<string, Decimal>): Decimal {
  const periodDays = Math.max(1, differenceInCalendarDays(new Date(date), new Date(prevDate)));
  let netFlow = new Decimal(0);
  let weightedFlow = new Decimal(0);
  for (const [flowDate, amount] of flows) {
    if (flowDate <= prevDate || flowDate > date) continue;
    const daysToEnd = differenceInCalendarDays(new Date(date), new Date(flowDate));
    netFlow = netFlow.plus(amount);
    weightedFlow = weightedFlow.plus(amount.times(daysToEnd).dividedBy(periodDays));
  }
  const denominator = prevValue.plus(weightedFlow);
  return denominator.isZero() ? new Decimal(0) : value.minus(prevValue).minus(netFlow).dividedBy(denominator);
}

/** Pure: the caller has already restricted both inputs to visible accounts. */
export function buildPerformanceSeries(
  snapshots: readonly PerformanceSnapshot[],
  flows: readonly PerformanceFlow[],
  currency: string,
): PerformanceDataPoint[] {
  const totals = totalsByDate(snapshots, currency);
  const dates = Array.from(totals.keys()).sort((a, b) => a.localeCompare(b));
  const flowsByDate = signedFlowsByDate(flows);
  let index = INDEX_BASE;
  return dates.map((date, position) => {
    const value = totals.get(date)!;
    if (position === 0) return { date, value: toMoneyDto(value), twrIndex: 100, twrReturnPercent: 0 };
    const prevDate = dates[position - 1];
    const growth = periodReturn(prevDate, totals.get(prevDate)!.amount, date, value.amount, flowsByDate);
    index = index.times(growth.plus(1));
    return {
      date,
      value: toMoneyDto(value),
      twrIndex: index.toDecimalPlaces(INDEX_PLACES).toNumber(),
      twrReturnPercent: index.minus(INDEX_BASE).toDecimalPlaces(INDEX_PLACES).toNumber(),
    };
  });
}
