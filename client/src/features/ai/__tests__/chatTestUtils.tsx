/**
 * Shared test utilities for the Thandi chat UI suite.
 *
 * All AI endpoints return RAW JSON (no V7 envelope) on success and a V7
 * error envelope on failure — see
 * docs/ai-integration/specifications/ai-assistant-api-spec.md (v3.0).
 *
 * The fetch router serves GET /api/csrf-token transparently so apiCall's
 * CSRF pre-fetch never consumes per-test mocks (repo gotcha: mixing the
 * CSRF fetch with mockResolvedValueOnce queues breaks the once-queue).
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import type {
  AIStatusResponse,
  ChatResponse,
  ConversationDetails,
  ConversationListResponse,
  ConversationSummary,
} from "../types";
import type { AIConsentStatus } from "@/hooks/use-settings";

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    // A real Response ALWAYS has headers. Include a genuine Headers instance so
    // callers that read them (e.g. apiCall reading Retry-After off a 429) behave
    // here exactly as they do against the real fetch.
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

/**
 * A 204 No Content response: empty body, and .json() rejects exactly as the
 * real one does (DELETE /api/ai/conversations/:id — api-spec §7.3).
 */
export function noContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected end of JSON input")),
  } as unknown as Response;
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(
    { success: false, error: { code, message, ...extra } },
    status,
    headers,
  );
}

// ---------------------------------------------------------------------------
// Fetch router
// ---------------------------------------------------------------------------

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

interface Route {
  method: string;
  matcher: RegExp;
  handler: (init?: RequestInit) => Response | Promise<Response>;
  calls: RecordedCall[];
}

export interface FetchRouter {
  /** Register a handler; first matching route wins. */
  on(
    method: string,
    matcher: RegExp,
    handler: (init?: RequestInit) => Response | Promise<Response>,
  ): Route;
  /** All calls that hit a given registered route. */
  callsFor(route: Route): RecordedCall[];
  /** Install as global fetch (also serves /api/csrf-token). */
  install(): void;
}

export function createFetchRouter(): FetchRouter {
  const routes: Route[] = [];

  return {
    on(method, matcher, handler) {
      const route: Route = { method: method.toUpperCase(), matcher, handler, calls: [] };
      routes.push(route);
      return route;
    },
    callsFor(route) {
      return route.calls;
    },
    install() {
      clearCsrfToken();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.includes("/csrf-token")) {
            return jsonResponse({ csrfToken: "test-csrf" });
          }
          const method = (init?.method ?? "GET").toUpperCase();
          const route = routes.find(
            (r) => r.method === method && r.matcher.test(url),
          );
          if (!route) {
            return errorResponse(
              500,
              "TEST_UNMATCHED_FETCH",
              `Unmatched fetch in test: ${method} ${url}`,
            );
          }
          route.calls.push({ url, init });
          return route.handler(init);
        }),
      );
    },
  };
}

/** Parse the JSON body a route received. */
export function bodyOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body ?? "{}")) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Fixtures (shapes verified against server/modules/ai code)
// ---------------------------------------------------------------------------

export const consentGrantedFixture: AIConsentStatus = {
  consentGiven: true,
  consentDate: "2026-02-01T10:00:00.000Z",
  consentVersion: "v1.0",
  currentVersion: "v1.0",
  needsReconsent: false,
};

export const consentAbsentFixture: AIConsentStatus = {
  consentGiven: false,
  consentDate: null,
  consentVersion: "v1.0",
  currentVersion: "v1.0",
  needsReconsent: false,
};

export const statusFixture: AIStatusResponse = {
  available: true,
  rateLimit: {
    remaining: 37,
    resetTime: "2026-07-13T00:00:00.000Z",
    isLimited: false,
  },
};

export const emptyConversationsFixture: ConversationListResponse = {
  conversations: [],
  total: 0,
  hasMore: false,
};

export const chatResponseFixture: ChatResponse = {
  reply: "You spent K2,145.00 on groceries this month.",
  conversationId: "9f3a8614-72b2-4bb6-a4a4-5ba8af59e7a2",
  toolsUsed: ["get_spending_by_category"],
  tokenCount: 842,
  remainingQueries: 49,
  provenance: {
    dataWindow: { start: "2026-06-12", end: "2026-07-12" },
    freshnessTs: "2026-07-12T14:10:00.000Z",
    tools: ["get_spending_by_category"],
  },
};

/**
 * Build a conversation summary. Ids are real-shaped UUIDs so they match the
 * AI_ROUTES.conversationDetail matcher (which mirrors the server's uuid param
 * validation).
 */
export function conversationSummaryFixture(
  index: number,
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  return {
    id,
    createdAt: "2026-07-12T09:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
    messageCount: 4,
    preview: `Conversation ${index}`,
    ...overrides,
  };
}

/** A page of the conversation list, matching the server's list response. */
export function conversationListFixture(
  indexes: number[],
  hasMore: boolean,
  total = indexes.length,
): ConversationListResponse {
  return {
    conversations: indexes.map((index) => conversationSummaryFixture(index)),
    total,
    hasMore,
  };
}

export const conversationDetailsFixture: ConversationDetails = {
  id: "5b3c1a22-9d10-4a8e-8f77-1c2d3e4f5a6b",
  householdId: "hh-1",
  userId: "u1",
  messages: [
    {
      role: "user",
      content: "How is my budget this month?",
      timestamp: "2026-07-11T09:00:00.000Z",
    },
    {
      role: "assistant",
      content: "Your budgets are on track overall.",
      timestamp: "2026-07-11T09:00:02.000Z",
      toolsUsed: ["get_budget_status"],
    },
  ],
  createdAt: "2026-07-11T09:00:00.000Z",
  updatedAt: "2026-07-11T09:00:02.000Z",
};

// ---------------------------------------------------------------------------
// Standard AI route matchers
// ---------------------------------------------------------------------------

export const AI_ROUTES = {
  chat: /\/api\/ai\/chat$/,
  status: /\/api\/ai\/status$/,
  consent: /\/api\/ai\/consent$/,
  conversationList: /\/api\/ai\/conversations(\?|$)/,
  conversationDetail: /\/api\/ai\/conversations\/[0-9a-f-]{36}$/,
} as const;

/**
 * Register the baseline happy-path routes most tests need. Individual tests
 * override by registering more specific behavior BEFORE calling this, since
 * first match wins.
 */
export function installDefaultAiRoutes(router: FetchRouter): void {
  router.on("GET", AI_ROUTES.consent, () => jsonResponse(consentGrantedFixture));
  router.on("GET", AI_ROUTES.status, () => jsonResponse(statusFixture));
  router.on("GET", AI_ROUTES.conversationDetail, () =>
    jsonResponse(conversationDetailsFixture),
  );
  router.on("GET", AI_ROUTES.conversationList, () =>
    jsonResponse(emptyConversationsFixture),
  );
}

// ---------------------------------------------------------------------------
// React Query wrapper
// ---------------------------------------------------------------------------

export function createWrapper(): {
  queryClient: QueryClient;
  wrapper: ({ children }: { children: ReactNode }) => JSX.Element;
} {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}
