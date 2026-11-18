export type CategoryFormState = {
  name: string;
  groupId: string;
  icon: string;
  color: string;
  includeInBudget: boolean;
  rolloverEnabled: boolean;
  rolloverStartBalance: string;
};

export type GroupFormState = {
  name: string;
  type: "expenses" | "income" | "transfers";
  budgetMode: "by_category" | "by_group";
  rolloverEnabled: boolean;
};

export interface EntityOption {
  id: string;
  name: string;
}
