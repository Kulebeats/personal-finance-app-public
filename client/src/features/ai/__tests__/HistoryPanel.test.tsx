/**
 * @vitest-environment jsdom
 *
 * HistoryPanel — conversation history rail (spec UI-AI-006b, v1.1 plan §2).
 *
 * Exercised against the real apiCall layer with a fetch-level router, so the
 * paging contract (limit/offset/hasMore) and the 204-on-delete contract are
 * asserted as the server actually behaves (verified in
 * server/modules/ai/ai.controller.ts + ai.conversation.service.ts).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryPanel } from "../components/HistoryPanel";
import {
  AI_ROUTES,
  conversationDetailsFixture,
  conversationListFixture,
  createFetchRouter,
  createWrapper,
  emptyConversationsFixture,
  errorResponse,
  jsonResponse,
  noContentResponse,
  type FetchRouter,
} from "./chatTestUtils";

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock("sonner", async (importOriginal) => {
  const original = await importOriginal<typeof import("sonner")>();
  return {
    ...original,
    toast: {
      ...original.toast,
      success: (...args: unknown[]) => mockToastSuccess(...args),
      error: (...args: unknown[]) => mockToastError(...args),
    },
  };
});

const FIRST_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  // Relative timestamps ("2 hours ago") need a stable now.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-07-12T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

interface RenderOptions {
  activeConversationId?: string;
  onSelectConversation?: (details: unknown) => void;
  onActiveConversationDeleted?: () => void;
}

function renderPanel(router: FetchRouter, options: RenderOptions = {}) {
  router.install();
  const { wrapper } = createWrapper();
  const onSelectConversation = options.onSelectConversation ?? vi.fn();
  const onActiveConversationDeleted =
    options.onActiveConversationDeleted ?? vi.fn();
  const view = render(
    <HistoryPanel
      activeConversationId={options.activeConversationId}
      onSelectConversation={onSelectConversation}
      onActiveConversationDeleted={onActiveConversationDeleted}
    />,
    { wrapper },
  );
  return { ...view, onSelectConversation, onActiveConversationDeleted };
}

/** The always-mounted desktop rail (the mobile Sheet renders on demand). */
function rail(): HTMLElement {
  return screen.getByRole("navigation", { name: /conversation history/i });
}

describe("HistoryPanel — listing", () => {
  it("lists conversations with preview, message count, and a relative updated time", async () => {
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(conversationListFixture([1, 2], false)),
    );
    renderPanel(router);

    await waitFor(() =>
      expect(
        within(rail()).getByRole("button", { name: /^Conversation 1\b/ }),
      ).toBeInTheDocument(),
    );
    const item = within(rail()).getByRole("button", { name: /^Conversation 1\b/ });
    // updatedAt is 10:00Z, now is 12:00Z.
    expect(item).toHaveTextContent(/2 hours ago/i);
    expect(item).toHaveTextContent(/4 messages/i);
    expect(
      within(rail()).getByRole("button", { name: /^Conversation 2\b/ }),
    ).toBeInTheDocument();
  });

  it("requests the first page with the server's 10/page default", async () => {
    const router = createFetchRouter();
    const listRoute = router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(conversationListFixture([1], false)),
    );
    renderPanel(router);

    await waitFor(() => expect(listRoute.calls).toHaveLength(1));
    expect(listRoute.calls[0].url).toContain("limit=10");
    expect(listRoute.calls[0].url).toContain("offset=0");
  });

  it("appends the next page via Load more and hides the control when hasMore is false", async () => {
    const user = userEvent.setup();
    const router = createFetchRouter();
    const listRoute = router.on("GET", AI_ROUTES.conversationList, (init) => {
      void init;
      const isSecondPage = listRoute.calls.some((call) =>
        call.url.includes("offset=10"),
      );
      return jsonResponse(
        isSecondPage
          ? conversationListFixture([11], false, 11)
          : conversationListFixture(
              [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
              true,
              11,
            ),
      );
    });
    renderPanel(router);

    await waitFor(() =>
      expect(
        within(rail()).getByRole("button", { name: /^Conversation 1\b/ }),
      ).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() =>
      expect(
        within(rail()).getByRole("button", { name: /^Conversation 11\b/ }),
      ).toBeInTheDocument(),
    );
    // Page 1 items are still present (appended, not replaced).
    expect(
      within(rail()).getByRole("button", { name: /^Conversation 1\b/ }),
    ).toBeInTheDocument();
    expect(listRoute.calls[1].url).toContain("offset=10");
    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state when the user has no history", async () => {
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(emptyConversationsFixture),
    );
    renderPanel(router);

    await waitFor(() =>
      expect(within(rail()).getByText(/no conversations yet/i)).toBeInTheDocument(),
    );
  });

  it("shows an error state with a retry when the list fails to load", async () => {
    const router = createFetchRouter();
    const listRoute = router.on("GET", AI_ROUTES.conversationList, () =>
      errorResponse(500, "INTERNAL_ERROR", "boom"),
    );
    renderPanel(router);

    const retry = await screen.findByRole("button", { name: /try again/i });
    await userEvent.setup().click(retry);
    await waitFor(() => expect(listRoute.calls.length).toBeGreaterThan(1));
  });
});

