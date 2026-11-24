import type { MoneyDto } from "./money";

export interface PerformanceDataPoint {
  date: string;
  value: MoneyDto;
  benchmark?: number;
  twrIndex?: number;
  twrReturnPercent?: number;
}
