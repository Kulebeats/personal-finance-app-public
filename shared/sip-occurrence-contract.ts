import Decimal from "decimal.js";
import { isCanonicalImportDate } from "./import-date";

export const SIP_OCCURRENCE_REQUEST_VERSION = 1;
export const SIP_OCCURRENCE_MAX_FILLS = 100;
export const SIP_OCCURRENCE_MAX_AMOUNT = "9999999999999.99";
const Exact = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SipOccurrenceFill = Readonly<{
  executionDate: string;
  quantity: string;
  price: string;
  fees: string;
}>;

export type SipOccurrenceConfirmation = Readonly<{
  operationId: string;
  expectedRevision: number;
  finalStatement: true;
  outcome: "filled" | "partially_filled" | "unfilled";
  brokerReference?: string;
  fills: readonly SipOccurrenceFill[];
}>;

export type SipOccurrenceIntentContext = Readonly<{
  householdId: string;
  planId: string;
  scheduledDate: string;
  currency: string;
}>;

export class SipOccurrenceContractError extends Error {
  readonly fields: ReadonlyArray<Readonly<{ path: string; message: string }>>;

  constructor(path: string, message: string) {
    super("Invalid occurrence confirmation");
    this.name = "SipOccurrenceContractError";
    this.fields = Object.freeze([Object.freeze({ path, message })]);
  }
}

function invalid(path: string, message: string): never {
  throw new SipOccurrenceContractError(path, message);
}

function record(input: unknown, allowed: readonly string[], path: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    invalid(path, "An object is required");
  }
  if (Object.keys(input).some(key => !allowed.includes(key))) {
    invalid(path, "Unsupported fields");
  }
  return input as Record<string, unknown>;
}

function fullMatch(value: unknown, pattern: RegExp, path: string): string {
  if (typeof value !== "string" || pattern.exec(value)?.[0] !== value) {
    invalid(path, "Invalid field format");
  }
  return value;
}

export function canonicalSipOccurrenceUuid(value: unknown, path: string): string {
  return fullMatch(value, UUID, path).toLowerCase();
}

export function canonicalSipOccurrenceDate(value: unknown, path: string): string {
  if (typeof value !== "string" || value.startsWith("0000-") || !isCanonicalImportDate(value)) {
    invalid(path, "Use a real date in YYYY-MM-DD format");
  }
  return value;
}

export function canonicalSipOccurrenceCurrency(value: unknown, path: string): string {
  return fullMatch(value, /^[a-z]{3}$/i, path).toUpperCase();
}

function decimal(value: unknown, scale: number, maximum: string, positive: boolean, path: string): string {
  const pattern = new RegExp(`^[0-9]+(?:\\.[0-9]{1,${scale}})?$`);
  const normalized = new Exact(fullMatch(value, pattern, path));
  if (!normalized.isFinite() || (positive ? normalized.lte(0) : normalized.lt(0)) || normalized.gt(maximum)) {
    invalid(path, "Value is outside the supported range");
  }
  return normalized.toFixed(scale);
}

function economics(fill: SipOccurrenceFill) {
  const gross = new Exact(fill.quantity).times(fill.price).toDecimalPlaces(2);
  const amount = gross.plus(fill.fees);
  if (amount.gt(SIP_OCCURRENCE_MAX_AMOUNT)) invalid("fills", "Purchase amount exceeds the supported range");
  return { grossAmount: gross.toFixed(2), fees: fill.fees, amount: amount.toFixed(2) };
}

export function normalizeSipOccurrenceFill(input: unknown, path = "fill"): SipOccurrenceFill {
  const row = record(input, ["executionDate", "quantity", "price", "fees"], path);
  const fill = Object.freeze({
    executionDate: canonicalSipOccurrenceDate(row.executionDate, `${path}.executionDate`),
    quantity: decimal(row.quantity, 8, "9999999999.99999999", true, `${path}.quantity`),
    price: decimal(row.price, 4, "99999999999.9999", true, `${path}.price`),
    fees: decimal(row.fees, 2, SIP_OCCURRENCE_MAX_AMOUNT, false, `${path}.fees`),
  });
  economics(fill);
  return fill;
}

export function calculateSipFillEconomics(input: unknown): Readonly<{ grossAmount: string; fees: string; amount: string }> {
  return Object.freeze(economics(normalizeSipOccurrenceFill(input)));
}

function optionalReference(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.includes("\u0000")) {
    invalid("brokerReference", "Invalid optional reference");
  }
  const points = [...value];
  if (points.length > 200 || points.some(point => {
    const code = point.codePointAt(0)!;
    return code >= 0xd800 && code <= 0xdfff;
  })) invalid("brokerReference", "Invalid optional reference");
  return value;
}

/** Calendar cutoff is an independent server policy; this never invents a zone. */
export function normalizeSipOccurrenceConfirmation(input: unknown): SipOccurrenceConfirmation {
  const row = record(input, ["operationId", "expectedRevision", "finalStatement", "outcome", "brokerReference", "fills"], "");
  const operationId = canonicalSipOccurrenceUuid(row.operationId, "operationId");
  if (typeof row.expectedRevision !== "number" || !Number.isSafeInteger(row.expectedRevision)
      || row.expectedRevision < 0 || row.expectedRevision > 2147483647) {
    invalid("expectedRevision", "Invalid occurrence revision");
  }
  if (row.finalStatement !== true) invalid("finalStatement", "Confirm the final broker statement");
  if (row.outcome !== "filled" && row.outcome !== "partially_filled" && row.outcome !== "unfilled") {
    invalid("outcome", "Select the final order outcome");
  }
  if (!Array.isArray(row.fills) || row.fills.length > SIP_OCCURRENCE_MAX_FILLS) {
    invalid("fills", "Supply at most 100 individual actual fills");
  }
  if ((row.outcome === "unfilled") !== (row.fills.length === 0)) {
    invalid("fills", "Actual fills must match the declared final outcome");
  }
  const fills = row.fills.map((fill, index) => normalizeSipOccurrenceFill(fill, `fills.${index}`));
  let quantity = new Exact(0);
  let amount = new Exact(0);
  for (const fill of fills) {
    quantity = quantity.plus(fill.quantity);
    amount = amount.plus(economics(fill).amount);
  }
  if (quantity.gte("1e10") || amount.gt(SIP_OCCURRENCE_MAX_AMOUNT)) {
    invalid("fills", "Aggregate purchase exceeds the supported holding range");
  }
  const brokerReference = optionalReference(row.brokerReference);
  return Object.freeze({ operationId, expectedRevision: row.expectedRevision, finalStatement: true,
    outcome: row.outcome, ...(brokerReference === undefined ? {} : { brokerReference }), fills: Object.freeze(fills) });
}

/** Complete operational intent. Reference equality is checked separately, never hashed. */
export function serializeSipOccurrenceIntent(context: SipOccurrenceIntentContext, input: unknown): string {
  const command = normalizeSipOccurrenceConfirmation(input);
  return JSON.stringify([
    SIP_OCCURRENCE_REQUEST_VERSION,
    "confirm_record_only_sip_occurrence",
    canonicalSipOccurrenceUuid(context.householdId, "householdId"),
    canonicalSipOccurrenceUuid(context.planId, "planId"),
    canonicalSipOccurrenceDate(context.scheduledDate, "scheduledDate"),
    command.expectedRevision,
    command.finalStatement,
    command.outcome,
    canonicalSipOccurrenceCurrency(context.currency, "currency"),
    command.fills.map(fill => [fill.executionDate, fill.quantity, fill.price, fill.fees]),
  ]);
}
