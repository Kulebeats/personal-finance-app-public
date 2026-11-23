import Decimal from "decimal.js";
import { z } from "zod";
import { isCanonicalImportDate } from "@shared/import-date";
import { normalizeSipOccurrenceConfirmation, type SipOccurrenceConfirmation } from "@shared/sip-occurrence-contract";
import { normalizeHouseholdTimeZone } from "@shared/household-calendar";
import { apiCall, type ApiError } from "@/lib/api";
import { assertOperationLifetime, StaleOperationError, type OperationLifetime } from "@/lib/operation-lifetime";

const Exact = Decimal.clone({ precision: 60 });
const uuid = z.string().uuid();
const date = z.string().refine(value => !value.startsWith("0000-") && isCanonicalImportDate(value));
const fixed = (whole: number, scale: number, positive = false) => z.string()
  .regex(new RegExp(`^(?:0|[1-9][0-9]{0,${whole - 1}})\\.[0-9]{${scale}}$`))
  .refine(value => !/\s/.test(value))
  .refine(value => {
    try {
      const decimal = new Exact(value);
      return decimal.isFinite() && (positive ? decimal.gt(0) : decimal.gte(0));
    } catch {
      return false;
    }
  });
const amount = fixed(13, 2);
const plannedSchema = z.object({
  accountId: uuid,
  securityId: uuid,
  amount: fixed(13, 2, true),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/),
  authorizedFrequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly", "semi_annually", "annually", "yearly"]),
  authorizedInitialDate: date,
}).strict();
const fillSchema = z.object({
  fillIndex: z.number().int().min(0).max(99),
  purchaseId: uuid,
  executionDate: date,
  quantity: fixed(10, 8, true),
  price: fixed(11, 4, true),
  fees: amount,
  amount,
}).strict();
const resultSchema = z.object({
  outcome: z.enum(["filled", "partially_filled", "unfilled"]),
  fills: z.array(fillSchema).max(100),
  totals: z.object({ grossAmount: amount, fees: amount, amount }).strict(),
}).strict().superRefine((result, context) => {
  if (!result.fills.every(fill => fillSchema.safeParse(fill).success) ||
      !Object.values(result.totals).every(value => amount.safeParse(value).success)) return;
  const purchases = new Set<string>();
  let gross = new Exact(0);
  let quantity = new Exact(0);
  let fees = new Exact(0);
  let total = new Exact(0);
  if ((result.outcome === "unfilled") !== (result.fills.length === 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid closure cardinality" });
  }
  result.fills.forEach((fill, index) => {
    const purchaseId = fill.purchaseId.toLowerCase();
    const fillGross = new Exact(fill.quantity).times(fill.price).toDecimalPlaces(2, Exact.ROUND_HALF_UP);
    if (fill.fillIndex !== index || purchases.has(purchaseId) || !fillGross.plus(fill.fees).eq(fill.amount)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["fills", index], message: "Invalid separate fill result" });
    }
    purchases.add(purchaseId);
    quantity = quantity.plus(fill.quantity);
    gross = gross.plus(fillGross);
    fees = fees.plus(fill.fees);
    total = total.plus(fill.amount);
  });
  if (quantity.gte("1e10")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["fills"], message: "Aggregate purchase quantity exceeds the supported range" });
  }
  if (!gross.eq(result.totals.grossAmount) || !fees.eq(result.totals.fees) || !total.eq(result.totals.amount)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["totals"], message: "Invalid confirmation totals" });
  }
});
const identity = { planId: uuid, scheduledDate: date };
const pendingSchema = z.object({
  ...identity,
  state: z.literal("pending"),
  detailsAvailable: z.literal(true),
  occurrenceRevision: z.literal(0),
  planned: plannedSchema,
  permittedActions: z.array(z.literal("confirm")).max(1),
}).strict();
const closedSchema = z.object({
  ...identity,
  state: z.literal("closed"),
  detailsAvailable: z.literal(true),
  occurrenceRevision: z.literal(1),
  planned: plannedSchema,
  result: resultSchema,
}).strict();
const fenceSchema = z.object({ ...identity, state: z.literal("closed"), detailsAvailable: z.literal(false) }).strict();
const readSchema = z.union([pendingSchema, closedSchema, fenceSchema]);
const listSchema = z.object({
  success: z.literal(true),
  data: z.array(readSchema).max(100),
  pagination: z.object({ hasMore: z.boolean(), nextBefore: date.nullable() }).strict(),
}).strict();
const acknowledgmentSchema = z.object({
  success: z.literal(true),
  data: z.object({ requestVersion: z.literal(1), operationId: uuid, occurrence: closedSchema }).strict(),
}).strict();
const optionsSchema = z.object({
  state: z.enum(["all", "pending", "closed"]).default("all"),
  limit: z.number().int().min(1).max(100).default(25),
  before: date.optional(),
}).strict();

