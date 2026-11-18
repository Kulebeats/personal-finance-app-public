import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
// apiCall attaches the x-csrf-token header (raw fetch 403s under CSRF
// enforcement) and self-heals on a stale token.
import { apiCall, securityApi } from "@/lib/api";

// Types
export interface SecurityStatus {
  email: string;
  emailVerified: boolean;
  pendingEmail: string | null;
  hasPassword: boolean;
  emailServiceConfigured: boolean;
  createdAt: string;
}

export interface MfaStatus {
  mfaEnabled: boolean;
  backupCodesRemaining: number;
  lowCodesWarning: boolean;
}

export interface Session {
  id: string;
  deviceName: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  ipAddress: string | null;
  location: string | null;
  isTrusted: boolean;
  lastActiveAt: string;
  createdAt: string;
}

export interface LoginHistoryEntry {
  id: string;
  loginTime: string;
  deviceName: string | null;
  ipAddress: string | null;
  location: string | null;
  success: boolean;
  failureReason: string | null;
}

// Fetch security status
async function fetchSecurityStatus(): Promise<SecurityStatus> {
  const response = await fetch("/api/settings/security", {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch security status");
  }

  const data = await response.json();
  return data.data;
}

export function useSecurityStatus() {
  return useQuery({
    queryKey: ["security-status"],
    queryFn: fetchSecurityStatus,
  });
}

// Fetch MFA status with backup codes info.
// Real route: server/routes/security.ts mounts security.mfa.ts at "/mfa",
// and server/routes.ts mounts security.ts at "/api/settings/security" — so
// the full path is /api/settings/security/mfa/status (NOT /api/security/...).
// The handler always returns 200 (mfaEnabled defaults to false for a user
// who never enabled MFA), so a non-2xx response here is a genuine failure
// and must surface as an error rather than default to "MFA disabled".
async function fetchMfaStatus(): Promise<MfaStatus> {
  const response = await fetch("/api/settings/security/mfa/status", {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch MFA status");
  }

  const data = await response.json();
  return data.data;
}

export function useMfaStatus() {
  return useQuery({
    queryKey: ["mfa-status"],
    queryFn: fetchMfaStatus,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Change email
interface ChangeEmailData {
  newEmail: string;
  password: string;
}

interface ChangeEmailResponse {
  success: boolean;
  message: string;
  devVerifyUrl?: string;
  devMessage?: string;
}

async function changeEmail(
  data: ChangeEmailData
): Promise<ChangeEmailResponse> {
  return apiCall<ChangeEmailResponse>("/settings/security/email/change", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function useChangeEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: changeEmail,
    onSuccess: (data) => {
      if (data.devVerifyUrl) {
        // In dev mode, show the verification link in toast (URL visible for easy copy)
        toast.success(
          `${data.devMessage} Copy link: ${data.devVerifyUrl}`,
          { duration: 30000 }
        );
      } else {
        toast.success("Verification email sent to new address");
      }
      queryClient.invalidateQueries({ queryKey: ["security-status"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

// Verify email
async function verifyEmail(token: string): Promise<void> {
  await apiCall("/settings/security/email/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function useVerifyEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: verifyEmail,
    onSuccess: () => {
      toast.success("Email verified successfully!");
      queryClient.invalidateQueries({ queryKey: ["security-status"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

// Resend verification email
async function resendVerification(): Promise<void> {
  await apiCall("/settings/security/email/resend", { method: "POST" });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: resendVerification,
    onSuccess: () => {
      toast.success("Verification email sent");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

// Cancel email change
async function cancelEmailChange(): Promise<void> {
  await apiCall("/settings/security/email/cancel", { method: "POST" });
}

export function useCancelEmailChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelEmailChange,
    onSuccess: () => {
      toast.success("Email change cancelled");
      queryClient.invalidateQueries({ queryKey: ["security-status"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

// Fetch sessions
async function fetchSessions(): Promise<Session[]> {
  const response = await fetch("/api/settings/security/sessions", {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch sessions");
  }

  const data = await response.json();
  return data.data.sessions;
}

export function useSessions() {
  return useQuery({
    queryKey: ["security-sessions"],
    queryFn: fetchSessions,
  });
}

// Revoke session. Step-up gated — routed through apiCall so a 401
// STEP_UP_REQUIRED opens the password dialog and retries after re-auth.
async function revokeSession(sessionId: string): Promise<void> {
  await securityApi.revokeSession(sessionId);
}

export function useRevokeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      toast.success("Session revoked");
      queryClient.invalidateQueries({ queryKey: ["security-sessions"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

// Revoke all other sessions. Step-up gated — see revokeSession.
async function revokeAllOtherSessions(): Promise<void> {
  await securityApi.revokeAllOtherSessions();
}

export function useRevokeAllOtherSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: revokeAllOtherSessions,
    onSuccess: () => {
      toast.success("All other sessions revoked");
      queryClient.invalidateQueries({ queryKey: ["security-sessions"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

// Fetch login history
async function fetchLoginHistory(): Promise<LoginHistoryEntry[]> {
  const response = await fetch("/api/settings/security/login-history", {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || "Failed to fetch login history");
  }

  const data = await response.json();
  return data.data.history;
}

export function useLoginHistory() {
  return useQuery({
    queryKey: ["security-login-history"],
    queryFn: fetchLoginHistory,
  });
}
