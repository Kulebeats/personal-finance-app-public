/**
 * Auth Handlers Hook
 *
 * Handles authentication API calls for login, registration, and MFA.
 */

import { toast } from "sonner";
import { apiCall, clearCsrfToken } from "@/lib/api";

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
}

interface ApiResult {
  success: boolean;
  message?: string;
}

interface AuthEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: { message?: string };
  message?: string;
}

type AuthError = Error & { status?: number };

function getAuthErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof SyntaxError) {
    return "Server returned invalid response";
  }
  return error instanceof Error ? error.message : fallback;
}

function getAuthErrorStatus(error: unknown): number | undefined {
  const status = (error as AuthError | undefined)?.status;
  return typeof status === "number" ? status : undefined;
}

export async function handleLoginApi(data: LoginData): Promise<LoginResult> {
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
        message: result.error?.message || result.message || "Login failed",
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
    const message = getAuthErrorMessage(error, "Login failed");
    return {
      success: false,
      message,
      isEmailNotVerified:
        getAuthErrorStatus(error) === 403 && /email not verified/i.test(message),
    };
  }
}

export async function handleRegisterApi(data: RegisterData): Promise<ApiResult> {
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
      message:
        result.error?.message || result.message || "Registration failed",
    };
  } catch (error) {
    return {
      success: false,
      message: getAuthErrorMessage(error, "Registration failed"),
    };
  }
}

export async function handleMfaVerifyApi(code: string): Promise<ApiResult> {
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
    return {
      success: false,
      message:
        result.error?.message || result.message || "MFA verification failed",
    };
  } catch (error) {
    return {
      success: false,
      message: getAuthErrorMessage(error, "MFA verification failed"),
    };
  }
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
    toast.error(
      result.error?.message || result.message || "Failed to resend code",
    );
    return { success: false };
  } catch (error) {
    toast.error(getAuthErrorMessage(error, "Failed to resend code"));
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
      message:
        result.error?.message ||
        result.message ||
        "Failed to request password reset",
    };
  } catch (error) {
    return {
      success: false,
      message: getAuthErrorMessage(error, "Failed to request password reset"),
    };
  }
}

export async function handleResetPasswordApi(
  token: string,
  newPassword: string,
): Promise<ApiResult> {
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
      message:
        result.error?.message || result.message || "Failed to reset password",
    };
  } catch (error) {
    return {
      success: false,
      message: getAuthErrorMessage(error, "Failed to reset password"),
    };
  }
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
      message:
        result.error?.message ||
        result.message ||
        "Failed to resend verification email",
    };
  } catch (error) {
    return {
      success: false,
      message: getAuthErrorMessage(
        error,
        "Failed to resend verification email",
      ),
    };
  }
}
