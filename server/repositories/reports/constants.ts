/**
 * Report Repository Constants
 *
 * Shared constants for report repositories.
 */

import { accountTypeEnum } from "@shared/schema";

export type AccountType = (typeof accountTypeEnum.enumValues)[number];

/** Accounts whose balance counts as liquid assets in the financial ratios. */
export const LIQUID_ACCOUNT_TYPES: AccountType[] = [
  "checking",
  "savings",
  "cash",
  "mobile_money",
];

export const LIABILITY_ACCOUNT_TYPES: AccountType[] = [
  "credit",
  "loan",
  "mortgage",
  "other_liability",
];
