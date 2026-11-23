/**
 * useDialogOpener: which control `take()` hands back as the dialog's opener,
 * by how long ago it was pressed and whether anything else is focused.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, renderHook } from "@testing-library/react";
import { useDialogOpener } from "../hooks/useDialogOpener";

const PRESSED_AT = 1_000;
const WITHIN_WINDOW = PRESSED_AT + 500;
const AFTER_WINDOW = PRESSED_AT + 5_000;

function pressButtonAt(clock: { now: number }): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Open";
  document.body.appendChild(button);
  clock.now = PRESSED_AT;
  fireEvent.pointerDown(button);
  return button;
}

describe("useDialogOpener", () => {
  const clock = { now: 0 };

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  function setup() {
    vi.spyOn(performance, "now").mockImplementation(() => clock.now);
    return renderHook(() => useDialogOpener(false)).result.current;
  }

  it("returns the control pressed just before the dialog opened, once", () => {
    const opener = setup();
    const button = pressButtonAt(clock);
    clock.now = WITHIN_WINDOW;
    expect(opener.take()).toBe(button);
    expect(opener.take()).toBeNull();
  });

  it("returns an older press when nothing is focused (Safari does not focus a pressed button)", () => {
    const opener = setup();
    const button = pressButtonAt(clock);
    clock.now = AFTER_WINDOW;
    expect(document.activeElement).toBe(document.body);
    expect(opener.take()).toBe(button);
  });

  it("lets the focused element win over an older press", () => {
    const opener = setup();
    pressButtonAt(clock);
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    clock.now = AFTER_WINDOW;
    expect(opener.take()).toBeNull();
  });
});
