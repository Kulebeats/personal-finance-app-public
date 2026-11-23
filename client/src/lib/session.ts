import type { SessionStatus } from "@shared/session-status";
import { clearCsrfToken } from "./csrf";
import { activateOperationLifetime, captureOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "./operation-lifetime";

const listeners = new Set<(phase: "begin" | "refresh") => void>();
const SIGNAL_KEY = "capital.session.invalidate";
let transitionPending = false;
let transitionError: string | null = null;
export function isSessionTransitionPending(): boolean { return transitionPending; }
export function getSessionTransitionError(): string | null { return transitionError; }

export function subscribeSessionInvalidation(listener: (phase: "begin" | "refresh") => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Withdraw the current data lifetime synchronously, before a cookie can change. */
export function beginSessionTransition(inheritExpectations = false): OperationLifetime {
  const expectations = inheritExpectations ? captureOperationLifetime()?.expectations : undefined;
  retireOperationLifetime();
  clearCsrfToken();
  transitionPending = true;
  transitionError = null;
  const operation = createOperationLifetime(expectations);
  activateOperationLifetime(operation);
  listeners.forEach(listener => listener("begin"));
  return operation;
}

export function completeSessionTransition(operation: OperationLifetime, error?: string, broadcast = true): void {
  if (!operation.active || captureOperationLifetime() !== operation) return;
  transitionError = error ?? null;
  transitionPending = false;
  retireOperationLifetime(operation);
  clearCsrfToken();
  listeners.forEach(listener => listener("refresh"));
  if (broadcast) {
    try { localStorage.setItem(SIGNAL_KEY, crypto.randomUUID()); } catch { /* Storage may be disabled. */ }
  }
}

export function invalidateSession(error?: string): void { completeSessionTransition(beginSessionTransition(), error); }

export function listenForRemoteSessionInvalidation(listener: () => void): () => void {
  const receive = (event: StorageEvent) => {
    if (event.key === SIGNAL_KEY) { transitionPending = false; transitionError = null; retireOperationLifetime(); clearCsrfToken(); listener(); }
  };
  window.addEventListener("storage", receive);
  return () => window.removeEventListener("storage", receive);
}

export function sessionIdentity(status: SessionStatus): string {
  if (status.state === "anonymous" || status.state === "mfa_pending") return status.state;
  return JSON.stringify([status.state, status.subject.id, status.state === "ready" ? [status.household.id, status.household.role] : null]);
}

export async function fetchSessionStatus(signal: AbortSignal): Promise<SessionStatus> {
  const response = await fetch("/api/auth/session", { credentials: "include", cache: "no-store", signal });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = (body as { error?: { message?: string } })?.error?.message;
    throw new Error(message || `Session lookup failed (${response.status})`);
  }
  const status = (body as { success?: boolean; data?: SessionStatus })?.data;
  if ((body as { success?: boolean })?.success !== true || !status || !["anonymous", "mfa_pending", "verification_pending", "mfa_enrolment_required", "verified_without_household", "ready"].includes(status.state)) throw new Error("Invalid session status response");
  if (status.state !== "anonymous" && status.state !== "mfa_pending" && (!status.subject || typeof status.subject.id !== "string" || !status.subject.id || typeof status.subject.email !== "string" || !(status.subject.displayName === null || typeof status.subject.displayName === "string"))) throw new Error("Invalid session subject response");
  if (status.state === "ready" && (!status.household || typeof status.household.id !== "string" || !["owner", "admin", "member", "view_only", "professional"].includes(status.household.role))) throw new Error("Invalid session household response");
  if (status.state === "mfa_enrolment_required" && typeof status.graceEndedAt !== "string") throw new Error("Invalid session MFA response");
  return status;
}
