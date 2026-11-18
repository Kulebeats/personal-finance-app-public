/**
 * @vitest-environment jsdom
 *
 * useThandiChat hook — send flow, conversation threading, quota, error
 * mapping, and latest-thread restore, all against the real apiCall layer
 * with a fetch-level router (spec: ai-assistant-client-ui-spec.md §3-§6).
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThandiChat } from "../useThandiChat";
import type { ConversationDetails } from "../types";
import {
  AI_ROUTES,
  bodyOf,
  chatResponseFixture,
  conversationDetailsFixture,
  createFetchRouter,
  createWrapper,
  emptyConversationsFixture,
  errorResponse,
  installDefaultAiRoutes,
  jsonResponse,
  statusFixture,
} from "./chatTestUtils";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function setupHappyPath() {
  const router = createFetchRouter();
  const chatRoute = router.on("POST", AI_ROUTES.chat, () =>
    jsonResponse(chatResponseFixture),
  );
  installDefaultAiRoutes(router);
  router.install();
  return { router, chatRoute };
}

async function renderChatHook() {
  const { wrapper, queryClient } = createWrapper();
  const rendered = renderHook(() => useThandiChat(), { wrapper });
  await waitFor(() => expect(rendered.result.current.isRestoring).toBe(false));
  return { ...rendered, queryClient };
}

describe("useThandiChat — send flow", () => {
  it("appends the user message optimistically and the assistant reply on success", async () => {
    setupHappyPath();
    const { result } = await renderChatHook();

    act(() => {
      result.current.send("How much did we spend on groceries?");
    });

    // Optimistic user bubble appears immediately.
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "How much did we spend on groceries?",
    });
    expect(result.current.isSending).toBe(true);

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      content: chatResponseFixture.reply,
      toolsUsed: ["get_spending_by_category"],
    });
    expect(result.current.messages[1].provenance).toEqual(
      chatResponseFixture.provenance,
    );
    expect(result.current.isSending).toBe(false);
    expect(result.current.sendError).toBeNull();
  });

  it("threads the returned conversationId on subsequent sends", async () => {
    const { chatRoute } = setupHappyPath();
    const { result } = await renderChatHook();

    act(() => result.current.send("first question"));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    act(() => result.current.send("second question"));
    await waitFor(() => expect(result.current.messages).toHaveLength(4));

    expect(bodyOf(chatRoute.calls[0]).conversationId).toBeUndefined();
    expect(bodyOf(chatRoute.calls[1]).conversationId).toBe(
      chatResponseFixture.conversationId,
    );
  });

  it("ignores send() while a request is already in flight", async () => {
    const router = createFetchRouter();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chatRoute = router.on("POST", AI_ROUTES.chat, async () => {
      await gate;
      return jsonResponse(chatResponseFixture);
    });
    installDefaultAiRoutes(router);
    router.install();
    const { result } = await renderChatHook();

    act(() => result.current.send("first"));
    act(() => result.current.send("second (ignored)"));

    release?.();
    await waitFor(() => expect(result.current.isSending).toBe(false));
    expect(chatRoute.calls).toHaveLength(1);
    expect(result.current.messages).toHaveLength(2);
  });
});

describe("useThandiChat — quota", () => {
  it("seeds the remaining quota from /api/ai/status on mount", async () => {
    setupHappyPath();
    const { result } = await renderChatHook();

    await waitFor(() =>
      expect(result.current.quotaRemaining).toBe(
        statusFixture.rateLimit.remaining,
      ),
    );
    expect(result.current.isQuotaExhausted).toBe(false);
  });

  it("updates the remaining quota from each chat response", async () => {
    setupHappyPath();
    const { result } = await renderChatHook();

    act(() => result.current.send("q"));
    await waitFor(() => expect(result.current.quotaRemaining).toBe(49));
  });

  it("exposes isDegraded false by default (statusFixture has no degraded field)", async () => {
    setupHappyPath();
    const { result } = await renderChatHook();

    await waitFor(() => expect(result.current.quotaRemaining).not.toBeNull());
    expect(result.current.isDegraded).toBe(false);
  });

  it("exposes isDegraded true when /api/ai/status reports degraded: true", async () => {
    const router = createFetchRouter();
    router.on("POST", AI_ROUTES.chat, () => jsonResponse(chatResponseFixture));
    router.on("GET", AI_ROUTES.consent, () => jsonResponse({}));
    router.on("GET", AI_ROUTES.status, () =>
      jsonResponse({
        available: true,
        degraded: true,
        rateLimit: { remaining: 37, resetTime: "2026-07-18T00:00:00.000Z", isLimited: false },
      }),
    );
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(emptyConversationsFixture),
    );
    router.install();
    const { result } = await renderChatHook();

    await waitFor(() => expect(result.current.isDegraded).toBe(true));
  });

  it("maps a 429 to quota-exhausted, restores the draft, and fetches reset time", async () => {
    const router = createFetchRouter();
    router.on("POST", AI_ROUTES.chat, () =>
      errorResponse(429, "RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later."),
    );
    router.on("GET", AI_ROUTES.consent, () => jsonResponse({}));
    // Status returns exhausted state after the 429 refetch.
    router.on("GET", AI_ROUTES.status, () =>
      jsonResponse({
        available: true,
        rateLimit: {
          remaining: 0,
          resetTime: "2026-07-18T00:00:00.000Z",
          isLimited: true,
        },
      }),
    );
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(emptyConversationsFixture),
    );
    router.install();
    const { result } = await renderChatHook();

    act(() => result.current.send("over quota question"));

    await waitFor(() => expect(result.current.sendError?.kind).toBe("quota"));
    // Optimistic bubble is removed; draft restored to the composer.
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.restoredDraft).toBe("over quota question");
    expect(result.current.isQuotaExhausted).toBe(true);
    await waitFor(() =>
      expect(result.current.quotaResetTime).toBe("2026-07-18T00:00:00.000Z"),
    );
  });

  /**
   * The 429 carries Retry-After (delta-seconds) as of PR #124/#127/#135, so the
   * reset instant can be derived from the error itself. The status refetch stays
   * as a fallback — older deployments and other error paths still need it — but
   * it should no longer be REQUIRED to render "resets in about N hours".
   */
  it("derives quotaResetTime from the 429's Retry-After without needing the status refetch", async () => {
    const router = createFetchRouter();
    router.on("POST", AI_ROUTES.chat, () =>
      errorResponse(
        429,
        "RATE_LIMIT_EXCEEDED",
        "Too many requests. Please try again later.",
        {},
        { "Retry-After": "7200" }, // 2 hours
      ),
    );
    router.on("GET", AI_ROUTES.consent, () => jsonResponse({}));
    // Status deliberately reports NO reset time. If the hook still passes, the
    // value can only have come from the header.
    router.on("GET", AI_ROUTES.status, () =>
      jsonResponse({
        available: true,
        rateLimit: { remaining: 0, resetTime: null, isLimited: true },
      }),
    );
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(emptyConversationsFixture),
    );
    router.install();
    const { result } = await renderChatHook();

    const before = Date.now();
    act(() => result.current.send("over quota question"));

    await waitFor(() => expect(result.current.sendError?.kind).toBe("quota"));
    await waitFor(() => expect(result.current.quotaResetTime).not.toBeNull());

    // ~2h from now, expressed as the ISO instant the UI renders.
    const resetMs = new Date(result.current.quotaResetTime!).getTime();
    expect(Number.isNaN(resetMs)).toBe(false);
    const deltaSeconds = (resetMs - before) / 1000;
    expect(deltaSeconds).toBeGreaterThan(7195);
    expect(deltaSeconds).toBeLessThanOrEqual(7205);
  });

  it("falls back to the status refetch when the 429 carries no Retry-After", async () => {
    // Older deployments (pre-#124) send a bare 429. The fallback must survive.
    const router = createFetchRouter();
    router.on("POST", AI_ROUTES.chat, () =>
      errorResponse(429, "RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later."),
    );
    router.on("GET", AI_ROUTES.consent, () => jsonResponse({}));
    router.on("GET", AI_ROUTES.status, () =>
      jsonResponse({
        available: true,
        rateLimit: {
          remaining: 0,
          resetTime: "2026-07-18T00:00:00.000Z",
          isLimited: true,
        },
      }),
    );
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(emptyConversationsFixture),
    );
    router.install();
    const { result } = await renderChatHook();

    act(() => result.current.send("over quota question"));

    await waitFor(() => expect(result.current.sendError?.kind).toBe("quota"));
    await waitFor(() =>
      expect(result.current.quotaResetTime).toBe("2026-07-18T00:00:00.000Z"),
    );
  });
});

