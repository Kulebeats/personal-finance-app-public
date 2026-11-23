import { userErrorMessage } from "@/lib/errorCopy";
import { QueryClient, type QueryFunction, QueryCache, MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { getCsrfToken, clearCsrfToken } from "./csrf";
import { assertOperationLifetime, captureOperationLifetime, StaleOperationError, type OperationLifetime } from "./operation-lifetime";
import { requestStepUp } from "./api";
import { protectedFetch } from "./protected-fetch";

export type HttpError = Error & { status?: number; code?: string };

export async function throwIfResNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const text = (await res.text()) || res.statusText;
  let body: { error?: string | { message?: string; code?: string }; message?: string } | undefined;
  try { body = JSON.parse(text); } catch { /* Preserve the raw non-JSON failure. */ }
  const detail = typeof body?.error === "object" ? body.error : undefined;
  const error = new Error(detail?.message || (typeof body?.error === "string" ? body.error : body?.message) || `${res.status}: ${text}`) as HttpError;
  error.status = res.status;
  error.code = detail?.code;
  throw error;
}

export async function apiRequest(method: string, url: string, data?: unknown, operation = captureOperationLifetime()): Promise<Response> {
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
  const send = async () => {
    assertOperationLifetime(operation);
    const headers: Record<string, string> = data ? { "Content-Type": "application/json" } : {};
    if (isMutating) headers["x-csrf-token"] = await getCsrfToken();
    assertOperationLifetime(operation);
    return protectedFetch(url, { method, headers, body: data ? JSON.stringify(data) : undefined, credentials: "include" }, operation);
  };
  let res = await send();
  const errorBody = async (response: Response) => response.clone().json().catch(() => null);
  if (isMutating && res.status === 403) {
    const body = await errorBody(res);
    assertOperationLifetime(operation);
    if (body?.error?.code === "CSRF_INVALID") { clearCsrfToken(); res = await send(); }
  }
  if (res.status === 401) {
    const body = await errorBody(res);
    assertOperationLifetime(operation);
    if (body?.error?.code === "STEP_UP_REQUIRED") {
      assertOperationLifetime(operation);
      if (await requestStepUp(body.level ?? "SETTINGS")) { assertOperationLifetime(operation); res = await send(); }
    }
  }
  assertOperationLifetime(operation);
  await throwIfResNotOk(res);
  return res;
}

export const getQueryFn: <T>(options: { on401: "returnNull" | "throw"; operation?: OperationLifetime | null }) => QueryFunction<T> =
  ({ on401, operation = captureOperationLifetime() }) => async ({ queryKey, signal }) => {
    assertOperationLifetime(operation);
    const res = await protectedFetch(queryKey.join("/"), { credentials: "include", signal }, operation);
    assertOperationLifetime(operation);
    if (on401 === "returnNull" && res.status === 401) return null;
    await throwIfResNotOk(res);
    return res.json();
  };

const retiredClients = new WeakSet<QueryClient>();
type ClientMutationOptions = NonNullable<Parameters<QueryClient["defaultMutationOptions"]>[0]>;

/** Bind every observer option update, including rerenders during onMutate. */
class LifetimeQueryClient extends QueryClient {
  private readonly boundOptions = new WeakSet<object>();

  constructor(config: ConstructorParameters<typeof QueryClient>[0], private readonly operation?: OperationLifetime | null) { super(config); }

  override defaultMutationOptions<T extends ClientMutationOptions>(options?: T): T {
    const resolved = super.defaultMutationOptions(options);
    const operation = this.operation;
    if (!operation || this.boundOptions.has(resolved)) return resolved;
    const original = resolved.mutationFn;
    const active = () => operation.active && !retiredClients.has(this);
    const bound: T = {
      ...resolved,
      mutationFn: original ? (variables, context) => { assertOperationLifetime(operation); return original(variables, context); } : undefined,
      onSuccess: (...args) => active() ? resolved.onSuccess?.(...args) : undefined,
      onError: (...args) => active() ? resolved.onError?.(...args) : undefined,
      onSettled: (...args) => active() ? resolved.onSettled?.(...args) : undefined,
    };
    this.boundOptions.add(bound);
    return bound;
  }
}

export function retireDataClient(client: QueryClient): void {
  retiredClients.add(client);
  void client.cancelQueries();
  client.clear();
}

/**
 * NEW-28: how long fetched data counts as fresh. Each member's own writes
 * invalidate their queries, but nothing tells this browser about another
 * member's write, so data must go stale: a partner's shared transaction then
 * shows on the next visit or when the window regains focus.
 */
export const DATA_STALE_TIME_MS = 30_000;

/**
 * A failed save with no code or status to say more, e.g. a success reply the
 * client rejected as malformed or contradictory: the draft is kept for retry.
 */
export const MUTATION_FAILED_COPY = "Your change may not have been saved. Check it and try again.";

export function createDataQueryClient(onBoundaryError?: (withdraw: boolean) => void, operation?: OperationLifetime | null): QueryClient {
  const onError = (error: unknown, mutation = false) => {
    if (retiredClients.has(client) || error instanceof StaleOperationError) return;
    const failure = error as HttpError;
    if (onBoundaryError && ((failure.status === 401 && !["STEP_UP_REQUIRED", "INVALID_CREDENTIALS"].includes(failure.code || "")) || ["EMAIL_VERIFICATION_REQUIRED", "MFA_ENROLMENT_REQUIRED", "HOUSEHOLD_NOT_FOUND", "SESSION_CONTEXT_CHANGED"].includes(failure.code || ""))) {
      onBoundaryError(true);
      return;
    }
    // UX-01: with no session boundary this is a public page (e.g. /invite/:code). A query's 401 there
    // only means "signed out", which the page shows itself; a public form's failure still toasts.
    if (!onBoundaryError && !mutation && failure.status === 401) return;
    if (failure.status === 403) onBoundaryError?.(false);
    toast.error(mutation ? "Action failed" : "Error loading data", { description: userErrorMessage(error, mutation ? MUTATION_FAILED_COPY : "An unknown error occurred") });
  };
  const client = new LifetimeQueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "throw", operation }), refetchInterval: false, refetchOnWindowFocus: true, staleTime: DATA_STALE_TIME_MS, retry: false },
      mutations: { retry: false },
    },
    queryCache: new QueryCache({ onError: error => onError(error) }),
    mutationCache: new MutationCache({ onError: error => onError(error, true) }),
  }, operation);
  return client;
}

/** Compatibility for isolated consumers. App always creates its own lifetime clients. */
export const queryClient = createDataQueryClient();
