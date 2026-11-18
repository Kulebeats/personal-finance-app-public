import { describe, it, expect } from "vitest";
import { getSafeReturnPath, readReturnPath } from "../returnPath";

describe("getSafeReturnPath", () => {
  it("accepts a same-origin relative path", () => {
    expect(getSafeReturnPath("/invite/abc123")).toBe("/invite/abc123");
    expect(getSafeReturnPath("/settings/household?tab=members")).toBe(
      "/settings/household?tab=members",
    );
  });

  it.each([
    ["protocol-relative URL", "//evil.example"],
    ["protocol-relative URL with path", "//evil.example/invite/abc"],
    ["absolute https URL", "https://evil.example/invite/abc"],
    ["absolute http URL", "http://evil.example"],
    ["javascript: URL", "javascript:alert(1)"],
    ["backslash host trick", "/\\evil.example"],
    ["relative path without a leading slash", "invite/abc"],
    ["embedded whitespace", "/invite/abc\n//evil.example"],
    ["empty string", ""],
  ])("rejects a %s", (_label, raw) => {
    expect(getSafeReturnPath(raw)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(getSafeReturnPath(null)).toBeNull();
    expect(getSafeReturnPath(undefined)).toBeNull();
  });
});

describe("readReturnPath", () => {
  it("reads a valid next parameter from a search string", () => {
    expect(readReturnPath("?next=%2Finvite%2Fabc123")).toBe("/invite/abc123");
  });

  it("falls back to / for a hostile or missing next parameter", () => {
    expect(readReturnPath("?next=%2F%2Fevil.example")).toBe("/");
    expect(readReturnPath("?next=https%3A%2F%2Fevil.example")).toBe("/");
    expect(readReturnPath("")).toBe("/");
  });
});
