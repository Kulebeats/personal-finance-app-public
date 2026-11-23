import { assertOperationLifetime, captureOperationLifetime, operationPreconditions } from "./operation-lifetime";
import { invalidateSession } from "./session";

/** Cookie authority must still match the immutable originating UI context. */
export async function protectedFetch(input: RequestInfo | URL, init: RequestInit = {}, operation = captureOperationLifetime()): Promise<Response> {
  assertOperationLifetime(operation);
  const headers: Record<string, string> = init.headers instanceof Headers || Array.isArray(init.headers)
    ? Object.fromEntries(new Headers(init.headers).entries())
    : { ...init.headers };
  Object.assign(headers, operationPreconditions(operation));
  const response = await fetch(input, { ...init, headers, credentials: "include" });
  assertOperationLifetime(operation);
  const contextBound = !!operation?.expectations;
  if (response.status === 409 || (contextBound && [401, 403, 404].includes(response.status))) {
    const body = await response.clone().json().catch(() => null);
    assertOperationLifetime(operation);
    const code = body?.error?.code;
    const contextChanged = code === "SESSION_CONTEXT_CHANGED";
    const authorityChanged = contextBound && (
      (response.status === 401 && !["STEP_UP_REQUIRED", "INVALID_CREDENTIALS"].includes(code)) ||
      ["EMAIL_VERIFICATION_REQUIRED", "MFA_ENROLMENT_REQUIRED", "HOUSEHOLD_NOT_FOUND"].includes(code)
    );
    if (contextChanged || authorityChanged) {
      const error = Object.assign(
        new Error(body?.error?.message || "Your session context changed. Please start this action again."),
        { status: response.status, code: code || "UNAUTHENTICATED" },
      );
      invalidateSession(error.message);
      throw error;
    }
  }
  return response;
}
