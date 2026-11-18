export interface CashFlowFiltersState {
  from: string;
  to: string;
  interval: "day" | "week" | "month";
  scope: "household" | "mine";
  includePending: boolean;
  includeTransfers: boolean;
  includeForecast: boolean;
  forecastMonths: number;
}
