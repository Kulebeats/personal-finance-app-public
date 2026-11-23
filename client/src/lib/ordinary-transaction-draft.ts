import type { CreateTransactionInput } from "./api";
import {
  assertOperationLifetime, captureOperationLifetime, StaleOperationError, subscribeOperationLifetimeRetirement,
  type OperationLifetime,
} from "./operation-lifetime";

interface PendingDraft {
  fingerprint: string;
  request: Readonly<CreateTransactionInput>;
  form: unknown;
  followups: Array<OrdinaryDraftFollowup & { complete: boolean }>;
  followupsUnavailable: boolean;
}
export interface OrdinaryDraftFollowup { run: (transactionId: string) => Promise<unknown> }
export interface PreparedOrdinaryDraft {
  lifetime: OperationLifetime;
  request: Readonly<CreateTransactionInput>;
  followupsUnavailable: boolean;
}
const activeDrafts = new WeakMap<OperationLifetime, PendingDraft>();
const submissionClaims = new WeakMap<OperationLifetime, symbol>();
export class OrdinaryDraftBusyError extends Error { constructor() { super("This transaction submission is already in progress."); } }
// Across reauthorization retain only an operation UUID and a SHA-256 digest.
// Financial input lives solely in the active verified lifetime's weak record.
const identities = new Map<string, Map<string, string>>();
subscribeOperationLifetimeRetirement(lifetime => { activeDrafts.delete(lifetime); submissionClaims.delete(lifetime); });

function scope(lifetime: OperationLifetime | null): string {
  assertOperationLifetime(lifetime);
  if (!lifetime?.active || lifetime !== captureOperationLifetime() || !lifetime.expectations?.subject || !lifetime.expectations.household) throw new StaleOperationError();
  return JSON.stringify([lifetime.expectations.subject, lifetime.expectations.household]);
}
function usable(lifetime: OperationLifetime | null): lifetime is OperationLifetime {
  return !!lifetime?.active && lifetime === captureOperationLifetime() && !!lifetime.expectations?.subject && !!lifetime.expectations.household;
}
const storageKey = (identity: string) => `capital.ordinary-create.v1:${identity}`;
function readIdentities(identity: string) {
  const cached = identities.get(identity);
  if (cached) return cached;
  const raw = sessionStorage.getItem(storageKey(identity));
  if (!raw) return new Map<string, string>();
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some(entry => !Array.isArray(entry) || entry.length !== 2 ||
    typeof entry[0] !== "string" || !/^[a-f0-9]{64}$/.test(entry[0]) || typeof entry[1] !== "string" || !/^[a-f0-9-]{36}$/.test(entry[1]))) {
    throw new Error("The earlier transaction retry identity could not be verified. Start another transaction explicitly to replace it.");
  }
  const known = new Map<string, string>(parsed as Array<[string, string]>);
  identities.set(identity, known); return known;
}
function persistIdentities(identity: string, known: Map<string, string>) {
  if (known.size) sessionStorage.setItem(storageKey(identity), JSON.stringify(Array.from(known.entries())));
  else sessionStorage.removeItem(storageKey(identity));
  identities.set(identity, known);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
async function digest(request: CreateTransactionInput) {
  const { idempotencyKey: _key, ...payload } = request;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical(payload))));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function ordinaryDraftState(lifetime: OperationLifetime | null) {
  if (!usable(lifetime)) return { pending: false, canRetryOriginal: false, followupsUnavailable: false };
  try { const pending = readIdentities(scope(lifetime)).size > 0, active = activeDrafts.get(lifetime);
    return { pending, canRetryOriginal: !!active, followupsUnavailable: pending && (!active || active.followupsUnavailable) }; }
  catch { return { pending: true, canRetryOriginal: false, followupsUnavailable: true }; }
}
export function ordinaryDraftRequest(lifetime: OperationLifetime | null): PreparedOrdinaryDraft | undefined {
  if (!usable(lifetime)) return undefined;
  const pending = activeDrafts.get(lifetime);
  return pending && { lifetime, request: pending.request, followupsUnavailable: pending.followupsUnavailable };
}
export function claimOrdinaryDraft(lifetime: OperationLifetime | null) {
  scope(lifetime);
  if (submissionClaims.has(lifetime!)) throw new OrdinaryDraftBusyError();
  const token = Symbol(); submissionClaims.set(lifetime!, token);
  return { lifetime: lifetime!, token };
}
export function releaseOrdinaryDraft(claim: ReturnType<typeof claimOrdinaryDraft>) {
  if (submissionClaims.get(claim.lifetime) === claim.token) submissionClaims.delete(claim.lifetime);
}
export function ordinaryDraftForm<T>(lifetime: OperationLifetime | null): T | undefined {
  if (!usable(lifetime)) return undefined;
  const form = activeDrafts.get(lifetime)?.form;
  return form === undefined ? undefined : structuredClone(form) as T;
}

