/**
 * @vitest-environment jsdom
 *
 * Register re-check defect 11 (and #365 review P2-3): sign-in, register, MFA,
 * the two resend actions, forgot password and reset password never show the server's own error text. A known error code maps to
 * fixed copy for that action; anything else gets that action's one generic
 * line. The server text below is deliberately internal-looking, so a leak is
 * unmistakable. Real handlers, real apiCall, stubbed fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { clearCsrfToken } from "@/lib/api";
import {
  handleForgotPasswordApi,
  handleLoginApi,
  handleMfaVerifyApi,
  handleRegisterApi,
  handleResendMfaApi,
  handleResendVerificationApi,
  handleResetPasswordApi,
} from "../useAuthHandlers";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const RAW = "duplicate key value violates unique constraint \"users_email_key\" (pg 23505)";
const RATE = "Too many attempts. Wait a few minutes and try again.";
const EXPIRED = "Your sign-in has expired. Sign in again to get a new code.";
const NO_EMAIL = "We can't send email right now. Try again later.";

type Handler =
  | "login" | "register" | "mfaVerify" | "mfaResend" | "resendVerification"
  | "forgotPassword" | "resetPassword";

/** Each handler's user-visible failure text: the returned message, or the toast for MFA resend. */
const shown: Record<Handler, () => Promise<string | undefined>> = {
  login: async () => (await handleLoginApi({ email: "a@example.invalid", password: "pw", rememberMe: false })).message,
  register: async () => (await handleRegisterApi({
    username: "new-user", email: "a@example.invalid", password: "pw", fullName: "New User",
  })).message,
  mfaVerify: async () => (await handleMfaVerifyApi("123456")).message,
  mfaResend: async () => {
    await handleResendMfaApi();
    return vi.mocked(toast.error).mock.calls.at(-1)?.[0] as string | undefined;
  },
  resendVerification: async () => (await handleResendVerificationApi("a@example.invalid")).message,
  forgotPassword: async () => (await handleForgotPasswordApi("a@example.invalid")).message,
  resetPassword: async () => (await handleResetPasswordApi("reset-token", "pw")).message,
};

const GENERIC: Record<Handler, string> = {
  login: "Sign-in failed. Please try again.",
  register: "We couldn't create your account. Please try again.",
  mfaVerify: "We couldn't verify that code. Please try again.",
  mfaResend: "We couldn't resend the code. Please try again.",
  resendVerification: "We couldn't resend the verification email. Please try again.",
  forgotPassword: "We couldn't send a reset link. Please try again.",
  resetPassword: "We couldn't reset your password. Please try again.",
};

const KNOWN: ReadonlyArray<readonly [Handler, string, number, string]> = [
  ["login", "INVALID_CREDENTIALS", 401, "Invalid email or password."],
  ["login", "FORBIDDEN", 403, "This account is temporarily locked. Try again later."],
  ["login", "EMAIL_VERIFICATION_REQUIRED", 403, "Verify your email address before signing in."],
  ["login", "RATE_LIMIT_EXCEEDED", 429, RATE],
  ["register", "CONFLICT", 409, "We couldn't create an account with those details. Try a different email or username."],
  ["register", "VALIDATION_ERROR", 400, "Check the highlighted fields and try again."],
  ["register", "RATE_LIMITED", 429, RATE],
  ["mfaVerify", "INVALID_CREDENTIALS", 401, "That code is wrong or has expired. Check your email and try again."],
  ["mfaVerify", "UNAUTHORIZED", 401, EXPIRED],
  ["mfaVerify", "RATE_LIMITED", 429, RATE],
  ["mfaResend", "UNAUTHORIZED", 401, EXPIRED],
  ["mfaResend", "SERVICE_UNAVAILABLE", 503, NO_EMAIL],
  ["mfaResend", "RATE_LIMITED", 429, RATE],
  ["resendVerification", "SERVICE_UNAVAILABLE", 503, NO_EMAIL],
  ["resendVerification", "VALIDATION_ERROR", 400, "Enter a valid email address."],
  ["resendVerification", "RATE_LIMITED", 429, RATE],
  ["forgotPassword", "SERVICE_UNAVAILABLE", 503, NO_EMAIL],
  ["forgotPassword", "VALIDATION_ERROR", 400, "Enter a valid email address."],
  ["forgotPassword", "RATE_LIMITED", 429, RATE],
  ["resetPassword", "VALIDATION_ERROR", 400,
    "This reset link is invalid or has expired, or that password can't be used. Request a new link or choose a different password."],
  ["resetPassword", "RATE_LIMITED", 429, RATE],
];

const HANDLERS = Object.keys(GENERIC) as Handler[];

function respond(body: unknown, status: number) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => Promise.resolve(
    String(input).includes("/csrf-token")
      ? Response.json({ csrfToken: "test-csrf" })
      : Response.json(body, { status }),
  )));
}

describe("auth handlers show fixed copy, never the server's message (defect 11)", () => {
  beforeEach(() => clearCsrfToken());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(KNOWN)("%s: %s (%i) shows its fixed copy", async (handler, code, status, copy) => {
    respond({ success: false, error: { code, message: RAW } }, status);

    expect(await shown[handler]()).toBe(copy);
  });

  it.each(HANDLERS)("%s: an unknown code shows the generic line", async (handler) => {
    respond({ success: false, error: { code: "SOMETHING_NEW", message: RAW } }, 500);

    expect(await shown[handler]()).toBe(GENERIC[handler]);
  });

  it.each(HANDLERS)("%s: a success:false body on a 200 shows the generic line", async (handler) => {
    respond({ success: false, error: { message: RAW }, message: RAW }, 200);

    expect(await shown[handler]()).toBe(GENERIC[handler]);
  });
});
