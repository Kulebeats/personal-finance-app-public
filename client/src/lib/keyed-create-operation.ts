import type { TransactionFormValues } from "@/components/transactions/form/schema";
import type { CreateRecurringTransactionInput } from "@/hooks/useRecurring";
import type { ApiError, CreateTransferInput } from "./api";
import { assertOperationLifetime, captureOperationLifetime, StaleOperationError, subscribeOperationLifetimeRetirement,
  type OperationLifetime } from "./operation-lifetime";
import type { OrdinaryDraftFollowup } from "./ordinary-transaction-draft";

type KeyedCreateRequest =
  | { kind: "transfer"; body: CreateTransferInput }
  | { kind: "recurring"; body: CreateRecurringTransactionInput };

interface RetryIdentity {
  fingerprint: string;
  key: string;
}

export interface KeyedCreateOperation {
  lifetime: OperationLifetime;
  identity: RetryIdentity;
  request: KeyedCreateRequest;
  form: TransactionFormValues;
  followups: Array<OrdinaryDraftFollowup & { complete: boolean }>;
  followupsUnavailable: boolean;
  uncertain: boolean;
  confirmation?: { transactionId?: string };
}

export const UNRESOLVED_SUBMISSION_MESSAGE =
  "An earlier submission is unresolved. Retry its original details, or start another transaction.";

// Payloads and follow-up selections belong only to the verified session that captured them.
const operations = new WeakMap<OperationLifetime, KeyedCreateOperation>();
subscribeOperationLifetimeRetirement(lifetime => { operations.delete(lifetime); });

function usable(lifetime: OperationLifetime | null): lifetime is OperationLifetime {
  return !!lifetime?.active && lifetime === captureOperationLifetime() &&
    !!lifetime.expectations?.subject && !!lifetime.expectations.household;
}

function storageKey(lifetime: OperationLifetime | null) {
  if (!usable(lifetime)) throw new StaleOperationError();
  const { subject, household } = lifetime.expectations!;
  return `capital.keyed-create.v1:${JSON.stringify([subject, household])}`;
}

function readIdentity(key: string): RetryIdentity | null {
  const raw = sessionStorage.getItem(key);
  if (raw == null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("fingerprint" in value) || !("key" in value) ||
      typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
      typeof value.key !== "string" || !/^[a-f0-9-]{36}$/.test(value.key)) {
    throw new Error("The earlier transaction retry identity could not be verified. Start another transaction explicitly to replace it.");
  }
  return { fingerprint: value.fingerprint, key: value.key };
}

export function keyedCreateState(lifetime: OperationLifetime | null) {
  if (!usable(lifetime)) return { pending: false, canRetryOriginal: false, followupsUnavailable: false };
  const operation = operations.get(lifetime);
  if (operation) return { pending: true, canRetryOriginal: true, followupsUnavailable: operation.followupsUnavailable };
  try {
    const pending = !!readIdentity(storageKey(lifetime));
    return { pending, canRetryOriginal: false, followupsUnavailable: pending };
  } catch {
    return { pending: true, canRetryOriginal: false, followupsUnavailable: true };
  }
}

export function currentKeyedCreate(lifetime: OperationLifetime | null) {
  return usable(lifetime) ? operations.get(lifetime) : undefined;
}

export function assertNoUnresolvedKeyedCreate(lifetime: OperationLifetime | null) {
  if (keyedCreateState(lifetime).pending) throw new Error(UNRESOLVED_SUBMISSION_MESSAGE);
}

export async function prepareKeyedCreate(lifetime: OperationLifetime, request: KeyedCreateRequest, form: TransactionFormValues,
  generateKey: () => string, followups: OrdinaryDraftFollowup[], assertCurrent: () => void): Promise<KeyedCreateOperation> {
  const key = storageKey(lifetime);
  const exact = structuredClone(request);
  const originalForm = structuredClone(form);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(exact)));
  assertCurrent();
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const pending = operations.get(lifetime);
  const identity = pending?.identity ?? readIdentity(key);
  if (identity && identity.fingerprint !== fingerprint) throw new Error(UNRESOLVED_SUBMISSION_MESSAGE);
  if (pending) return pending;

  const operation: KeyedCreateOperation = {
    lifetime, identity: identity ?? { fingerprint, key: generateKey() }, request: exact, form: originalForm,
    followups: identity ? [] : followups.map(step => ({ ...step, complete: false })),
    followupsUnavailable: !!identity, uncertain: !!identity,
  };
  sessionStorage.setItem(key, JSON.stringify(operation.identity));
  operations.set(lifetime, operation);
  return operation;
}

function assertKeyedCreate(operation: KeyedCreateOperation) {
  assertOperationLifetime(operation.lifetime);
  if (operations.get(operation.lifetime) !== operation) throw new StaleOperationError();
}

export function confirmKeyedCreate(operation: KeyedCreateOperation, transactionId?: string) {
  assertKeyedCreate(operation);
  operation.confirmation = { transactionId };
}

export function settleKeyedCreateFailure(operation: KeyedCreateOperation, error: unknown) {
  if (currentKeyedCreate(operation.lifetime) !== operation) return;
  const status = error instanceof Error ? (error as ApiError).status : undefined;
  // A timeout or conflict may leave the original posting unresolved.
  if (!operation.uncertain && status !== undefined && [400, 401, 403, 404, 422].includes(status)) {
    completeKeyedCreate(operation);
  } else {
    operation.uncertain = true;
  }
}

export async function runKeyedCreateFollowups(operation: KeyedCreateOperation, assertCurrent: () => void) {
  const transactionId = operation.confirmation?.transactionId;
  if (!transactionId) return;
  for (const step of operation.followups) {
    assertCurrent();
    assertKeyedCreate(operation);
    if (step.complete) continue;
    await step.run(transactionId);
    assertKeyedCreate(operation);
    step.complete = true;
    assertCurrent();
  }
}

export function completeKeyedCreate(operation: KeyedCreateOperation) {
  assertKeyedCreate(operation);
  startAnotherKeyedCreate(operation.lifetime);
}

export function startAnotherKeyedCreate(lifetime: OperationLifetime | null) {
  const key = storageKey(lifetime);
  sessionStorage.removeItem(key);
  operations.delete(lifetime!);
}
