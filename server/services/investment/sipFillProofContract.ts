import { createHash } from "node:crypto";
import {
  calculateSipFillEconomics,
  canonicalSipOccurrenceCurrency,
  canonicalSipOccurrenceDate,
  canonicalSipOccurrenceUuid,
  normalizeSipOccurrenceFill,
  SipOccurrenceContractError,
} from "@shared/sip-occurrence-contract";
import { convertAtStoredRate } from "../../modules/investments/investmentDatedFx";

export const SIP_FILL_PROOF_CONTRACT_VERSION = 2;
export const SIP_FILL_PROOF_CONTRACT_TYPE = "record_only_sip_actual_fill";
const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "semi_annually", "annually", "yearly"] as const;

export type SipFillProofTerms = Readonly<{
  contractVersion: typeof SIP_FILL_PROOF_CONTRACT_VERSION;
  contractType: typeof SIP_FILL_PROOF_CONTRACT_TYPE;
  accountId: string;
  securityId: string;
  quantity: string;
  price: string;
  fees: string;
  amount: string;
  currency: string;
  executionDate: string;
  authorizedFrequency: typeof FREQUENCIES[number];
  authorizedInitialDate: string;
  /** Both null for a ZMW (or legacy) fill; both set from the dated rate for a foreign fill (#236 F1). */
  fxRate: string | null;
  amountZmw: string | null;
}>;

function invalid(field: string): never {
  throw new SipOccurrenceContractError(field, "Invalid retained actual-fill proof terms");
}

const RATE = /^(?:0|[1-9]\d{0,9})\.\d{8}$/, BASE = /^(?:0|[1-9]\d{0,12})\.\d{2}$/;
/** The stored dated conversion of a foreign fill, exactly as the columns render it. */
function normalizeFillConversion(fxRate: unknown, amountZmw: unknown, currency: unknown) {
  if (fxRate === null && amountZmw === null) return { fxRate: null, amountZmw: null };
  if (currency === "ZMW" || typeof fxRate !== "string" || typeof amountZmw !== "string" || !RATE.test(fxRate) || !BASE.test(amountZmw)
    || /^0\.0+$/.test(fxRate)) invalid("fxRate");
  return { fxRate, amountZmw };
}

export function normalizeSipFillProofTerms(input: unknown): SipFillProofTerms {
  const allowed = ["contractVersion", "contractType", "accountId", "securityId", "quantity", "price", "fees", "amount",
    "currency", "executionDate", "authorizedFrequency", "authorizedInitialDate", "fxRate", "amountZmw"];
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    invalid("terms");
  }
  const row = input as Record<string, unknown>;
  if (row.contractVersion !== SIP_FILL_PROOF_CONTRACT_VERSION || row.contractType !== SIP_FILL_PROOF_CONTRACT_TYPE) invalid("contractVersion");
  const conversion = normalizeFillConversion(row.fxRate, row.amountZmw, row.currency);
  const frequency = FREQUENCIES.find(value => value === row.authorizedFrequency);
  if (!frequency) invalid("authorizedFrequency");
  const fill = normalizeSipOccurrenceFill({ executionDate: row.executionDate, quantity: row.quantity, price: row.price, fees: row.fees });
  const economics = calculateSipFillEconomics(fill);
  if (typeof row.amount !== "string" || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(row.amount)
      || row.amount.includes("\n") || row.amount.includes("\r")) invalid("amount");
  const fixed = row.amount.includes(".") ? `${row.amount.split(".")[0]}.${row.amount.split(".")[1].padEnd(2, "0")}` : `${row.amount}.00`;
  // Compare canonical decimal strings without number conversion or invented rounding.
  if (fixed.replace(/^0+(?=\d)/, "") !== economics.amount) invalid("amount");
  // #242 review P2-3: the base is the fill amount at the stated rate, the same
  // equation 0042 enforces on the stored row, not just a well-formed pair.
  if (conversion.fxRate !== null && convertAtStoredRate(economics.amount, conversion.fxRate) !== conversion.amountZmw) invalid("amountZmw");
  return Object.freeze({
    contractVersion: SIP_FILL_PROOF_CONTRACT_VERSION,
    contractType: SIP_FILL_PROOF_CONTRACT_TYPE,
    accountId: canonicalSipOccurrenceUuid(row.accountId, "accountId"),
    securityId: canonicalSipOccurrenceUuid(row.securityId, "securityId"),
    quantity: fill.quantity,
    price: fill.price,
    fees: fill.fees,
    amount: economics.amount,
    currency: canonicalSipOccurrenceCurrency(row.currency, "currency"),
    executionDate: fill.executionDate,
    authorizedFrequency: frequency,
    authorizedInitialDate: canonicalSipOccurrenceDate(row.authorizedInitialDate, "authorizedInitialDate"),
    fxRate: conversion.fxRate,
    amountZmw: conversion.amountZmw,
  });
}

export function serializeSipFillProofTerms(input: unknown): string {
  const terms = normalizeSipFillProofTerms(input);
  return JSON.stringify([terms.contractVersion, terms.contractType, terms.accountId, terms.securityId,
    terms.quantity, terms.price, terms.fees, terms.amount, terms.currency, terms.executionDate,
    terms.authorizedFrequency, terms.authorizedInitialDate, terms.fxRate, terms.amountZmw]);
}

export function digestSipFillProofTerms(input: unknown): string {
  return createHash("sha256").update(serializeSipFillProofTerms(input), "utf8").digest("hex");
}
