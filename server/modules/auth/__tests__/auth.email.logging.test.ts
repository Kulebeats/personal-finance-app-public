import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authEmailService } from "../auth.email.service";
import { issueInitialEmailVerification } from "../../../services/security-email";
import { sendEmail } from "../../../services/emailService";

vi.mock("../../../services/security-email", () => ({ issueInitialEmailVerification: vi.fn(), consumeEmailVerificationToken: vi.fn() }));
vi.mock("../../../services/emailService", () => ({ sendEmail: vi.fn() }));

const recipient = "r01-private-mail-recipient@example.invalid";
const rawToken = "b".repeat(64);
const userId = "bc91fd42-e305-41dd-9177-14a5c0732d18";
let lines: string[] = [];

describe("Auth verification mail serialized logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lines = [];
    // Capture the real logger's serialized console output, not mocked log args.
    for (const method of ["log", "warn", "error"] as const) vi.spyOn(console, method).mockImplementation((...values) => { lines.push(values.map(String).join(" ")); });
    vi.mocked(issueInitialEmailVerification).mockResolvedValue({ userId, email: recipient, token: rawToken });
  });
  afterEach(() => { vi.restoreAllMocks(); });
  it.each(["initial", "resend"] as const)("%s mail never serializes recipient/token or transport error details", async (mode) => {
    for (const outcome of ["accepted", "unavailable", "failed"] as const) {
      lines = [];
      if (outcome === "failed") vi.mocked(sendEmail).mockRejectedValueOnce(new Error(`SMTP rejected ${recipient}; token=${rawToken}`));
      else vi.mocked(sendEmail).mockResolvedValueOnce(outcome === "accepted");
      if (mode === "initial") await authEmailService.sendVerificationEmail(recipient, rawToken, userId);
      else await authEmailService.resendVerification(recipient);
      const serialized = lines.join("\n");
      expect(serialized.includes(recipient)).toBe(false);
      expect(serialized.includes(rawToken)).toBe(false);
      expect(serialized.includes(userId)).toBe(false);
      const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe(`Verification email ${mode === "initial" ? "send" : "resend"} ${outcome}`);
      expect(typeof entries[0].userId).toBe("string");
      expect(entries[0].error).toBeUndefined();
    }
  });
});