export type SipPendingOccurrence = z.infer<typeof pendingSchema>;
export type SipClosedOccurrence = z.infer<typeof closedSchema>;
export type SipClosedFence = z.infer<typeof fenceSchema>;
export type SipOccurrence = z.infer<typeof readSchema>;
export type SipOccurrenceList = z.infer<typeof listSchema>;
export type SipConfirmationAcknowledgment = z.infer<typeof acknowledgmentSchema>;
export type SipOccurrenceOptions = z.input<typeof optionsSchema>;
export interface SipActualFillInput { executionDate: string; quantity: string; price: string; fees: string }
export interface SipConfirmationDraft {
  finalStatement: boolean;
  outcome: "filled" | "partially_filled" | "unfilled" | "";
  brokerReference?: string;
  fills: SipActualFillInput[];
}
export type SipConfirmationRequest = SipOccurrenceConfirmation;

const safeCodes = new Set([
  "VALIDATION_ERROR", "CONFLICT", "NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED", "AUTHENTICATION_REQUIRED",
  "STEP_UP_REQUIRED", "EMAIL_VERIFICATION_REQUIRED", "HOUSEHOLD_NOT_FOUND", "SESSION_CONTEXT_CHANGED", "CSRF_INVALID",
  "OCCURRENCE_CLOSED_DETAILS_UNAVAILABLE", "HOUSEHOLD_CALENDAR_REQUIRED", "RATE_LIMITED", "RATE_LIMIT_EXCEEDED",
  "INTERNAL_ERROR", "SERVICE_UNAVAILABLE",
]);
function safeFieldMessage(path: string): string | null {
  if (path === "timeZone") return "Select a supported named household time zone";
  if (path === "brokerReference") return "Review the optional reference";
  if (path === "finalStatement") return "Confirm the final broker statement";
  if (path === "outcome") return "Select the final order outcome";
  if (path === "fills") return "Review the individual actual fills and final outcome";
  const match = /^fills\.(?:0|[1-9][0-9]?)\.(executionDate|quantity|price|fees)$/.exec(path);
  if (match?.[1] === "quantity") return "Enter a positive quantity";
  if (match?.[1] === "price") return "Enter a positive price";
  if (match?.[1] === "fees") return "Enter explicit nonnegative fees with up to two decimal places";
  if (match?.[1] === "executionDate") return "Enter a real execution date in YYYY-MM-DD format";
  return null;
}
function safeFailure(error: unknown, kind: "confirmation" | "list" | "calendar"): Error {
  if (error instanceof StaleOperationError) return error;
  const original = error as ApiError | null | undefined;
  const status = typeof original?.status === "number" && Number.isInteger(original.status) && original.status >= 100 && original.status <= 599
    ? original.status : undefined;
  const code = typeof original?.code === "string" && safeCodes.has(original.code) ? original.code : undefined;
  let message = kind === "list" ? "The scheduled purchase list could not be refreshed."
    : kind === "calendar" ? "The household calendar could not be refreshed."
      : "The confirmation result could not be verified. Retry the original request.";
  if (code === "HOUSEHOLD_CALENDAR_REQUIRED") message = "Confirmation is unavailable until the household calendar is configured.";
  if (code === "OCCURRENCE_CLOSED_DETAILS_UNAVAILABLE") message = "This occurrence is closed; execution details are unavailable.";
  const sanitized = new Error(message) as ApiError;
  sanitized.status = status;
  sanitized.code = code;
  if (status === 400 && code === "VALIDATION_ERROR" && original?.fields && typeof original.fields === "object") {
    const fields: Record<string, string[]> = {};
    const paths = Array.isArray(original.fields)
      ? original.fields.flatMap(descriptor => {
        if (!descriptor || typeof descriptor !== "object") return [];
        const path: unknown = (descriptor as { field?: unknown }).field;
        return typeof path === "string" ? [path] : [];
      })
      : Object.keys(original.fields);
    for (const path of paths) {
      const fieldMessage = safeFieldMessage(path);
      if (fieldMessage) fields[path] = [fieldMessage];
    }
    sanitized.fields = fields;
  }
  // Error messages, stacks, causes, details and field values can contain the raw
  // request. Build a fresh allowlisted failure before QueryClient sees it.
  return sanitized;
}

function invalidAcknowledgment(): never {
  throw new Error("The confirmation acknowledgment could not be verified. Retry the original request.");
}

export function readSipOccurrenceList(input: unknown, planId: string, options: SipOccurrenceOptions = {}): SipOccurrenceList {
  const parsed = listSchema.safeParse(input);
  const filters = optionsSchema.parse(options);
  if (!parsed.success || !uuid.safeParse(planId).success) throw new Error("The scheduled purchase list could not be verified.");
  const result = parsed.data;
  const dates = new Set<string>();
  let previous: string | undefined;
  for (const row of result.data) {
    if (row.planId !== planId || dates.has(row.scheduledDate) || (previous && row.scheduledDate >= previous) ||
        (filters.before && row.scheduledDate >= filters.before) || (filters.state !== "all" && row.state !== filters.state)) {
      throw new Error("The scheduled purchase list could not be verified.");
    }
    previous = row.scheduledDate;
    dates.add(row.scheduledDate);
  }
  if (result.data.length > filters.limit || result.pagination.hasMore !== (result.pagination.nextBefore !== null) ||
      (result.pagination.hasMore && result.pagination.nextBefore !== previous)) {
    throw new Error("The scheduled purchase pagination could not be verified.");
  }
  return result;
}

