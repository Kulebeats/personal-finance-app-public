import { describe, expect, it } from "vitest";
import { buildCspDirectives } from "../contentSecurityPolicy";

describe("buildCspDirectives", () => {
  it("lets protected images render from blob: object URLs", () => {
    // ProtectedImage fetches /uploads/* with the session and shows it via
    // URL.createObjectURL; without blob: the browser blocks every private image.
    expect(buildCspDirectives().imgSrc).toContain("blob:");
  });

  it("keeps scripts and connections same-origin only", () => {
    const directives = buildCspDirectives();
    expect(directives.scriptSrc).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(directives.connectSrc).toEqual(["'self'", "blob:"]);
    expect(directives.objectSrc).toEqual(["'none'"]);
  });

  it("widens only for self-hosted receipt OCR: worker, WASM and the receipt blob, no CDN", () => {
    // OPS-004: tesseract.js runs from /ocr/* under these exact directives.
    const directives = buildCspDirectives();
    expect(directives.workerSrc).toEqual(["'self'"]);
    expect(directives.scriptSrc).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(directives.connectSrc).toEqual(["'self'", "blob:"]);
    const sources = [...directives.scriptSrc, ...directives.workerSrc, ...directives.connectSrc];
    expect(sources).not.toContain("'unsafe-eval'");
    for (const source of sources) {
      expect(source).not.toMatch(/^(https?:|\*)|jsdelivr|unpkg|cdn/i);
    }
  });

  it("adds a report URI only when one is configured", () => {
    expect(buildCspDirectives().reportUri).toBeUndefined();
    expect(buildCspDirectives("https://csp.example.test/report").reportUri).toEqual([
      "https://csp.example.test/report",
    ]);
  });
});