describe("useThandiChat — error mapping", () => {
  it("invalidates the aiConsent query on a 403 (consent revoked mid-session)", async () => {
    const router = createFetchRouter();
    router.on("POST", AI_ROUTES.chat, () =>
      errorResponse(
        403,
        "FORBIDDEN",
        "AI features require consent. Please enable AI assistant in Settings.",
      ),
    );
    installDefaultAiRoutes(router);
    router.install();
    const { result, queryClient } = await renderChatHook();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    act(() => result.current.send("question after revoke"));

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["aiConsent"] }),
    );
    expect(result.current.messages).toHaveLength(0);
  });

  it("keeps the user message and exposes a retryable outage error on a 500", async () => {
    const router = createFetchRouter();
    let failNext = true;
    const chatRoute = router.on("POST", AI_ROUTES.chat, () => {
      if (failNext) {
        failNext = false;
        return errorResponse(500, "INTERNAL_ERROR", "Failed to process AI query");
      }
      return jsonResponse(chatResponseFixture);
    });
    installDefaultAiRoutes(router);
    router.install();
    const { result } = await renderChatHook();

    act(() => result.current.send("flaky question"));

    await waitFor(() => expect(result.current.sendError?.kind).toBe("outage"));
    // 5.6: the user message stays in the transcript.
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "flaky question",
    });

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.sendError).toBeNull();
    // Retry resubmits the SAME message without duplicating the user bubble.
    expect(chatRoute.calls).toHaveLength(2);
    expect(bodyOf(chatRoute.calls[1]).message).toBe("flaky question");
  });

  it("removes the bubble and restores the draft on a 401 without a chat-specific error (state 5.7)", async () => {
    const router = createFetchRouter();
    router.on("POST", AI_ROUTES.chat, () =>
      errorResponse(401, "UNAUTHORIZED", "Authentication required"),
    );
    installDefaultAiRoutes(router);
    router.install();
    const { result } = await renderChatHook();

    act(() => result.current.send("question after session expiry"));

    await waitFor(() =>
      expect(result.current.restoredDraft).toBe("question after session expiry"),
    );
    // Session expiry is handled app-wide (redirect to login) — the hook must
    // not paint its own error state for it.
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.sendError).toBeNull();
    expect(result.current.isSending).toBe(false);
  });

  it("surfaces the field-level message on a 400 VALIDATION_ERROR and restores the draft", async () => {
    const router = createFetchRouter();
    router.on("POST", AI_ROUTES.chat, () =>
      errorResponse(400, "VALIDATION_ERROR", "Invalid request", {
        fields: [
          {
            field: "message",
            message: "Message exceeds maximum length of 1000 characters",
            code: "too_big",
          },
        ],
      }),
    );
    installDefaultAiRoutes(router);
    router.install();
    const { result } = await renderChatHook();

    act(() => result.current.send("some rejected input"));

    await waitFor(() =>
      expect(result.current.sendError?.kind).toBe("validation"),
    );
    expect(result.current.sendError?.message).toMatch(/exceeds maximum length/i);
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.restoredDraft).toBe("some rejected input");
  });
});

