import { format } from "date-fns";
// Type-only imports: this module is also loaded by a server real-DB test,
// which cannot resolve the client's "@/" alias at runtime.
import type { TransactionFormValues } from "../components/transactions/form/schema";
import type { CreateRecurringTransactionInput } from "../hooks/useRecurring";

/**
 * Add Transaction with "make recurring" creates the transaction and its
 * recurring rule in one request (server: createRecurringFromTransactionSchema).
 * Relative to the API base; apiCall prefixes /api.
 */
export const RECURRING_TRANSACTION_ENDPOINT = "/recurring/transaction";

/** Preselected when "make recurring" is switched on; it repeats from the transaction date. */
export const DEFAULT_RECURRING_FREQUENCY = "monthly" as const;

export interface RecurringTransactionRequestContext {
  name: string;
  currency: string;
  idempotencyKey?: string;
}

function isoDate(value: Date | undefined): string | undefined {
  return value ? format(value, "yyyy-MM-dd") : undefined;
}

/** The exact body the Add Transaction form posts for a recurring transaction. */
export function buildRecurringTransactionRequest(
  data: TransactionFormValues,
  context: RecurringTransactionRequestContext,
): CreateRecurringTransactionInput {
  if (!data.recurringFrequency) throw new Error("Choose how often this transaction repeats.");
  const date = format(data.date, "yyyy-MM-dd");
  return {
    accountId: data.accountId,
    date,
    name: context.name,
    amount: { amount: data.amount, currency: context.currency },
    type: data.type as "income" | "expense",
    categoryId: data.categoryId && !data.categoryId.startsWith("_") ? data.categoryId : undefined,
    merchantId: data.merchantId || undefined,
    notes: data.notes || undefined,
    idempotencyKey: context.idempotencyKey,
    recurring: {
      frequency: data.recurringFrequency,
      startDate: date,
      endDate: isoDate(data.recurringEndDate),
      intervalValue: data.recurringIntervalValue,
      intervalUnit: data.recurringIntervalUnit,
      amountType: data.recurringAmountType,
      amountTolerance: data.recurringAmountTolerance,
      reminderDays: data.recurringReminderDays,
      reminderEmail: data.recurringReminderEmail,
      reminderPush: data.recurringReminderPush,
      reminderInApp: data.recurringReminderInApp,
      autoLinkEnabled: data.recurringAutoLinkEnabled,
      autoMarkReviewed: data.recurringAutoMarkReviewed,
      isSubscription: data.recurringIsSubscription,
      trialEndDate: isoDate(data.recurringTrialEndDate),
    },
  };
}

type TransactionFormField = keyof TransactionFormValues;

// Server ValidationError paths (see server/core/errors/ValidationError.ts)
// for the create routes, mapped to the Add Transaction field that owns them.
const SERVER_FIELD_TO_FORM_FIELD: Readonly<Record<string, TransactionFormField>> = {
  accountId: "accountId",
  amount: "amount",
  "amount.amount": "amount",
  "amount.currency": "amount",
  date: "date",
  name: "merchantName",
  description: "merchantName",
  merchantId: "merchantName",
  categoryId: "categoryId",
  notes: "notes",
  "recurring.frequency": "recurringFrequency",
  "recurring.startDate": "date",
  "recurring.endDate": "recurringEndDate",
  "recurring.intervalValue": "recurringIntervalValue",
  "recurring.intervalUnit": "recurringIntervalUnit",
  "recurring.amountType": "recurringAmountType",
  "recurring.amountTolerance": "recurringAmountTolerance",
  "recurring.reminderDays": "recurringReminderDays",
  "recurring.trialEndDate": "recurringTrialEndDate",
};

export interface ServerFieldErrors {
  /** Messages to show on the form field the server named. */
  fieldErrors: { field: TransactionFormField; message: string }[];
  /** Readable summary for the form banner, or null when the error had no field messages. */
  summary: string | null;
}

function readFieldMessages(error: unknown): { field: string; message: string }[] {
  if (!error || typeof error !== "object" || !("fields" in error) || !Array.isArray(error.fields)) return [];
  return error.fields.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const { field, message } = entry as { field?: unknown; message?: unknown };
    return typeof field === "string" && typeof message === "string" && message ? [{ field, message }] : [];
  });
}

/** Turns a 400's `error.fields` (thrown by apiCall) into form field errors. */
export function mapServerFieldErrors(error: unknown): ServerFieldErrors {
  const messages = readFieldMessages(error);
  const fieldErrors = messages.flatMap(({ field, message }) => {
    const formField = SERVER_FIELD_TO_FORM_FIELD[field];
    return formField ? [{ field: formField, message }] : [];
  });
  const unplaced = messages.filter(({ field }) => !SERVER_FIELD_TO_FORM_FIELD[field]).map(({ message }) => message);
  if (messages.length === 0) return { fieldErrors, summary: null };
  const lead = fieldErrors.length > 0 ? ["Check the highlighted fields."] : [];
  return { fieldErrors, summary: [...lead, ...unplaced].join(" ") };
}
