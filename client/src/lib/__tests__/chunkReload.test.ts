/**
 * After a deploy the old lazy page chunks are gone, so the first visit to a
 * lazily loaded page failed with "Failed to fetch dynamically imported
 * module" and Retry could not recover (React caches the rejected import).
 * The guard reloads the page, at most once per cooldown, and never loops.
 *
 * The loop it must not allow: a page whose own chunk loads but whose nested
 * lazy chunk (a settings section, a dashboard widget) keeps failing. The old
 * guard cleared its flag on every successful page load, so that went
 * outer load OK -> flag cleared -> nested failure -> reload, forever.
 */
import React, { Suspense } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  CHUNK_RELOAD_COOLDOWN_MS,
  isChunkLoadError,
  lazyWithChunkReload,
  reloadOnceForStaleChunk,
} from "../chunkReload";

const store = new Map<string, string>();
const START = new Date("2026-11-15T10:00:00Z");

function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

describe("reloadOnceForStaleChunk", () => {
  beforeEach(() => {
    store.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START);
    vi.mocked(window.sessionStorage.getItem).mockImplementation(
      (key: string) => store.get(key) ?? null,
    );
    vi.mocked(window.sessionStorage.setItem).mockImplementation(
      (key: string, value: string) => {
        store.set(key, value);
      },
    );
    vi.mocked(window.sessionStorage.removeItem).mockImplementation(
      (key: string) => {
        store.delete(key);
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reloads once for two failures 1 second apart", () => {
    const reload = vi.fn();

    expect(reloadOnceForStaleChunk(reload)).toBe(true);
    advance(1_000);
    expect(reloadOnceForStaleChunk(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again for a failure after the cooldown (a later deploy in the same tab)", () => {
    const reload = vi.fn();

    reloadOnceForStaleChunk(reload);
    advance(CHUNK_RELOAD_COOLDOWN_MS + 1);
    expect(reloadOnceForStaleChunk(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload after a successful page load followed by another failure within the cooldown", async () => {
    const reload = vi.fn();
    reloadOnceForStaleChunk(reload);

    // After the reload the outer page chunk loads fine...
    const Page = lazyWithChunkReload(async () => ({
      default: () => React.createElement("p", null, "page loaded"),
    }));
    render(React.createElement(Suspense, { fallback: null }, React.createElement(Page)));
    expect(await screen.findByText("page loaded")).toBeInTheDocument();

    // ...but its nested lazy chunk is still gone.
    advance(2_000);
    expect(reloadOnceForStaleChunk(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when sessionStorage is unavailable, so it cannot loop", () => {
    vi.mocked(window.sessionStorage.getItem).mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reload = vi.fn();

    expect(reloadOnceForStaleChunk(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does not reload when the reload time cannot be stored", () => {
    vi.mocked(window.sessionStorage.setItem).mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reload = vi.fn();

    expect(reloadOnceForStaleChunk(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("recognises the dynamic-import failure messages", () => {
    expect(
      isChunkLoadError(
        new TypeError(
          "Failed to fetch dynamically imported module: https://app/assets/Budget-abc.js",
        ),
      ),
    ).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(
      false,
    );
  });
});