describe("HistoryPanel — selecting a thread", () => {
  it("loads the conversation and hands the details to the caller", async () => {
    const user = userEvent.setup();
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(conversationListFixture([1], false)),
    );
    const detailRoute = router.on("GET", AI_ROUTES.conversationDetail, () =>
      jsonResponse({ ...conversationDetailsFixture, id: FIRST_ID }),
    );
    const { onSelectConversation } = renderPanel(router);

    await waitFor(() =>
      expect(
        within(rail()).getByRole("button", { name: /^Conversation 1\b/ }),
      ).toBeInTheDocument(),
    );
    await user.click(
      within(rail()).getByRole("button", { name: /^Conversation 1\b/ }),
    );

    await waitFor(() => expect(onSelectConversation).toHaveBeenCalledTimes(1));
    expect(detailRoute.calls[0].url).toContain(FIRST_ID);
    expect(onSelectConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: FIRST_ID }),
    );
  });

  it("marks the active conversation with aria-current", async () => {
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(conversationListFixture([1, 2], false)),
    );
    renderPanel(router, { activeConversationId: FIRST_ID });

    await waitFor(() =>
      expect(
        within(rail()).getByRole("button", { name: /^Conversation 1\b/ }),
      ).toHaveAttribute("aria-current", "true"),
    );
    expect(
      within(rail()).getByRole("button", { name: /^Conversation 2\b/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("surfaces an error and does not swap the transcript when the load fails", async () => {
    const user = userEvent.setup();
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(conversationListFixture([1], false)),
    );
    router.on("GET", AI_ROUTES.conversationDetail, () =>
      errorResponse(404, "NOT_FOUND", "Conversation not found"),
    );
    const { onSelectConversation } = renderPanel(router);

    await waitFor(() =>
      expect(
        within(rail()).getByRole("button", { name: /^Conversation 1\b/ }),
      ).toBeInTheDocument(),
    );
    await user.click(
      within(rail()).getByRole("button", { name: /^Conversation 1\b/ }),
    );

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(onSelectConversation).not.toHaveBeenCalled();
  });
});

describe("HistoryPanel — delete", () => {
  function setupDelete(deleteHandler: () => Response) {
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(conversationListFixture([1], false)),
    );
    const deleteRoute = router.on(
      "DELETE",
      AI_ROUTES.conversationDetail,
      deleteHandler,
    );
    return { router, deleteRoute };
  }

  async function openConfirm(): Promise<void> {
    await waitFor(() =>
      expect(
        within(rail()).getByRole("button", { name: /^delete conversation:/i }),
      ).toBeInTheDocument(),
    );
    await userEvent
      .setup()
      .click(
        within(rail()).getByRole("button", { name: /^delete conversation:/i }),
      );
  }

  it("asks for confirmation before deleting and does nothing on cancel", async () => {
    const { router, deleteRoute } = setupDelete(() => noContentResponse());
    renderPanel(router);
    await openConfirm();

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/delete/i);
    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(deleteRoute.calls).toHaveLength(0);
  });

  it("deletes on confirm and handles the empty 204 body without throwing", async () => {
    const { router, deleteRoute } = setupDelete(() => noContentResponse());
    renderPanel(router);
    await openConfirm();

    const dialog = await screen.findByRole("alertdialog");
    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(deleteRoute.calls).toHaveLength(1));
    expect(deleteRoute.calls[0].url).toContain(FIRST_ID);
    // A CSRF-aware mutation: the shared helper must have attached the token.
    expect(
      (deleteRoute.calls[0].init?.headers as Record<string, string>)[
        "x-csrf-token"
      ],
    ).toBe("test-csrf");
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("falls back to a fresh chat when the deleted thread is the active one", async () => {
    const { router } = setupDelete(() => noContentResponse());
    const { onActiveConversationDeleted } = renderPanel(router, {
      activeConversationId: FIRST_ID,
    });
    await openConfirm();

    const dialog = await screen.findByRole("alertdialog");
    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(onActiveConversationDeleted).toHaveBeenCalledTimes(1),
    );
  });

  it("leaves the active thread alone when a different thread is deleted", async () => {
    const { router } = setupDelete(() => noContentResponse());
    const { onActiveConversationDeleted } = renderPanel(router, {
      activeConversationId: "00000000-0000-4000-8000-000000000999",
    });
    await openConfirm();

    const dialog = await screen.findByRole("alertdialog");
    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    expect(onActiveConversationDeleted).not.toHaveBeenCalled();
  });

  it("treats a 404 (already deleted elsewhere) as gracefully resolved", async () => {
    const { router } = setupDelete(() =>
      errorResponse(404, "NOT_FOUND", "Conversation not found"),
    );
    const listCallsBefore = renderPanel(router, {
      activeConversationId: FIRST_ID,
    });
    void listCallsBefore;
    await openConfirm();

    const dialog = await screen.findByRole("alertdialog");
    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: /^delete$/i }));

    // Already gone is the desired end state, not a hard error.
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalled());
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("reports a real failure (500) as an error and keeps the thread", async () => {
    const { router } = setupDelete(() =>
      errorResponse(500, "INTERNAL_ERROR", "boom"),
    );
    const { onActiveConversationDeleted } = renderPanel(router, {
      activeConversationId: FIRST_ID,
    });
    await openConfirm();

    const dialog = await screen.findByRole("alertdialog");
    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(onActiveConversationDeleted).not.toHaveBeenCalled();
  });
});

describe("HistoryPanel — accessibility", () => {
  it("exposes a labeled nav with a real list of buttons", async () => {
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(conversationListFixture([1, 2], false)),
    );
    renderPanel(router);

    await waitFor(() =>
      expect(within(rail()).getAllByRole("listitem")).toHaveLength(2),
    );
    expect(within(rail()).getByRole("list")).toBeInTheDocument();
    for (const item of within(rail()).getAllByRole("listitem")) {
      expect(within(item).getAllByRole("button").length).toBeGreaterThan(0);
    }
  });

  it("opens the history in a focus-managed sheet on small viewports", async () => {
    const user = userEvent.setup();
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(conversationListFixture([1], false)),
    );
    renderPanel(router);

    // The mobile affordance is always in the DOM (CSS-hidden on ≥lg), matching
    // the SettingsLayout precedent.
    const trigger = screen.getByRole("button", { name: /show conversation history/i });
    await user.click(trigger);

    const sheet = await screen.findByRole("dialog");
    expect(
      within(sheet).getByRole("navigation", { name: /conversation history/i }),
    ).toBeInTheDocument();
  });
});