export async function prepareOrdinaryDraft(lifetime: OperationLifetime | null, request: CreateTransactionInput, form: unknown,
  generateKey: () => string, followups: OrdinaryDraftFollowup[] = [], assertCurrent: () => void = () => {}): Promise<PreparedOrdinaryDraft> {
  const identity = scope(lifetime), captured = lifetime!;
  const payload = structuredClone(request), fingerprint = await digest(payload);
  scope(captured); assertCurrent();
  const pending = activeDrafts.get(captured), known = readIdentities(identity);
  if ((pending && pending.fingerprint !== fingerprint) || (!known.has(fingerprint) && known.size > 0)) {
    throw new Error("An earlier submission is unresolved. Retry its original details, or start another transaction.");
  }
  if (pending) return { lifetime: captured, request: pending.request, followupsUnavailable: pending.followupsUnavailable };
  const followupsUnavailable = known.has(fingerprint);
  const key = known.get(fingerprint) ?? generateKey();
  const exact = Object.freeze({ ...payload, amount: Object.freeze({ ...payload.amount }), idempotencyKey: key });
  known.set(fingerprint, key); persistIdentities(identity, known);
  activeDrafts.set(captured, { fingerprint, request: exact, form: structuredClone(form), followupsUnavailable,
    followups: followupsUnavailable ? [] : followups.map(step => ({ ...step, complete: false })) });
  return { lifetime: captured, request: exact, followupsUnavailable };
}
export async function runOrdinaryDraftFollowups(prepared: PreparedOrdinaryDraft, transactionId: string, assertCurrent: () => void) {
  scope(prepared.lifetime); assertCurrent();
  const pending = activeDrafts.get(prepared.lifetime);
  if (!pending || pending.request !== prepared.request) throw new StaleOperationError();
  for (const step of pending.followups) {
    scope(prepared.lifetime); assertCurrent();
    if (step.complete) continue;
    await step.run(transactionId);
    scope(prepared.lifetime); step.complete = true; assertCurrent();
  }
}
export function completeOrdinaryDraft(prepared: PreparedOrdinaryDraft) {
  const identity = scope(prepared.lifetime), pending = activeDrafts.get(prepared.lifetime);
  if (!pending || pending.request.idempotencyKey !== prepared.request.idempotencyKey) return;
  const known = new Map(readIdentities(identity));
  if (known?.get(pending.fingerprint) === prepared.request.idempotencyKey) known.delete(pending.fingerprint);
  persistIdentities(identity, known); activeDrafts.delete(prepared.lifetime);
}
export function startAnotherOrdinaryDraft(lifetime: OperationLifetime | null) {
  const identity = scope(lifetime);
  if (submissionClaims.has(lifetime!)) throw new OrdinaryDraftBusyError();
  persistIdentities(identity, new Map()); activeDrafts.delete(lifetime!);
}
