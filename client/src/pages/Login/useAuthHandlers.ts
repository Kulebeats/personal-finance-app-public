/**
 * Auth Handlers Hook
 *
 * Handles authentication API calls for login, registration, and MFA.
 */

import { toast } from "sonner";
import { apiCall, clearCsrfToken } from "@/lib/api";
import { withFieldErrors, type AuthFieldError } from "./authFieldErrors";
import { authErrorCopy } from "./authErrorCopy";
import { beginSessionTransition, completeSessionTransition } from "@/lib/session";

interface LoginData {
  email: string;
  password: string;
  rememberMe: boolean;
}

interface RegisterData {
  username: string;
  email: string;
  password: string;
  fullName: string;
}

interface LoginResult {
  success: boolean;
  requiresMfa?: boolean;
  maskedEmail?: string;
  isEmailNotVerified?: boolean;
  message?: string;
  fieldErrors?: AuthFieldError[];
}

interface ApiResult {
  success: boolean;
  message?: string;
  fieldErrors?: AuthFieldError[];
}

interface AuthEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string; fields?: unknown };
  message?: string;
}

type AuthError = Error & { status?: number; code?: string };

function getAuthErrorStatus(error: unknown): number | undefined {
  const status = (error as AuthError | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

export async function handleLoginApi(data: LoginData): Promise<LoginResult> {
  const operation = beginSessionTransition();
  let broadcast = true;
  try {
    const result = await apiCall<
      AuthEnvelope<{ requiresMfa?: boolean; maskedEmail?: string }>
    >("/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (!result.success) {
      return {
        success: false,
        message: authErrorCopy("login", result.error),
        ...withFieldErrors(result),
      };
    }

    // Login regenerates the session, so any cached CSRF token is now stale.
    clearCsrfToken();
    if (result.data?.requiresMfa) {
      return {
        success: true,
        requiresMfa: true,
        maskedEmail: result.data.maskedEmail || "your email",
      };
    }
    return { success: true };
  } catch (error) {
    // Only this login rejection is guaranteed to precede SID rotation.
    broadcast = !(getAuthErrorStatus(error) === 401 && (error as AuthError)?.code === "INVALID_CREDENTIALS");
    return {
      success: false,
      message: authErrorCopy("login", error),
      ...withFieldErrors(error),
      isEmailNotVerified:
        getAuthErrorStatus(error) === 403 && (error as AuthError)?.code === "EMAIL_VERIFICATION_REQUIRED",
    };
  } finally { completeSessionTransition(operation, undefined, broadcast); }
}

export async function handleRegisterApi(data: RegisterData): Promise<ApiResult> {
  const operation = beginSessionTransition();
  const broadcast = true;
  try {
    const result = await apiCall<AuthEnvelope>("/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (result.success) {
      // Registration regenerates the session, so drop the now-stale CSRF token.
      clearCsrfToken();
      return { success: true };
    }
    return {
      success: false,
      message: authErrorCopy("register", result.error),
      ...withFieldErrors(result),
    };
  } catch (error) {
    return {
      success: false,
      message: authErrorCopy("register", error),
      ...withFieldErrors(error),
    };
  } finally { completeSessionTransition(operation, undefined, broadcast); }
}

export async function handleMfaVerifyApi(code: string): Promise<ApiResult> {
  const operation = beginSessionTransition();
  const broadcast = true;
  let failure: string | undefined;
  try {
    const result = await apiCall<AuthEnvelope>("/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    });

    if (result.success) {
      // MFA verification finalizes the session, so drop the stale token.
      clearCsrfToken();
      return { success: true };
    }
    failure = authErrorCopy("mfaVerify", result.error);
    return {
      success: false,
      message: failure,
    };
  } catch (error) {
    failure = authErrorCopy("mfaVerify", error);
    return {
      success: false,
      message: failure,
    };
  } finally { completeSessionTransition(operation, failure, broadcast); }
}

export async function handleResendMfaApi(): Promise<{
  success: boolean;
  maskedEmail?: string;
}> {
  try {
    const result = await apiCall<AuthEnvelope<{ maskedEmail?: string }>>(
      "/auth/mfa/resend",
      { method: "POST" },
    );

    if (result.success) {
      return { success: true, maskedEmail: result.data?.maskedEmail };
    }
    toast.error(authErrorCopy("mfaResend", result.error));
    return { success: false };
  } catch (error) {
    toast.error(authErrorCopy("mfaResend", error));
    return { success: false };
  }
}

export async function handleForgotPasswordApi(email: string): Promise<ApiResult> {
  try {
    const result = await apiCall<AuthEnvelope>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    if (result.success) {
      return { success: true };
    }
    return {
      success: false,
      message: authErrorCopy("forgotPassword", result.error),
    };
  } catch (error) {
    return {
      success: false,
      message: authErrorCopy("forgotPassword", error),
    };
  }
}

export async function handleResetPasswordApi(
  token: string,
  newPassword: string,
): Promise<ApiResult> {
  const operation = beginSessionTransition();
  const broadcast = true;
  try {
    const result = await apiCall<AuthEnvelope>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    });

    if (result.success) {
      return { success: true };
    }
    return {
      success: false,
      message: authErrorCopy("resetPassword", result.error),
    };
  } catch (error) {
    return {
      success: false,
      message: authErrorCopy("resetPassword", error),
    };
  } finally { completeSessionTransition(operation, undefined, broadcast); }
}

export async function handleResendVerificationApi(
  email: string,
): Promise<ApiResult> {
  try {
    const result = await apiCall<AuthEnvelope>("/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    });

    if (result.success) {
      return { success: true };
    }
    return {
      success: false,
      message: authErrorCopy("resendVerification", result.error),
    };
  } catch (error) {
    return {
      success: false,
      message: authErrorCopy("resendVerification", error),
    };
  }
}
