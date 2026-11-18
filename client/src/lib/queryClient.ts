import {
  QueryClient,
  QueryFunction,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { getCsrfToken, clearCsrfToken } from "./csrf";

/** An Error carrying the HTTP status code that produced it. */
export type HttpError = Error & { status?: number };

/**
 * Routes that are legitimately reachable while unauthenticated. Background
 * queries on these pages 401 by design (there is no session yet) - the
 * mid-session 401 handler below must not redirect from here, or a login
 * failure / a forgot-password page background query would bounce the user
 * in a loop back to /login.
 */
const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  // Household invite page: signed-out visitors land here from the email.
  "/invite",
];

function isPublicPath(): boolean {
  if (typeof window === "undefined") return true;
  const path = window.location.pathname;
  return PUBLIC_PATHS.some(
    (publicPath) => path === publicPath || path.startsWith(`${publicPath}/`),
  );
}

// Guards against firing more than one redirect while navigation is in
// flight - harmless if it fires twice, but keeps things tidy.
let sessionExpiredHandled = false;

/**
 * Handle an auth 401 surfaced from ANY query or mutation, not just the
 * cached profile query (Layout.tsx already redirects on a profile-query
 * 401; this is the same recovery applied consistently everywhere else so a
 * mid-session 401 on other data/mutations doesn't fail silently and leave
 * the user staring at a broken page).
 *
 * Scoped to authenticated contexts only: on a public page (login,
 * forgot-password, reset-password, verify-email) a 401 is expected and
 * must NOT trigger a redirect, or it creates a redirect loop.
 */
function handleAuthExpired(): void {
  if (isPublicPath() || sessionExpiredHandled) return;
  sessionExpiredHandled = true;

  clearCsrfToken();
  queryClient.clear();
  window.location.assign("/login");
}

/**
 * 401 codes that mean "this action needs re-authentication", NOT "the session
 * is gone". A cancelled step-up dialog surfaces STEP_UP_REQUIRED (api.ts); the
 * session is still valid, so it must not sign the user out.
 */
const SESSION_PRESERVING_401_CODES = ["STEP_UP_REQUIRED"];

function isUnauthorizedError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && SESSION_PRESERVING_401_CODES.includes(code)) {
    return false;
  }
  const status = (error as HttpError | null)?.status;
  if (status === 401) return true;
  // Fallback for call sites that don't attach `.status` (older Error(`${res.status}: ...`) shape).
  const message = error instanceof Error ? error.message : "";
  return /^401\b/.test(message);
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    const fail = (message: string): never => {
      const error = new Error(message) as HttpError;
      error.status = res.status;
      throw error;
    };
    // Try to parse JSON error message if possible
    try {
      const json = JSON.parse(text);
      if (json.error && typeof json.error === "string") {
        fail(json.error);
      }
      if (json.message) {
        fail(json.message);
      }
      if (json.error?.message) {
        fail(json.error.message);
      }
    } catch (e) {
      // Ignore JSON parse error, fall back to text
    }
    fail(`${res.status}: ${text}`);
  }
}

const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

// The server enforces double-submit CSRF (csrf-csrf) on mutating routes, so a
// 403 body is inspected for the CSRF error code (clone() keeps the original
// body readable for throwIfResNotOk).
async function readErrorCode(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.clone().json();
    if (body && typeof body === "object" && "error" in body) {
      const error = (body as { error?: { code?: unknown } }).error;
      if (error && typeof error.code === "string") {
        return error.code;
      }
    }
  } catch {
    // Non-JSON 403 body — nothing to inspect.
  }
  return undefined;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const isMutating = MUTATING_METHODS.includes(method.toUpperCase());

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = data
      ? { "Content-Type": "application/json" }
      : {};
    if (isMutating) {
      headers["x-csrf-token"] = await getCsrfToken();
    }
    return fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });
  };

  let res = await send();

  // Mirror apiCall (lib/api.ts): a stale CSRF token self-heals — drop the
  // cached token on any 403 and retry the mutation once with a freshly
  // fetched one when the server says the token was invalid.
  if (isMutating && res.status === 403) {
    clearCsrfToken();
    if ((await readErrorCode(res)) === "CSRF_INVALID") {
      res = await send();
    }
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        handleAuthExpired();
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      // Avoid showing toasts for 403 as it usually reflects an expected
      // authorization boundary (private items, step-up gating, etc).
      if (!errorMessage.includes("403")) {
        toast.error("Error loading data", {
          description: errorMessage,
        });
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        handleAuthExpired();
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : "An unknown error occurred";
      toast.error("Action failed", {
        description: errorMessage,
      });
    },
  }),
});
