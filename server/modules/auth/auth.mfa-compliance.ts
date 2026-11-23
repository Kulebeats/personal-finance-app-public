/**
 * Mandatory MFA (AH-11, owner ruling 23 Nov 2026).
 *
 * Every member must use two-step verification. `users.mfa_grace_ends_at` is the
 * deadline: 14 days after the row was written, or 14 days after migration 0059
 * ran for accounts that already existed. Until then a member without MFA works
 * normally and is told the date; after it, every data route answers 403
 * MFA_ENROLMENT_REQUIRED until enrolment is confirmed (see `server/auth.ts`).
 *
 * The only second factor that exists is the emailed 6-digit code, recorded as
 * `users.mfa_enabled = true` by the enrolment confirm. A future factor changes
 * `usesMfa` and nothing else.
 *
 * This replaces the advisory `auth.mfa-policy.ts` (role and high-value
 * suggestions whose `required` flag nothing read): the rule is now every member.
 *
 * @module modules/auth/auth.mfa-compliance
 */
import type { User } from "@shared/schema";

const DAY_MS = 86_400_000;

export type MfaCompliance =
  | { state: "compliant" }
  | { state: "grace"; graceEndsAt: string; daysRemaining: number }
  | { state: "enrolment_required"; graceEndsAt: string; daysRemaining: 0 };

type ComplianceInput = Pick<User, "mfaEnabled" | "mfaGraceEndsAt">;

function usesMfa(user: ComplianceInput): boolean {
  return user.mfaEnabled === true;
}

/**
 * The column is NOT NULL, so an unreadable deadline means a malformed row:
 * treat the grace as over (fail closed) rather than extend it forever.
 */
function graceEnd(user: ComplianceInput): Date | null {
  const end = user.mfaGraceEndsAt instanceof Date ? user.mfaGraceEndsAt : new Date(String(user.mfaGraceEndsAt));
  return Number.isNaN(end.getTime()) ? null : end;
}

/** True once the deadline has passed (or cannot be read). */
export function isMfaGraceOver(user: ComplianceInput, now: Date = new Date()): boolean {
  const end = graceEnd(user);
  return !end || end.getTime() <= now.getTime();
}

export function mfaCompliance(user: ComplianceInput, now: Date = new Date()): MfaCompliance {
  if (usesMfa(user)) return { state: "compliant" };
  const end = graceEnd(user);
  if (!end || end.getTime() <= now.getTime()) {
    return { state: "enrolment_required", graceEndsAt: (end ?? now).toISOString(), daysRemaining: 0 };
  }
  return { state: "grace", graceEndsAt: end.toISOString(), daysRemaining: Math.ceil((end.getTime() - now.getTime()) / DAY_MS) };
}
