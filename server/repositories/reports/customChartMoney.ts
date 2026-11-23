// Custom chart values and totals (Rule 1).
//
// The chart's values come from the report repositories already converted to
// the household currency. They are added and averaged in Decimal, as Money
// amounts (or, for the savings rate, as percentages), and become numbers only
// at the response edge. A value in any other currency has no exchange rate
// behind it: it is refused as a missing rate, never added at 1.
import Decimal from "decimal.js";
import type { MoneyDto } from "@shared/money";
import { CalculationError } from "../../core/calculations/errors";
import { moneyFromDto } from "./moneyUtils";

export interface ChartRow {
  label: string;
  primary: Decimal;
  secondary?: Decimal;
  groupKey?: string;
}

export interface ChartPoint {
  label: string;
  primary: number;
  secondary?: number;
  groupKey?: string;
}

export interface ChartTotals {
  primary: number;
  secondary: number | undefined;
  average: number;
}

// A value in the household currency, as its Money amount.
export function chartAmount(value: MoneyDto | null | undefined, currency: string): Decimal {
  if (value?.currency && value.currency !== currency) {
    throw new CalculationError("MISSING_FX_RATE", { from: value.currency, to: currency, functionName: "executeCustomChart" });
  }
  return moneyFromDto(value, currency).amount;
}

// A percentage the chart plots (the savings rate): not money, but summed exactly too.
export function chartPercent(value: number | null | undefined): Decimal {
  return new Decimal(value ?? 0);
}

// The response's points: numbers only here, at the edge.
export function chartPoints(rows: readonly ChartRow[]): ChartPoint[] {
  return rows.map(({ label, primary, secondary, groupKey }) => ({
    label,
    primary: primary.toNumber(),
    ...(secondary !== undefined && { secondary: secondary.toNumber() }),
    ...(groupKey !== undefined && { groupKey }),
  }));
}

const sum = (values: readonly Decimal[]): Decimal => values.reduce((acc, value) => acc.plus(value), new Decimal(0));

// The chart's totals. A grouped chart passes the breakdown's own total, which
// also counts groups past the 25 it shows; the average is over the points
// shown, rounded half up to the cent.
export function chartTotals(rows: readonly ChartRow[], hasSecondary: boolean, total?: Decimal): ChartTotals {
  const primary = total ?? sum(rows.map((row) => row.primary));
  return {
    primary: primary.toNumber(),
    secondary: hasSecondary ? sum(rows.map((row) => row.secondary ?? new Decimal(0))).toNumber() : undefined,
    average: rows.length > 0 ? primary.div(rows.length).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber() : 0,
  };
}
