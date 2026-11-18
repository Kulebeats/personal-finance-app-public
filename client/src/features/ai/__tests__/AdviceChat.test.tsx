/**
 * @vitest-environment jsdom
 *
 * AdviceChat container — consent gating, chat states (spec §5), and
 * accessibility smoke checks (spec §7), against real hooks with a
 * fetch-level router.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdviceChat } from "../AdviceChat";
import {
  AI_ROUTES,
  bodyOf,
  chatResponseFixture,
  consentAbsentFixture,
  createFetchRouter,
  createWrapper,
  emptyConversationsFixture,
  errorResponse,
  installDefaultAiRoutes,
  jsonResponse,
  statusFixture,
} from "./chatTestUtils";
import type { UseQueryResult } from "@tanstack/react-query";
import type { HouseholdMember, UserProfile } from "@/hooks/use-settings";

const mockUseProfile = vi.fn();
const mockUseHouseholdMembers = vi.fn();

vi.mock("@/hooks/use-settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/hooks/use-settings")>();
  return {
    ...original,
    useProfile: (...args: []) => mockUseProfile(...args),
    useHouseholdMembers: (...args: []) => mockUseHouseholdMembers(...args),
  };
});

function stubMemberRole(): void {
  mockUseProfile.mockReturnValue({
    data: { id: "u1" } as unknown as UserProfile,
    isLoading: false,
  } as UseQueryResult<UserProfile, Error>);
  mockUseHouseholdMembers.mockReturnValue({
    data: [
      {
        id: "m1",
        householdId: "hh-1",
        userId: "u1",
        role: "member",
      } as unknown as HouseholdMember,
    ],
    isLoading: false,
  } as UseQueryResult<HouseholdMember[], Error>);
}

function renderChat(): void {
  const { wrapper: Wrapper } = createWrapper();
  render(
    <Wrapper>
      <AdviceChat />
    </Wrapper>,
  );
}

function setupConsented() {
  const router = createFetchRouter();
  const chatRoute = router.on("POST", AI_ROUTES.chat, () =>
    jsonResponse(chatResponseFixture),
  );
  installDefaultAiRoutes(router);
  router.install();
  return { router, chatRoute };
}

const composerLabel = /ask thandi a question/i;

async function waitForComposer(): Promise<HTMLElement> {
  return await screen.findByLabelText(composerLabel);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AdviceChat — consent gating", () => {
  it("renders the consent gate instead of the composer when consent is absent", async () => {
    stubMemberRole();
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.consent, () =>
      jsonResponse(consentAbsentFixture),
    );
    router.on("GET", AI_ROUTES.status, () => jsonResponse(statusFixture));
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(emptyConversationsFixture),
    );
    router.install();

    renderChat();

    expect(
      await screen.findByText(/ask a household admin to enable thandi/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(composerLabel)).not.toBeInTheDocument();
  });
});

describe("AdviceChat — empty state", () => {
  it("shows suggested prompts and expectation-setting helper text", async () => {
    stubMemberRole();
    setupConsented();
    renderChat();

    await waitForComposer();
    // The empty state appears once the latest-thread restore has resolved.
    expect(
      await screen.findByRole("button", { name: /how is my budget this month/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /top spending categories/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /what bills are coming up/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /savings goals/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ask a follow-up any time/i),
    ).toBeInTheDocument();
  });

  it("seeds the quota indicator from /api/ai/status", async () => {
    stubMemberRole();
    setupConsented();
    renderChat();

    expect(
      await screen.findByText(/37 questions left today/i),
    ).toBeInTheDocument();
  });
});

describe("AdviceChat — send flow", () => {
  it("sends on Enter, shows a typing indicator, then renders the reply with provenance", async () => {
    stubMemberRole();
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
    renderChat();

    const composer = await waitForComposer();
    await userEvent.type(composer, "How much on groceries?");
    await userEvent.keyboard("{Enter}");

    // In-flight: user bubble + typing indicator, composer disabled, log busy.
    expect(await screen.findByText("How much on groceries?")).toBeInTheDocument();
    expect(screen.getByTestId("thandi-typing")).toBeInTheDocument();
    expect(composer).toBeDisabled();
    expect(screen.getByRole("log")).toHaveAttribute("aria-busy", "true");

    release?.();

    expect(
      await screen.findByText(chatResponseFixture.reply),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("thandi-typing")).not.toBeInTheDocument();
    // Provenance caption (spec UI-AI-004c) with humanized tool name.
    expect(
      screen.getByText(/based on: spending by category/i),
    ).toBeInTheDocument();
    // Quota updated from the response.
    expect(screen.getByText(/49 questions left today/i)).toBeInTheDocument();
    expect(chatRoute.calls).toHaveLength(1);
    expect(bodyOf(chatRoute.calls[0]).message).toBe("How much on groceries?");
  });

  it("submits a suggested prompt when its chip is clicked", async () => {
    stubMemberRole();
    const { chatRoute } = setupConsented();
    renderChat();

    await waitForComposer();
    await userEvent.click(
      await screen.findByRole("button", { name: /how is my budget this month/i }),
    );

    await waitFor(() => expect(chatRoute.calls).toHaveLength(1));
    expect(bodyOf(chatRoute.calls[0]).message).toBe(
      "How is my budget this month?",
    );
    // Chips disappear once the conversation has messages.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /top spending categories/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("inserts a newline instead of sending on Shift+Enter", async () => {
    stubMemberRole();
    const { chatRoute } = setupConsented();
    renderChat();

    const composer = await waitForComposer();
    await userEvent.type(composer, "line one");
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await userEvent.type(composer, "line two");

    expect(chatRoute.calls).toHaveLength(0);
    expect((composer as HTMLTextAreaElement).value).toContain("\n");
  });

  it("clears the thread when New chat is clicked", async () => {
    stubMemberRole();
    setupConsented();
    renderChat();

    const composer = await waitForComposer();
    await userEvent.type(composer, "hello{Enter}");
    await screen.findByText(chatResponseFixture.reply);

    await userEvent.click(screen.getByRole("button", { name: /new chat/i }));

    expect(
      screen.queryByText(chatResponseFixture.reply),
    ).not.toBeInTheDocument();
  });
});

describe("AdviceChat — quota and error states", () => {
  it("disables the composer and shows a banner when the daily quota is exhausted", async () => {
    stubMemberRole();
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.consent, () =>
      jsonResponse({
        consentGiven: true,
        consentDate: "2026-02-01T10:00:00.000Z",
        consentVersion: "v1.0",
        currentVersion: "v1.0",
        needsReconsent: false,
      }),
    );
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
    renderChat();

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/daily limit reached/i);
    expect(await waitForComposer()).toBeDisabled();
  });

  it("shows a retryable error bubble on an outage and recovers on retry", async () => {
    stubMemberRole();
    const router = createFetchRouter();
    let failNext = true;
    router.on("POST", AI_ROUTES.chat, () => {
      if (failNext) {
        failNext = false;
        return errorResponse(500, "INTERNAL_ERROR", "Failed to process AI query");
      }
      return jsonResponse(chatResponseFixture);
    });
    installDefaultAiRoutes(router);
    router.install();
    renderChat();

    const composer = await waitForComposer();
    await userEvent.type(composer, "flaky{Enter}");

    expect(
      await screen.findByText(/couldn't answer that right now/i),
    ).toBeInTheDocument();
    // The user message stays in the transcript (spec 5.6).
    expect(screen.getByText("flaky")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(
      await screen.findByText(chatResponseFixture.reply),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/couldn't answer that right now/i),
    ).not.toBeInTheDocument();
  });

  it("shows the field-level validation message inline and restores the draft to the composer (state 5.3)", async () => {
    stubMemberRole();
    const router = createFetchRouter();
    router.on("POST", AI_ROUTES.chat, () =>
      errorResponse(400, "VALIDATION_ERROR", "Invalid request", {
        fields: [
          {
            field: "message",
            message: "Message cannot be empty",
            code: "too_small",
          },
        ],
      }),
    );
    installDefaultAiRoutes(router);
    router.install();
    renderChat();

    const composer = await waitForComposer();
    await userEvent.type(composer, "rejected input{Enter}");

    const inlineError = await screen.findByRole("alert");
    expect(inlineError).toHaveTextContent(/message cannot be empty/i);
    // The rejected text is restored into the composer for editing.
    await waitFor(() =>
      expect((composer as HTMLTextAreaElement).value).toBe("rejected input"),
    );
    // The optimistic bubble was removed from the transcript.
    expect(screen.getByRole("log")).not.toHaveTextContent("rejected input");
  });

  it("falls back to the consent gate when a chat request returns 403 (consent revoked mid-session)", async () => {
    stubMemberRole();
    const router = createFetchRouter();
    let consentRevoked = false;
    router.on("POST", AI_ROUTES.chat, () => {
      consentRevoked = true;
      return errorResponse(
        403,
        "FORBIDDEN",
        "AI features require consent. Please enable AI assistant in Settings.",
      );
    });
    router.on("GET", AI_ROUTES.consent, () =>
      jsonResponse(
        consentRevoked
          ? consentAbsentFixture
          : {
              consentGiven: true,
              consentDate: "2026-02-01T10:00:00.000Z",
              consentVersion: "v1.0",
              currentVersion: "v1.0",
              needsReconsent: false,
            },
      ),
    );
    router.on("GET", AI_ROUTES.status, () => jsonResponse(statusFixture));
    router.on("GET", AI_ROUTES.conversationList, () =>
      jsonResponse(emptyConversationsFixture),
    );
    router.install();
    renderChat();

    const composer = await waitForComposer();
    await userEvent.type(composer, "question after revoke{Enter}");

    // The invalidated consent query refetches, now consent-absent → gate.
    expect(
      await screen.findByText(/ask a household admin to enable thandi/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(composerLabel)).not.toBeInTheDocument();
  });
});

describe("AdviceChat — low quota meter (E2)", () => {
  it("keeps the plain-text indicator at 10 or more remaining (no progressbar)", async () => {
    stubMemberRole();
    setupConsented();
    renderChat();

    // statusFixture.rateLimit.remaining is 37.
    await screen.findByText(/37 questions left today/i);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("swaps to an accessible meter once remaining drops below 10", async () => {
    stubMemberRole();
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.status, () =>
      jsonResponse({
        available: true,
        rateLimit: {
          remaining: 3,
          resetTime: "2026-07-18T00:00:00.000Z",
          isLimited: false,
        },
      }),
    );
    installDefaultAiRoutes(router);
    router.install();
    renderChat();

    const meter = await screen.findByRole("progressbar");
    expect(meter).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByText(/3 questions left today/i)).toBeInTheDocument();
  });
});

describe("AdviceChat — degraded provider notice (E4)", () => {
  it("shows a low-key fallback notice when the status reports degraded: true", async () => {
    stubMemberRole();
    const router = createFetchRouter();
    router.on("GET", AI_ROUTES.status, () =>
      jsonResponse({
        available: true,
        degraded: true,
        rateLimit: {
          remaining: 37,
          resetTime: "2026-07-18T00:00:00.000Z",
          isLimited: false,
        },
      }),
    );
    installDefaultAiRoutes(router);
    router.install();
    renderChat();

    expect(
      await screen.findByText(/answers may be limited/i),
    ).toBeInTheDocument();
    // Not an error state — must not be announced as an alert.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no fallback notice when degraded is absent (existing behavior)", async () => {
    stubMemberRole();
    setupConsented();
    renderChat();

    await waitForComposer();
    expect(screen.queryByText(/answers may be limited/i)).not.toBeInTheDocument();
  });
});

describe("AdviceChat — accessibility", () => {
  it("exposes the transcript as a polite live log with screen-reader role prefixes", async () => {
    stubMemberRole();
    setupConsented();
    renderChat();

    const composer = await waitForComposer();
    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");

    await userEvent.type(composer, "hi{Enter}");
    await screen.findByText(chatResponseFixture.reply);

    expect(screen.getByText("You:")).toBeInTheDocument();
    expect(screen.getByText("Thandi:")).toBeInTheDocument();
  });

  it("shows a character counter as the message approaches the 1000-char limit", async () => {
    stubMemberRole();
    setupConsented();
    renderChat();

    const composer = await waitForComposer();
    fireEvent.change(composer, { target: { value: "a".repeat(950) } });

    expect(screen.getByText("950/1000")).toBeInTheDocument();
  });
});
