/**
 * Email-code two-step verification management (R06.1).
 *
 * Server routes: server/routes/security.mfa.auth.ts, mounted at
 * /api/settings/security/mfa. Every change needs a fresh code from the
 * user's email; backup codes come back once, in the confirm/regenerate
 * response only.
 */
import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiCall, requestStepUp, type ApiError } from "@/lib/api";

const BASE = "/settings/security/mfa";
export const MFA_STATUS_QUERY_KEY = ["mfa-status"] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}
interface BackupCodesPayload {
  backupCodes: string[];
}
export interface DisableMfaInput {
  password: string;
  code: string;
}

const post = <T>(path: string, body?: unknown, signal?: AbortSignal, retryOnStepUp = true) =>
  apiCall<ApiEnvelope<T>>(`${BASE}${path}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  }, retryOnStepUp);

/**
 * Longest the dialog stays locked waiting for a request that issues backup
 * codes. After this the request is aborted and the outcome is unknown.
 */
export const CODE_ISSUING_TIMEOUT_MS = 30_000;

export const OUTCOME_UNKNOWN_MESSAGE =
  "We couldn't confirm whether this finished. Check your two-step verification status. " +
  "If it shows On but you didn't see your backup codes, choose \"Create new backup codes\".";

/** The request was abandoned at the deadline; the server may or may not have applied it. */
export class MfaOutcomeUnknownError extends Error {
  readonly code = "MFA_OUTCOME_UNKNOWN";
  constructor() {
    super(OUTCOME_UNKNOWN_MESSAGE);
  }
}

/** POST that gives up (and aborts) after CODE_ISSUING_TIMEOUT_MS, CSRF fetch included. */
async function postOnceWithDeadline<T>(path: string, body: unknown): Promise<ApiEnvelope<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new MfaOutcomeUnknownError());
    }, CODE_ISSUING_TIMEOUT_MS);
  });
  try {
    return await Promise.race([post<T>(path, body, controller.signal, false), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const isStepUpChallenge = (error: unknown): boolean =>
  (error as Partial<ApiError> | null)?.code === "STEP_UP_REQUIRED";

/**
 * A step-up challenge (AH-11) is answered OUTSIDE the deadline: a person typing
 * their password is not a stalled request. The server refused before doing
 * anything, so the request is sent once more, under a fresh deadline.
 */
async function postWithDeadline<T>(path: string, body: unknown): Promise<ApiEnvelope<T>> {
  try {
    return await postOnceWithDeadline<T>(path, body);
  } catch (error) {
    if (!isStepUpChallenge(error) || !(await requestStepUp("SETTINGS"))) throw error;
    return postOnceWithDeadline<T>(path, body);
  }
}

/** Server codes whose messages are written for people, so they can be shown as-is. */
const USER_FACING_CODES = new Set([
  "VALIDATION_ERROR",
  "INVALID_CREDENTIALS",
  "CONFLICT",
  "SERVICE_UNAVAILABLE",
  "EMAIL_VERIFICATION_REQUIRED",
  // AH-11: enable/disable need a recent step-up; shown when the prompt is dismissed.
  "STEP_UP_REQUIRED",
  // AH-11: after the grace, MFA cannot be turned off.
  "MFA_REQUIRED",
]);

/** Turn an API failure into a sentence a person can act on (never raw error text). */
export function mfaErrorMessage(error: unknown): string {
  if (error instanceof MfaOutcomeUnknownError) return OUTCOME_UNKNOWN_MESSAGE;
  const apiError = error as Partial<ApiError> | null;
  if (apiError?.status === 429) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (apiError?.code && USER_FACING_CODES.has(apiError.code) && apiError.message) {
    return apiError.message;
  }
  return "Something went wrong. Please try again.";
}

/** Email an enrolment code. MFA stays off until the code is confirmed. */
export function useStartMfaEnrolment() {
  return useMutation({ mutationFn: () => post<{ codeSent: boolean }>("/enable") });
}

/** The one change an emailed code is issued for; the server refuses it for any other. */
export type MfaCodePurpose = "disable" | "regenerate";

/** Email a code for turning MFA off or creating new backup codes. */
export function useSendMfaCode() {
  return useMutation({
    mutationFn: (purpose: MfaCodePurpose) => post<{ codeSent: boolean }>("/code", { purpose }),
  });
}

/**
 * Secrets (OTP, password, backup codes) live in mutation variables and data.
 * Every such mutation carries this key prefix. gcTime 0 drops a settled one
 * once no dialog observes it, but TanStack keeps a PENDING mutation (and its
 * variables) until it settles, so the dialog also removes them on close with
 * `useForgetMfaSecrets`.
 */
const MFA_SECRET_MUTATION_KEY = ["mfa-secret"] as const;
const sensitive = (name: string) => ({ gcTime: 0, mutationKey: [...MFA_SECRET_MUTATION_KEY, name] });

/** Remove every secret-bearing MFA mutation from the cache, pending or not. */
export function useForgetMfaSecrets(): () => void {
  const queryClient = useQueryClient();
  // Stable identity, so an unmount-only effect can depend on it.
  return useCallback(() => {
    const cache = queryClient.getMutationCache();
    cache.findAll({ mutationKey: MFA_SECRET_MUTATION_KEY }).forEach((mutation) => cache.remove(mutation));
  }, [queryClient]);
}

/**
 * Refetch MFA status WITHOUT returning the promise: TanStack awaits a
 * returned onSuccess promise before running the caller's callbacks, so a slow
 * status request would otherwise hold back the one-time backup codes.
 */
function useStatusRefresh(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: MFA_STATUS_QUERY_KEY });
  };
}

/** After a deadline the true state is unknown, so reload it for the card. */
const refreshIfOutcomeUnknown = (refresh: () => void) => (error: unknown) => {
  if (error instanceof MfaOutcomeUnknownError) refresh();
};

export function useConfirmMfaEnrolment() {
  const refresh = useStatusRefresh();
  return useMutation({
    ...sensitive("confirm"),
    mutationFn: async (code: string) =>
      (await postWithDeadline<BackupCodesPayload>("/enable/confirm", { code })).data.backupCodes,
    onSuccess: refresh,
    onError: refreshIfOutcomeUnknown(refresh),
  });
}

export function useRegenerateBackupCodes() {
  const refresh = useStatusRefresh();
  return useMutation({
    ...sensitive("regenerate"),
    mutationFn: async (code: string) =>
      (await postWithDeadline<BackupCodesPayload>("/backup-codes/regenerate", { code })).data.backupCodes,
    onSuccess: refresh,
    onError: refreshIfOutcomeUnknown(refresh),
  });
}

export function useDisableMfa() {
  const refresh = useStatusRefresh();
  return useMutation({
    ...sensitive("disable"),
    mutationFn: async (input: DisableMfaInput) => {
      await post<null>("/disable", input);
    },
    onSuccess: refresh,
  });
}
