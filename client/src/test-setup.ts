import React from "react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";

type ExpectedConsoleMessage = {
  method: ConsoleMethod;
  pattern: RegExp | string;
  remaining: number;
};

declare global {
  var expectConsoleMessage:
    | ((
        method: ConsoleMethod,
        pattern: RegExp | string,
        count?: number
      ) => void)
    | undefined;
}

const consoleMethods: ConsoleMethod[] = ["debug", "error", "info", "log", "warn"];

let expectedConsoleMessages: ExpectedConsoleMessage[] = [];
let unexpectedConsoleMessages: string[] = [];

function formatConsoleArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === "string") return arg;
  if (arg === null || arg === undefined) return String(arg);

  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function formatConsoleMessage(method: ConsoleMethod, args: unknown[]): string {
  return `[console.${method}] ${args.map(formatConsoleArg).join(" ")}`;
}

function matchesExpectedMessage(
  expected: ExpectedConsoleMessage,
  method: ConsoleMethod,
  formatted: string
): boolean {
  if (expected.method !== method) return false;

  if (typeof expected.pattern === "string") {
    return formatted.includes(expected.pattern);
  }

  return expected.pattern.test(formatted);
}

globalThis.expectConsoleMessage = (
  method: ConsoleMethod,
  pattern: RegExp | string,
  count = 1
) => {
  expectedConsoleMessages.push({ method, pattern, remaining: count });
};

for (const method of consoleMethods) {
  console[method] = (...args: unknown[]) => {
    const formatted = formatConsoleMessage(method, args);
    const expected = expectedConsoleMessages.find((candidate) =>
      matchesExpectedMessage(candidate, method, formatted)
    );

    if (expected) {
      expected.remaining -= 1;
      return;
    }

    unexpectedConsoleMessages.push(formatted);
  };
}

beforeEach(() => {
  expectedConsoleMessages = [];
  unexpectedConsoleMessages = [];
});

afterEach(() => {
  const missingExpectedMessages = expectedConsoleMessages
    .filter((message) => message.remaining > 0)
    .map(
      (message) =>
        `[console.${message.method}] ${String(message.pattern)} (${message.remaining} remaining)`
    );

  const failures = [
    ...unexpectedConsoleMessages,
    ...missingExpectedMessages.map((message) => `Missing expected ${message}`),
  ];

  expectedConsoleMessages = [];
  unexpectedConsoleMessages = [];

  if (failures.length > 0) {
    throw new Error(
      `Unexpected console output in test:\n${failures
        .map((message) => `- ${message}`)
        .join("\n")}`
    );
  }
});

// Mock CSS imports
vi.mock("react-phone-number-input/style.css", () => ({}));

// Mock IntersectionObserver
class MockIntersectionObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
}
global.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;

// Mock ResizeObserver with a non-zero size to satisfy chart libs in tests
class MockResizeObserver {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  disconnect = vi.fn();
  unobserve = vi.fn();
  observe = vi.fn((target: Element) => {
    const element = target as HTMLElement;
    const width = element.offsetWidth || 600;
    const height = element.offsetHeight || 300;
    const rect = {
      width,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRectReadOnly;

    this.callback(
      [{ target, contentRect: rect } as ResizeObserverEntry],
      this
    );
  });
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock scrollTo
Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: vi.fn(),
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

// Mock sessionStorage
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, "sessionStorage", {
  value: sessionStorageMock,
});
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.scroll = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
