import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { isCanonicalImportDate } from "@shared/import-date";

export const SIP_AUTHORIZATION_CONTRACT_VERSION = 1;
export const SIP_AUTHORIZATION_CONTRACT_TYPE = "record_only_sip";

// Contract v1 preserves the schema vocabulary, including distinct annual tokens.
const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "quarterly",
  "semi_annually", "annually", "yearly", "custom"] as const;

export type SipAuthorizationTerms = Readonly<{
  contractVersion: typeof SIP_AUTHORIZATION_CONTRACT_VERSION;
  contractType: typeof SIP_AUTHORIZATION_CONTRACT_TYPE;
  accountId: string;
  securityId: string;
  amount: string;
  currency: string;
  frequency: typeof FREQUENCIES[number];
  initialDate: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AMOUNT = /^[0-9]+(?:\.[0-9]{1,2})?$/;
const CURRENCY = /^[A-Za-z]{3}$/;
const MAX_AMOUNT = "9999999999999.99";

function invalid(field: string): never {
  throw new Error(`Invalid SIP authorization ${field}`);
}

function requireMatch(value: unknown, pattern: RegExp, field: string): string {
  // Matching the entire value also rejects the final newline permitted by JS $.
  if (typeof value !== "string" || pattern.exec(value)?.[0] !== value) invalid(field);
  return value;
}

function normalizeAmount(value: unknown): string {
  const amount = new Decimal(requireMatch(value, AMOUNT, "amount"));
  if (!amount.isFinite() || amount.lte(0) || amount.gt(MAX_AMOUNT)) invalid("amount");
  return amount.toFixed(2);
}

function isFrequency(value: unknown): value is SipAuthorizationTerms["frequency"] {
  return typeof value === "string" && FREQUENCIES.some(token => token === value);
}

/** Normalized retained evidence; these terms alone grant no execution authority. */
export function normalizeSipAuthorizationTerms(input: unknown): SipAuthorizationTerms {
  if (input === null || typeof input !== "object" || Array.isArray(input)) invalid("terms");
  const { contractVersion, contractType, accountId, securityId, amount, currency,
    frequency, initialDate } = input as Record<string, unknown>;

  if (contractVersion !== SIP_AUTHORIZATION_CONTRACT_VERSION) invalid("contractVersion");
  if (contractType !== SIP_AUTHORIZATION_CONTRACT_TYPE) invalid("contractType");
  if (!isFrequency(frequency)) invalid("frequency");
  if (typeof initialDate !== "string" || initialDate.startsWith("0000-") ||
      !isCanonicalImportDate(initialDate)) invalid("initialDate");

  return Object.freeze({
    contractVersion,
    contractType,
    accountId: requireMatch(accountId, UUID, "accountId").toLowerCase(),
    securityId: requireMatch(securityId, UUID, "securityId").toLowerCase(),
    amount: normalizeAmount(amount),
    currency: requireMatch(currency, CURRENCY, "currency").toUpperCase(),
    frequency,
    initialDate,
  });
}

export function serializeSipAuthorizationTerms(input: unknown): string {
  const terms = normalizeSipAuthorizationTerms(input);
  return JSON.stringify([
    terms.contractVersion, terms.contractType, terms.accountId, terms.securityId,
    terms.amount, terms.currency, terms.frequency, terms.initialDate,
  ]);
}

export function digestSipAuthorizationTerms(input: unknown): string {
  return createHash("sha256").update(serializeSipAuthorizationTerms(input), "utf8").digest("hex");
}
