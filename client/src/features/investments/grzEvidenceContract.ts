import Decimal from "decimal.js";
import { z } from "zod";
import type { GrzBond } from "@/hooks/useGrzSecurities";

const Exact = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
const maximum = "9999999999999.99";
export type EvidenceKind = "acquisition" | "market";
export interface EvidenceFields {
  sourceKind: string; sourceDate: string; sourceReference: string;
  principalCost: string; purchasedInterest: string; acquisitionFees: string;
  quoteBasis: string; quoteUnits: string; quotedAmount: string; accruedInterest: string; unknownAccrued: boolean;
}
export const emptyEvidenceFields = (): EvidenceFields => ({ sourceKind: "", sourceDate: "", sourceReference: "", principalCost: "", purchasedInterest: "", acquisitionFees: "",
  quoteBasis: "", quoteUnits: "", quotedAmount: "", accruedInterest: "", unknownAccrued: false });
export interface BasisEvidence {
  operationId: string; acquisitionDate: string; sourceDate: string; isin: string; currency: "ZMW"; purchaseCashAmount: string;
  principalCost: string; purchasedInterest: string; acquisitionFees: string; sourceKind: string; sourceReference: string;
}
export interface MarketEvidence {
  operationId: string; valuationDate: string; sourceDate: string; isin: string; currency: "ZMW"; nominalAmount: string;
  sourceKind: string; sourceReference: string; quoteBasis: "clean" | "dirty"; quoteUnits: "holding_amount" | "per_100_nominal";
  quotedAmount: string; accruedInterest: string | null;
}
export type EvidencePayload = BasisEvidence | MarketEvidence;
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function date(value: string) {
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(value), "Enter a valid source date.");
  const parsed = new Date(`${value}T00:00:00Z`);
  requireValue(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, "Enter a valid source date.");
  return value;
}
function money(value: string, label: string, positive = false) {
  requireValue(/^\d{1,13}(?:\.\d{1,2})?$/.test(value), `Enter ${label} explicitly in ZMW, with at most two decimal places.`);
  const parsed = new Exact(value);
  requireValue(parsed.lte(maximum) && (!positive || parsed.gt(0)), `${label} must be ${positive ? "positive and " : ""}within the supported range.`);
  return parsed.toFixed(2);
}
function quote(value: string, positive = false) {
  requireValue(/^\d{1,13}(?:\.\d{1,8})?$/.test(value) && (!positive || new Exact(value).gt(0)), "Enter an explicit nonnegative quote with at most eight decimal places.");
  return value;
}
export function holdingEvidenceKey(bond: GrzBond) {
  return JSON.stringify([bond.id, bond.accountId, bond.isin, bond.faceValue.amount, bond.purchasePrice.amount, bond.purchaseDate, bond.maturityDate, bond.status]);
}
export function makeEvidencePayload(kind: EvidenceKind, bond: GrzBond, fields: EvidenceFields, operationId: string): EvidencePayload {
  requireValue(bond.status === "active" && bond.accountId && bond.isin && /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(bond.isin), "An active holding with its custody account and ISIN is required.");
  const nominal = money(bond.faceValue.amount, "nominal principal", true);
  const acquisitionDate = date(bond.purchaseDate), sourceDate = date(fields.sourceDate), today = new Date().toISOString().slice(0, 10);
  requireValue(sourceDate >= acquisitionDate && sourceDate <= today, "The source date must be between acquisition and today.");
  const sourceReference = fields.sourceReference.trim(); requireValue(sourceReference.length > 0 && sourceReference.length <= 500, "Enter the source reference, up to 500 characters.");
  const common = { operationId, sourceDate, isin: bond.isin, currency: "ZMW" as const, sourceReference, sourceKind: fields.sourceKind };
  if (kind === "acquisition") {
    const purchaseCash = money(bond.purchasePrice.amount, "purchase cash", true);
    requireValue(["custodian_statement", "trade_confirmation", "contract_note"].includes(fields.sourceKind), "Choose an attributable acquisition source.");
    const principalCost = money(fields.principalCost, "principal cost", true), purchasedInterest = money(fields.purchasedInterest, "purchased interest"), acquisitionFees = money(fields.acquisitionFees, "acquisition fees");
    requireValue(new Exact(principalCost).plus(purchasedInterest).plus(acquisitionFees).eq(purchaseCash), "Principal, purchased interest and fees must reconcile to the recorded purchase cash.");
    return { ...common, acquisitionDate, purchaseCashAmount: purchaseCash, principalCost, purchasedInterest, acquisitionFees };
  }
  requireValue(["custodian_statement", "same_issue_quote", "same_issue_trade"].includes(fields.sourceKind), "Choose a same-issue statement, quote or trade.");
  requireValue(sourceDate <= date(bond.maturityDate), "The market evidence date cannot be after maturity.");
  requireValue(fields.quoteBasis === "clean" || fields.quoteBasis === "dirty", "Choose clean or dirty price basis.");
  requireValue(fields.quoteUnits === "holding_amount" || fields.quoteUnits === "per_100_nominal", "Choose the quote's amount units.");
  requireValue(!fields.unknownAccrued || fields.quoteBasis === "dirty", "A clean quote requires explicit accrued interest, including zero.");
  const result: MarketEvidence = { ...common, nominalAmount: nominal, valuationDate: sourceDate, quoteBasis: fields.quoteBasis, quoteUnits: fields.quoteUnits,
    quotedAmount: quote(fields.quotedAmount, true), accruedInterest: fields.unknownAccrued ? null : quote(fields.accruedInterest) };
  expectedMarket(result); return result;
}
function expectedMarket(input: MarketEvidence) {
  const factor = input.quoteUnits === "per_100_nominal" ? new Exact(input.nominalAmount).div(100) : new Exact(1);
  const price = new Exact(input.quotedAmount).times(factor), interest = input.accruedInterest === null ? null : new Exact(input.accruedInterest).times(factor);
  const full = input.quoteBasis === "clean" ? price.plus(interest!) : price;
  const clean = interest === null ? null : input.quoteBasis === "clean" ? price : full.minus(interest);
  const dirtyValue = full.toFixed(2), cleanValue = clean?.toFixed(2) ?? null;
  const accruedValue = cleanValue === null ? null : new Exact(dirtyValue).minus(cleanValue).toFixed(2);
  requireValue(!clean?.isNegative() && [dirtyValue, cleanValue, accruedValue].every(value => value === null || new Exact(value).lte(maximum)), "The evidenced amounts must be nonnegative and within the supported range.");
  return { dirtyValue, cleanValue, accruedValue };
}
const dto = z.object({ amount: z.string().regex(/^\d{1,13}\.\d{2}$/), currency: z.literal("ZMW") });
const recorded = z.object({ id: z.string().uuid(), bondId: z.string().uuid(), authority: z.literal("member_recorded"), currency: z.literal("ZMW"),
  isin: z.string(), sourceKind: z.string(), sourceReference: z.string(), sourceDate: z.string(), policyVersion: z.string().min(1) }).passthrough();
