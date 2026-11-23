import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { Money, roundMoney } from "../core/money";
import { calculateFxData } from "./TransferFxService";
import { ValidationError } from "../utils/errorHandler";

export interface TransferOptions {
  date?: string;
  name?: string;
  notes?: string;
  idempotencyKey?: string;
  currency?: string;
  fxRate?: string | null;
  fxSource?: string;
  audit?: { ipAddress?: string };
}

export interface TransferPosting {
  householdId: string;
  ownerUserId: string;
  date: string;
  name?: string;
  notes?: string;
  idempotencyKey?: string;
  currency?: string;
  destinationAmount?: string;
  destinationCurrency?: string;
  audit?: { ipAddress?: string };
  fxRate?: string;
  fxBaseCurrency?: string;
  fxQuoteCurrency?: string;
  fxTimestamp?: Date;
  fxSource?: string;
  convertedAmount?: string;
}

function decimalTerm(value: string | number | null | undefined, precision: number) {
  if (value == null) return null;
  const text = String(value);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  return match && (match[2]?.length ?? 0) <= precision ? new Decimal(text).toString() : text;
}

export function transferHash(terms: unknown[]) {
  return createHash("sha256").update(JSON.stringify(terms)).digest("hex");
}

export function transferAmount(value: string | number) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new ValidationError("Amount must be positive with at most two decimal places");
  }
  const amount = new Money(value);
  if (amount.isZero() || !amount.isPositive() || amount.gt("9999999999999.99")) throw new ValidationError("Amount must be positive and within the supported range");
  return amount;
}

export function validateTransferRate(value?: string | null) {
  if (value == null) return;
  if (!/^\d+(?:\.\d{1,8})?$/.test(value)) throw new ValidationError("FX rate must be a positive number with at most eight decimal places");
  const rate = new Decimal(value);
  if (rate.lte(0)) throw new ValidationError("FX rate must be a positive number");
  if (rate.gt("9999999999.99999999")) throw new ValidationError("FX rate exceeds the supported range");
}

export function serviceTransferTerms(from: string, to: string, amount: Money, input: TransferOptions) {
  return transferHash(["request", from, to, amount.toString(), input.currency ?? null, input.date ?? null,
    input.name || "Transfer", input.notes ?? null, decimalTerm(input.fxRate, 8), input.fxSource ?? "manual"]);
}

// Only the quote producer can associate original request terms with calculated posting data.
const prepared = new WeakMap<TransferCreateRequest, { from: string; to: string; amount: string; posting: TransferPosting; terms: string }>();
export function readPreparedTransfer(input: TransferCreateRequest) {
  const record = prepared.get(input);
  if (!record) throw new TypeError("Invalid prepared transfer");
  return structuredClone(record);
}

export class TransferCreateRequest {
  private constructor() {}

  static async prepare(from: string, to: string, requestedAmount: Money, householdId: string, userId: string,
    fromCurrency: string, toCurrency: string, options: TransferOptions) {
    const input = structuredClone(options);
    validateTransferRate(input.fxRate);
    const amount = transferAmount(requestedAmount.toFullString());
    if (input.currency !== undefined && input.currency !== fromCurrency) {
      throw new ValidationError("Transfer currency must match the source account");
    }
    const terms = serviceTransferTerms(from, to, amount, input);
    let fx;
    if (fromCurrency !== toCurrency) {
      const { householdRepository } = await import("../repositories/HouseholdRepository");
      const household = await householdRepository.findById(householdId);
      fx = await calculateFxData({ amount, fromCurrency, toCurrency, baseCurrency: household?.currency ?? "ZMW",
        householdId, fxRate: input.fxRate, fxSource: input.fxSource });
    }
    const posting: TransferPosting = {
      householdId, ownerUserId: userId, date: input.date || new Date().toISOString().split("T")[0],
      name: input.name, notes: input.notes, idempotencyKey: input.idempotencyKey, audit: input.audit,
      currency: fromCurrency, destinationCurrency: toCurrency,
      destinationAmount: fx ? roundMoney(new Decimal(amount.toString()).times(fx.fxRate), 2) : amount.toString(),
      ...(fx && { fxRate: fx.fxRate, fxBaseCurrency: fx.fxBaseCurrency, fxQuoteCurrency: fx.fxQuoteCurrency,
        fxTimestamp: fx.fxTimestamp, fxSource: fx.fxSource, convertedAmount: fx.convertedAmount }),
    };
    const request = Object.freeze(new TransferCreateRequest());
    prepared.set(request, { from, to, amount: amount.toString(), posting, terms });
    return request;
  }
}

export function directTransferTerms(from: string, to: string, amount: number | string, data: TransferPosting) {
  return transferHash(["repository", from, to, decimalTerm(amount, 2), data.date, data.name || "Transfer", data.notes ?? null,
    data.currency ?? null, data.destinationCurrency ?? null, decimalTerm(data.destinationAmount, 2), decimalTerm(data.fxRate, 8),
    data.fxBaseCurrency ?? null, data.fxQuoteCurrency ?? null, data.fxTimestamp ?? null, data.fxSource ?? null,
    decimalTerm(data.convertedAmount, 2)]);
}
