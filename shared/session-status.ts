export type SessionHouseholdRole = "owner" | "admin" | "member" | "view_only" | "professional";

/** Minimal current-session snapshot. Protected requests still recheck authority. */
export interface SessionSubject {
  id: string;
  email: string;
  displayName: string | null;
}

/** AH-11: present while a member without MFA is inside the 14-day grace. */
export interface SessionMfaGrace {
  state: "grace";
  graceEndsAt: string;
  daysRemaining: number;
}

export type SessionStatus =
  | { state: "anonymous" }
  | { state: "mfa_pending" }
  | { state: "verification_pending"; subject: SessionSubject }
  | { state: "mfa_enrolment_required"; subject: SessionSubject; graceEndedAt: string }
  | { state: "verified_without_household"; subject: SessionSubject; mfa?: SessionMfaGrace }
  | { state: "ready"; subject: SessionSubject; household: { id: string; role: SessionHouseholdRole }; mfa?: SessionMfaGrace };