export function verifyEvidenceResponse(value: unknown, bondId: string, kind: EvidenceKind, payload: EvidencePayload) {
  const envelope = z.object({ success: z.literal(true), data: recorded }).parse(value), result = envelope.data;
  requireValue(result.operationId === payload.operationId && result.bondId === bondId && result.isin === payload.isin &&
    result.sourceDate === payload.sourceDate && result.sourceKind === payload.sourceKind && result.sourceReference === payload.sourceReference, "Unverified evidence response");
  if (kind === "acquisition") {
    const body = payload as BasisEvidence;
    requireValue(result.policyVersion === "grz_member_recorded_principal_basis_v1" && result.acquisitionDate === body.acquisitionDate, "Unverified acquisition policy or date");
    for (const field of ["purchaseCashAmount", "principalCost", "purchasedInterest", "acquisitionFees"] as const) requireValue(dto.parse(result[field]).amount === body[field], "Unverified acquisition amount");
  } else {
    const body = payload as MarketEvidence, expected = expectedMarket(body);
    requireValue(result.policyVersion === "grz_member_recorded_market_v1" && result.roundingPolicy === "round_total_and_clean_residual_to_accrued", "Unverified market valuation policy");
    requireValue(result.valuationDate === body.valuationDate && result.quoteBasis === body.quoteBasis && result.quoteUnits === body.quoteUnits && dto.parse(result.nominalAmount).amount === body.nominalAmount, "Unverified market evidence");
    requireValue(typeof result.quotedAmount === "string" && new Exact(result.quotedAmount).eq(body.quotedAmount), "Unverified market quote");
    requireValue(body.accruedInterest === null ? result.accruedQuote === null : typeof result.accruedQuote === "string" && new Exact(result.accruedQuote).eq(body.accruedInterest), "Unverified accrued quote");
    for (const [field, amount] of [["dirtyValue", expected.dirtyValue], ["cleanValue", expected.cleanValue], ["accruedInterest", expected.accruedValue]] as const) requireValue(amount === null ? result[field] === null : dto.parse(result[field]).amount === amount, "Unverified market amount");
  }
  return result;
}
