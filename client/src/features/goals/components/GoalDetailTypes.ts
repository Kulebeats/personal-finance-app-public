export type DebtStrategyResult = Array<{
  debtId: string;
  payoffOrder: number;
  payoffDate: string | null;
}>;

export type ScenarioKey =
  | "minimum"
  | "current"
  | "accelerated"
  | "aggressive"
  | "custom";

export type StrategyRow = {
  id: string;
  order: number;
  name: string;
  balance: number | null;
  payoffDate: string | null;
};