describe("useThandiChat — conversation restore and new chat", () => {
  it("restores the latest conversation on mount and threads it on the next send", async () => {
    const router = createFetchRouter();
    const chatRoute = router.on("POST", AI_ROUTES.chat, () =>
      jsonResponse({
        ...chatResponseFixture,
        conversationId: conversationDetailsFixture.id,
      }),
    );
    router.on("GET", AI_ROUTES.consent, () => jsonResponse({}));
    router.on("GET", AI_ROUTES.status, () => jsonResponse(statusFixture));
    router.on("GET", AI_ROUTES.conversationDetail, () =>
      jsonResponse(conversationDetailsFixture),
    );
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse({
        conversations: [
          {
            id: conversationDetailsFixture.id,
            createdAt: conversationDetailsFixture.createdAt,
            updatedAt: conversationDetailsFixture.updatedAt,
            messageCount: 2,
            preview: "How is my budget this month?",
          },
        ],
        total: 1,
        hasMore: false,
      }),
    );
    router.install();
    const { result } = await renderChatHook();

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "How is my budget this month?",
      timestamp: "2026-07-11T09:00:00.000Z",
    });
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      toolsUsed: ["get_budget_status"],
    });

    act(() => result.current.send("follow-up"));
    await waitFor(() => expect(chatRoute.calls).toHaveLength(1));
    expect(bodyOf(chatRoute.calls[0]).conversationId).toBe(
      conversationDetailsFixture.id,
    );
  });

  it("does not let a late restore clobber a thread the user already started", async () => {
    const router = createFetchRouter();
    const chatRoute = router.on("POST", AI_ROUTES.chat, () =>
      jsonResponse(chatResponseFixture),
    );
    router.on("GET", AI_ROUTES.consent, () => jsonResponse({}));
    router.on("GET", AI_ROUTES.status, () => jsonResponse(statusFixture));
    router.on("GET", AI_ROUTES.conversationDetail, () =>
      jsonResponse(conversationDetailsFixture),
    );
    let releaseRestore: (() => void) | undefined;
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    router.on("GET", AI_ROUTES.conversationList, async () => {
      await restoreGate;
      return jsonResponse({
        conversations: [
          {
            id: conversationDetailsFixture.id,
            createdAt: conversationDetailsFixture.createdAt,
            updatedAt: conversationDetailsFixture.updatedAt,
            messageCount: 2,
            preview: "How is my budget this month?",
          },
        ],
        total: 1,
        hasMore: false,
      });
    });
    router.install();

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useThandiChat(), { wrapper });

    // Send BEFORE the restore resolves: starts a fresh thread.
    act(() => result.current.send("eager question"));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(bodyOf(chatRoute.calls[0]).conversationId).toBeUndefined();

    releaseRestore?.();
    await waitFor(() => expect(result.current.isRestoring).toBe(false));

    // The late restore must not replace the live thread.
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe("eager question");
  });

  it("stays usable when the restore fetch fails", async () => {
    const router = createFetchRouter();
    router.on("POST", AI_ROUTES.chat, () => jsonResponse(chatResponseFixture));
    router.on("GET", AI_ROUTES.consent, () => jsonResponse({}));
    router.on("GET", AI_ROUTES.status, () => jsonResponse(statusFixture));
    router.on("GET", AI_ROUTES.conversationList, () =>
      errorResponse(500, "INTERNAL_ERROR", "boom"),
    );
    router.install();
    const { result } = await renderChatHook();

    expect(result.current.messages).toHaveLength(0);
    act(() => result.current.send("still works"));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
  });

  it("newChat clears the thread and the next send starts a fresh conversation", async () => {
    const { chatRoute } = setupHappyPath();
    const { result } = await renderChatHook();

    act(() => result.current.send("first"));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    act(() => result.current.newChat());
    expect(result.current.messages).toHaveLength(0);

    act(() => result.current.send("fresh start"));
    await waitFor(() => expect(chatRoute.calls).toHaveLength(2));
    expect(bodyOf(chatRoute.calls[1]).conversationId).toBeUndefined();
  });
});

