import { beforeEach, describe, expect, it, vi } from "vitest";
import { authEmailService } from "../auth.email.service";
import { issueInitialEmailVerification } from "../../../services/security-email";
import { sendEmail } from "../../../services/emailService";

vi.mock("../../../services/security-email", () => ({ issueInitialEmailVerification: vi.fn(), consumeEmailVerificationToken: vi.fn() }));
vi.mock("../../../services/emailService", () => ({ sendEmail: vi.fn() }));

const recipient = "verify-content@example.invalid";
const token = "c".repeat(64);

describe("verification email content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendEmail).mockResolvedValue(true);
    vi.mocked(issueInitialEmailVerification).mockResolvedValue({ userId: "u1", email: recipient, token });
  });

  it.each(["initial", "resend"] as const)("%s mail says what the button does and has no preferences footer", async (mode) => {
    if (mode === "initial") await authEmailService.sendVerificationEmail(recipient, token, "u1");
    else await authEmailService.resendVerification(recipient);

    const { html, text } = vi.mocked(sendEmail).mock.calls[0][0];
    expect(html).toContain("Verify my email");
    expect(html).toContain(`/verify-email?token=${token}`);
    expect(html).not.toContain("View Details");
    expect(html).not.toContain("notification preferences");
    expect(text).toContain(`/verify-email?token=${token}`);
  });
});
