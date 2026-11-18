import type { Account } from "@/lib/api";
import { toMoneyNumber } from "@/lib/money";

const isPropertyOrVehicle = (type: Account["type"]) =>
  type === "real_estate" || type === "vehicle";

export const getAccountDisplayValue = (account: Account): string => {
  const hasEstimatedValue =
    account.estimatedValue !== null &&
    account.estimatedValue !== undefined &&
    account.estimatedValue !== "";

  if (isPropertyOrVehicle(account.type) && hasEstimatedValue) {
    return account.estimatedValue as string;
  }

  return account.balance;
};

export const getAccountDisplayNumber = (account: Account): number =>
  toMoneyNumber(getAccountDisplayValue(account));
