import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CommandPalette } from "../CommandPalette";
import { CommandPaletteProvider } from "@/contexts/CommandPaletteContext";

// Keep the actual palette, provider, dialog and router; data and preferences
// are inert so keyboard navigation cannot fetch or persist application data.
const boundary = vi.hoisted(() => ({ setTheme: vi.fn(), toggleSidebar: vi.fn() }));
vi.mock("@/hooks", () => ({ useAccounts: () => ({ data: [] }) }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ data: { categories: [], groups: [] } }),
}));
vi.mock("@/features/transactions/hooks/useFilterPresets", () => ({
  useFilterPresets: () => ({ data: [] }),
}));
vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ toggleSidebar: boundary.toggleSidebar }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: boundary.setTheme }),
}));

beforeEach(() => {
  // Advance only the shortcut clock; real dialog effects keep their real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T08:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function CurrentRoute() {
  const [path] = useLocation();
  return <output aria-label="Current route">{path}</output>;
}

function renderPalette(initialPath = "/transactions") {
  const location = memoryLocation({ path: initialPath });
  render(
    <Router hook={location.hook}>
      <CommandPaletteProvider>
        <button type="button">Page action</button>
        <input aria-label="Search input" />
        <textarea aria-label="Notes textarea" />
        <div contentEditable role="textbox" aria-label="Rich text editor" tabIndex={0} />
        <CurrentRoute />
        <CommandPalette />
      </CommandPaletteProvider>
    </Router>,
  );
  const editor = screen.getByRole("textbox", { name: "Rich text editor" });
  // JSDOM does not implement this browser property used by the existing guard.
  if (editor.isContentEditable === undefined) {
    Object.defineProperty(editor, "isContentEditable", { value: true });
  }
  return screen.getByRole("button", { name: "Page action" });
}

function advanceClock(milliseconds: number) {
  vi.setSystemTime(Date.now() + milliseconds);
}

function expectRoute(path: string) {
  expect(screen.getByLabelText("Current route").textContent).toBe(path);
}

function expectExistingDialogWarnings() {
  // The unchanged command dialog currently omits its Radix title/description.
  // Register those exact debts instead of suppressing unexpected console output.
  globalThis.expectConsoleMessage?.("error", /`DialogContent` requires a `DialogTitle`/);
  globalThis.expectConsoleMessage?.("warn", /Missing `Description` or `aria-describedby=\{undefined\}` for \{DialogContent\}/);
}

describe("actual command palette keyboard shortcuts", () => {
  it.each(["ctrlKey", "metaKey", "altKey"])("does not navigate with modified %s sequences", modifier => {
    const target = renderPalette();
    fireEvent.keyDown(target, { key: "g", [modifier]: true });
    fireEvent.keyDown(target, { key: "r" });
    expectRoute("/transactions");
    fireEvent.keyDown(target, { key: "g" });
    fireEvent.keyDown(target, { key: "r", [modifier]: true });
    expectRoute("/transactions");
  });
  it.each(["combobox", "listbox", "menu", "dialog"])("leaves %s typeahead and editing alone", role => {
    const target = renderPalette();
    const widget = document.createElement("div"); widget.setAttribute("role", role);
    const option = document.createElement("span"); widget.append(option); document.body.append(widget);
    try {
      fireEvent.keyDown(option, { key: "g" }); fireEvent.keyDown(option, { key: "r" });
      expectRoute("/transactions");
      fireEvent.keyDown(target, { key: "g" }); fireEvent.keyDown(option, { key: "r" });
      fireEvent.keyDown(target, { key: "r" }); expectRoute("/transactions");
    } finally { widget.remove(); }
  });
  it.each(["g", "G"])("navigates to Goals for g then %s and consumes the sequence", secondKey => {
    const target = renderPalette();
    fireEvent.keyDown(target, { key: "g" });
    expectRoute("/transactions");
    advanceClock(999);

    fireEvent.keyDown(target, { key: secondKey });

    expectRoute("/goals");
    fireEvent.keyDown(target, { key: "a" });
    expectRoute("/goals");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["a", "/accounts"], ["b", "/budget"], ["d", "/"],
    ["i", "/investments"], ["c", "/recurring"], ["r", "/reports"],
    ["t", "/transactions"], ["f", "/cash-flow"],
  ])("preserves g then %s navigation to %s", (key, destination) => {
    const target = renderPalette("/receipts");
    fireEvent.keyDown(target, { key: "g" });
    advanceClock(100);

    fireEvent.keyDown(target, { key });

    expectRoute(destination);
  });

  it.each([1000, 1001])("expires a prefix after %i ms and accepts a fresh sequence", elapsed => {
    const target = renderPalette();
    fireEvent.keyDown(target, { key: "g" });
    advanceClock(elapsed);
    fireEvent.keyDown(target, { key: "a" });
    expectRoute("/transactions");

    fireEvent.keyDown(target, { key: "g" });
    advanceClock(999);
    fireEvent.keyDown(target, { key: "a" });
    expectRoute("/accounts");
  });

  it("starts a fresh prefix when g arrives after the previous prefix expires", () => {
    const target = renderPalette();
    fireEvent.keyDown(target, { key: "g" });
    advanceClock(1000);
    fireEvent.keyDown(target, { key: "g" });
    expectRoute("/transactions");
    advanceClock(1);

    fireEvent.keyDown(target, { key: "a" });

    expectRoute("/accounts");
  });

  it.each(["Search input", "Notes textarea", "Rich text editor"])("ignores keyboard shortcuts in %s", label => {
    const target = renderPalette();
    const editable = screen.getByRole("textbox", { name: label });
    fireEvent.keyDown(editable, { key: "g" });
    fireEvent.keyDown(editable, { key: "a" });
    fireEvent.keyDown(editable, { key: "k", ctrlKey: true });
    fireEvent.keyDown(editable, { key: "k", metaKey: true });
    expectRoute("/transactions");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(target, { key: "a" });
    expectRoute("/transactions");

    fireEvent.keyDown(target, { key: "g" });
    fireEvent.keyDown(editable, { key: "a" });
    expectRoute("/transactions");
    fireEvent.keyDown(target, { key: "a" });
    expectRoute("/transactions");
  });

  it.each(["ctrlKey", "metaKey"])("opens one actual palette dialog with %s + K", modifier => {
    const target = renderPalette();
    expectExistingDialogWarnings();

    fireEvent.keyDown(target, { key: "k", [modifier]: true });

    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(within(dialogs[0]).getByRole("combobox")).toHaveAttribute(
      "placeholder", "Search or type a command...",
    );
    expect(within(dialogs[0]).getByRole("option", { name: /Go to Goals/ })).toBeInTheDocument();
    expectRoute("/transactions");
  });

  it("preserves selecting the offered Goals command by clicking", () => {
    const target = renderPalette();
    expectExistingDialogWarnings();
    fireEvent.keyDown(target, { key: "k", ctrlKey: true });

    fireEvent.click(screen.getByRole("option", { name: /Go to Goals/ }));

    expectRoute("/goals");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
