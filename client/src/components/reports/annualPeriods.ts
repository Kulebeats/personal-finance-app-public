/**
 * Annual-dashboard period adapter (spec R12.3).
 *
 * Groups the annual report's monthly rows into months, quarters, halves or the
 * year by each row's `periodStart` (YYYY-MM-DD). It never parses a display
 * label or trusts an array position, and it sums MoneyDto values with Decimal
 * precision, so a quarter always equals the sum of its months.
 */
import type { MoneyDto } from "@shared/money";
import { sumMoneyDto } from "@/lib/money";

export type PeriodGrouping = "monthly" | "quarterly" | "biannual" | "annual";

export interface PeriodRow {
  readonly periodStart: string;
}

export interface PeriodBucket<T extends PeriodRow> {
  readonly label: string;
  /** First day of the bucket (YYYY-MM-DD). */
  readonly periodStart: string;
  /** Last day of the bucket (YYYY-MM-DD). */
  readonly periodEnd: string;
  readonly rows: readonly T[];
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_PER_BUCKET: Record<PeriodGrouping, number> = { monthly: 1, quarterly: 3, biannual: 6, annual: 12 };
const PERIOD_START = /^(\d{4})-(\d{2})-01$/;

const pad = (value: number) => String(value).padStart(2, "0");

/** Year and calendar month (1-12) of a period start; throws on anything else. */
export function parsePeriodStart(periodStart: string): { year: number; month: number } {
  const match = PERIOD_START.exec(periodStart);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) throw new Error(`Invalid month periodStart: ${periodStart}`);
  return { year: Number(match[1]), month };
}

/** Last day of the given month as YYYY-MM-DD, with no time-zone shift. */
export function monthEnd(year: number, month: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(lastDay)}`;
}

function bucketLabel(grouping: PeriodGrouping, year: number, index: number): string {
  if (grouping === "monthly") return MONTH_LABELS[index];
  if (grouping === "quarterly") return `Q${index + 1}`;
  if (grouping === "biannual") return `H${index + 1}`;
  return String(year);
}

/**
 * Groups monthly rows by calendar month. Buckets come out in calendar order;
 * only buckets with at least one row are returned.
 */
export function groupByPeriod<T extends PeriodRow>(rows: readonly T[], grouping: PeriodGrouping): PeriodBucket<T>[] {
  const size = MONTHS_PER_BUCKET[grouping];
  const buckets = new Map<string, { year: number; index: number; rows: T[] }>();
  for (const row of rows) {
    const { year, month } = parsePeriodStart(row.periodStart);
    const index = Math.floor((month - 1) / size);
    const key = `${year}-${pad(index)}`;
    const existing = buckets.get(key);
    buckets.set(key, { year, index, rows: [...(existing?.rows ?? []), row] });
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { year, index, rows: bucketRows }]) => {
      const firstMonth = index * size + 1;
      return {
        label: bucketLabel(grouping, year, index),
        periodStart: `${year}-${pad(firstMonth)}-01`,
        periodEnd: monthEnd(year, firstMonth + size - 1),
        rows: bucketRows,
      };
    });
}

/** Decimal-exact sum of one MoneyDto field across a bucket's rows. */
export function sumField<T extends PeriodRow>(bucket: PeriodBucket<T>, pick: (row: T) => MoneyDto): MoneyDto {
  return sumMoneyDto(bucket.rows.map(pick));
}

/** The from/to dates of the month a row starts, for drill-down. */
export function monthRangeOf(periodStart: string): { from: string; to: string } {
  const { year, month } = parsePeriodStart(periodStart);
  return { from: periodStart, to: monthEnd(year, month) };
}