describe("useThandiChat — loadConversation (history rail)", () => {
  const OTHER_THREAD: ConversationDetails = {
    ...conversationDetailsFixture,
    id: "00000000-0000-4000-8000-000000000007",
    messages: [
      {
        role: "user",
        content: "How did groceries trend?",
        timestamp: "2026-07-10T08:00:00.000Z",
      },
      {
        role: "assistant",
        content: "They fell 12% versus May.",
        timestamp: "2026-07-10T08:00:03.000Z",
        toolsUsed: ["get_spending_by_category"],
      },
    ],
  };

  it("swaps the transcript to the selected thread and threads its id on the next send", async () => {
    const { chatRoute } = setupHappyPath();
    const { result } = await renderChatHook();

    act(() => result.current.loadConversation(OTHER_THREAD));

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "How did groceries trend?",
      timestamp: "2026-07-10T08:00:00.000Z",
    });
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      toolsUsed: ["get_spending_by_category"],
    });

    act(() => result.current.send("and July?"));
    await waitFor(() => expect(chatRoute.calls).toHaveLength(1));
    expect(bodyOf(chatRoute.calls[0]).conversationId).toBe(OTHER_THREAD.id);
  });

  it("exposes the active conversation id, and newChat clears it", async () => {
    setupHappyPath();
    const { result } = await renderChatHook();

    expect(result.current.activeConversationId).toBeUndefined();

    act(() => result.current.loadConversation(OTHER_THREAD));
    expect(result.current.activeConversationId).toBe(OTHER_THREAD.id);

    act(() => result.current.newChat());
    expect(result.current.activeConversationId).toBeUndefined();
  });

  it("tracks the server's conversation id after a send", async () => {
    setupHappyPath();
    const { result } = await renderChatHook();

    act(() => result.current.send("first"));
    await waitFor(() =>
      expect(result.current.activeConversationId).toBe(
        chatResponseFixture.conversationId,
      ),
    );
  });

  it("is not clobbered by a late latest-thread restore", async () => {
    const router = createFetchRouter();
    router.on("POST", AI_ROUTES.chat, () => jsonResponse(chatResponseFixture));
    router.on("GET", AI_ROUTES.consent, () => jsonResponse({}));
    router.on("GET", AI_ROUTES.status, () => jsonResponse(statusFixture));
    router.on("GET", AI_ROUTES.conversationDetail, () =>
      jsonResponse(conversationDetailsFixture),
    );
    let releaseRestore: (() => void) | undefined;
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    router.on("GET", AI_ROUTES.conversationList, async () => {
      await restoreGate;
      return jsonResponse({
        conversations: [
          {
            id: conversationDetailsFixture.id,
            createdAt: conversationDetailsFixture.createdAt,
            updatedAt: conversationDetailsFixture.updatedAt,
            messageCount: 2,
            preview: "How is my budget this month?",
          },
        ],
        total: 1,
        hasMore: false,
      });
    });
    router.install();

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useThandiChat(), { wrapper });

    // Pick a thread from the rail before the mount-restore resolves.
    act(() => result.current.loadConversation(OTHER_THREAD));
    releaseRestore?.();
    await waitFor(() => expect(result.current.isRestoring).toBe(false));

    expect(result.current.activeConversationId).toBe(OTHER_THREAD.id);
    expect(result.current.messages[0].content).toBe("How did groceries trend?");
  });

  it("clears a pending outage error when another thread is selected", async () => {
    const router = createFetchRouter();
    router.on("POST", AI_ROUTES.chat, () =>
      errorResponse(503, "SERVICE_UNAVAILABLE", "down"),
    );
    installDefaultAiRoutes(router);
    router.install();
    const { result } = await renderChatHook();

    act(() => result.current.send("boom"));
    await waitFor(() => expect(result.current.sendError?.kind).toBe("outage"));

    act(() => result.current.loadConversation(OTHER_THREAD));
    expect(result.current.sendError).toBeNull();
  });
});
