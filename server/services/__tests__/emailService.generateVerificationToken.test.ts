import { describe, expect, it, vi, afterEach } from "vitest";
import { generateVerificationToken } from "../emailService";

/**
 * Audit v2 P2 finding: generateVerificationToken() (used for email
 * verification and email-CHANGE tokens in routes/security.email.ts) used
 * Math.random(), which is NOT a CSPRNG - its internal state is small enough
 * to be recovered from a handful of outputs, letting an attacker predict a
 * live verification/change token. This proves the fix uses crypto.randomBytes
 * (mirroring auth.password-reset.service.ts's reset-token generator)
 * instead.
 */
describe("generateVerificationToken CSPRNG", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never calls Math.random() while generating a token", () => {
    const randomSpy = vi.spyOn(Math, "random");

    generateVerificationToken();

    expect(randomSpy).not.toHaveBeenCalled();
  });

  it("produces a 64-character lowercase hex token (32 bytes from crypto.randomBytes)", () => {
    const token = generateVerificationToken();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces distinct, high-entropy tokens across calls", () => {
    const tokens = new Set(
      Array.from({ length: 20 }, () => generateVerificationToken()),
    );

    // 20 CSPRNG-generated 32-byte tokens colliding is cryptographically
    // impossible; a Math.random()-based generator with a weak seed could
    // theoretically collide far sooner, but this mainly guards against a
    // regression to a constant/deterministic generator.
    expect(tokens.size).toBe(20);
  });
});
