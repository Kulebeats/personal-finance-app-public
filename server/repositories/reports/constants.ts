/**
 * Report Repository Constants
 *
 * Shared constants for report repositories.
 */

import { accountTypeEnum } from "@shared/schema";

type AccountType = (typeof accountTypeEnum.enumValues)[number];

export const LIABILITY_ACCOUNT_TYPES: AccountType[] = [
  "credit",
  "loan",
  "mortgage",
  "other_liability",
];