export function readSipConfirmationAcknowledgment(input: unknown, expected: {
  planId: string;
  scheduledDate: string;
  operationId: string;
  request: SipConfirmationRequest;
}): SipConfirmationAcknowledgment {
  const parsed = acknowledgmentSchema.safeParse(input);
  if (!parsed.success) return invalidAcknowledgment();
  const result = parsed.data;
  const occurrence = result.data.occurrence;
  const request = normalizeSipOccurrenceConfirmation(expected.request);
  if (result.data.operationId !== expected.operationId || occurrence.planId !== expected.planId ||
      occurrence.scheduledDate !== expected.scheduledDate || occurrence.result.outcome !== request.outcome ||
      occurrence.result.fills.length !== request.fills.length || occurrence.result.fills.some((fill, index) => {
        const original = request.fills[index];
        return fill.executionDate !== original.executionDate || fill.quantity !== original.quantity ||
          fill.price !== original.price || fill.fees !== original.fees;
      })) return invalidAcknowledgment();
  return result;
}

export async function listSipOccurrences(planId: string, options: SipOccurrenceOptions, operation: OperationLifetime) {
  uuid.parse(planId);
  const filters = optionsSchema.parse(options);
  assertOperationLifetime(operation);
  const query = new URLSearchParams({ state: filters.state, limit: String(filters.limit) });
  if (filters.before) query.set("before", filters.before);
  try {
    const input = await apiCall<unknown>(`/investments/recurring/${encodeURIComponent(planId)}/occurrences?${query}`, {}, true, false, operation);
    assertOperationLifetime(operation);
    return readSipOccurrenceList(input, planId, filters);
  } catch (error) {
    throw safeFailure(error, "list");
  }
}

export async function confirmSipOccurrence(planId: string, scheduledDate: string, input: SipConfirmationRequest, operation: OperationLifetime, serializedBody?: string) {
  uuid.parse(planId);
  date.parse(scheduledDate);
  const request = normalizeSipOccurrenceConfirmation(input);
  const body = JSON.stringify(request);
  if (serializedBody !== undefined && serializedBody !== body) throw new Error("The original confirmation request could not be verified.");
  assertOperationLifetime(operation);
  try {
    const response = await apiCall<unknown>(
      `/investments/recurring/${encodeURIComponent(planId)}/occurrences/${encodeURIComponent(scheduledDate)}/confirm`,
      { method: "POST", body: serializedBody ?? body }, true, false, operation,
    );
    assertOperationLifetime(operation);
    return readSipConfirmationAcknowledgment(response, { planId, scheduledDate, operationId: request.operationId, request });
  } catch (error) {
    throw safeFailure(error, "confirmation");
  }
}

const calendarSchema = z.object({
  success: z.literal(true),
  data: z.object({
    timeZone: z.string().min(1).max(100).nullable(),
    configured: z.boolean(),
    permittedActions: z.array(z.literal("configure")).max(1),
  }).strict(),
}).strict();
export type SipHouseholdCalendarResponse = z.infer<typeof calendarSchema>;

export function readSipHouseholdCalendar(input: unknown): SipHouseholdCalendarResponse {
  const parsed = calendarSchema.safeParse(input);
  if (!parsed.success) throw new Error("The household calendar could not be verified.");
  const { data } = parsed.data;
  if (data.configured) {
    try {
      if (normalizeHouseholdTimeZone(data.timeZone) !== data.timeZone) throw new Error("Unverified calendar");
    } catch {
      throw new Error("The household calendar could not be verified.");
    }
  }
  return parsed.data;
}

export async function getSipHouseholdCalendar(operation: OperationLifetime) {
  assertOperationLifetime(operation);
  try {
    const result = await apiCall<unknown>("/investments/calendar", {}, true, false, operation);
    assertOperationLifetime(operation);
    return readSipHouseholdCalendar(result);
  } catch (error) {
    throw safeFailure(error, "calendar");
  }
}

export async function configureSipHouseholdCalendar(input: string, operation: OperationLifetime) {
  const timeZone = normalizeHouseholdTimeZone(input);
  assertOperationLifetime(operation);
  try {
    const result = await apiCall<unknown>("/investments/calendar", { method: "PUT", body: JSON.stringify({ timeZone }) }, true, false, operation);
    assertOperationLifetime(operation);
    const verified = readSipHouseholdCalendar(result);
    if (!verified.data.configured || verified.data.timeZone !== timeZone) throw new Error("The household calendar acknowledgment could not be verified.");
    return verified;
  } catch (error) {
    throw safeFailure(error, "calendar");
  }
}
