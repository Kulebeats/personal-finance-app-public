/**
 * MFA management: enrol, disable and regenerate backup codes (R06.1).
 *
 * Every change needs a fresh one-time code sent to the user's verified email,
 * which proves the user still holds the mailbox. Enrolment stays pending
 * (`mfaEnabled` false) until that code comes back. The code is stored hashed
 * in `users.mfaCode`, the slot the login challenge also uses, so only the most
 * recently issued code of either kind is live. A settings code is hashed
 * together with its purpose and the issuing session (`settingsCodeInput`),
 * while the login path hashes the bare code: a login code never verifies here,
 * a settings code never verifies at login, and a settings code only works in
 * the session that requested it.
 *
 * Each change, its code consumption and its security audit row commit in one
 * transaction, under a lock on the user row that also rechecks the session.
 *
 * @module modules/auth/auth.mfa-enrolment.service
 */

import { createHash } from "node:crypto";
import type { Request } from "express";
import { eq } from "drizzle-orm";
import { users, securityAuditLogs, type User } from "@shared/schema";
import { userRepository } from "../../repositories/UserRepository";
import { hashPassword, verifyPassword } from "../../auth";
import {
  ConflictError, EmailVerificationRequiredError, InvalidCredentialsError, MfaRequiredError,
  ServiceUnavailableError, UnauthorizedError,
} from "../../core/errors";
import { isMfaGraceOver } from "./auth.mfa-compliance";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { lockCurrentSessionCredential } from "../../services/session-identity";
import { isEmailServiceConfigured, sendMfaCodeEmail } from "../../services/emailService";
import { AuditEventType } from "../../services/AuditService";
import { generateBackupCodes, generateMfaCode, MFA_CODE_TTL_MS } from "../../routes/security.mfa.utils";

/** Whether the operation expects MFA to be on (disable, regenerate) or off (enrol). */
type MfaState = "on" | "off";

/** The one action a settings code may authorise. */
export type MfaSettingsPurpose = "enable" | "disable" | "regenerate";
const STATE_FOR: Record<MfaSettingsPurpose, MfaState> = { enable: "off", disable: "on", regenerate: "on" };

const invalidCode = () =>
  new InvalidCredentialsError("That code is wrong or has expired. Request a new code and try again.");
const emailUnavailable = () =>
  new ServiceUnavailableError("We can't send email right now, so we can't send you a code. Please try again later.");

function assertState(user: User, expected: MfaState): void {
  const isOn = Boolean(user.mfaEnabled);
  if (expected === "on" && !isOn) throw new ConflictError("Two-step verification is not turned on.");
  if (expected === "off" && isOn) throw new ConflictError("Two-step verification is already turned on.");
}

/**
 * What a settings code is hashed as. The code goes FIRST: bcrypt reads only
 * the first 72 bytes, so it must never be pushed past that limit. The action
 * and the session are folded into a fixed 50-hex-character SHA-256 digest, so
 * the input is always 6 + 14 + 50 = 70 bytes whatever the action. A code is
 * therefore valid only for the one action, in the one session, that asked for
 * it. 70 bytes is
 * deliberately longer than the login verifier's 64-character input maximum
 * (`mfaLoginVerifySchema`), so this construction can never be submitted at login.
 */
const SESSION_DIGEST_LENGTH = 50;
function settingsCodeInput(purpose: MfaSettingsPurpose, sessionId: string, code: string): string {
  const binding = createHash("sha256").update(`${purpose}:${sessionId}`).digest("hex").slice(0, SESSION_DIGEST_LENGTH);
  return `${code}|mfa-settings|${binding}`;
}

const isCodeLive = (user: User): boolean =>
  Boolean(user.mfaCode && user.mfaCodeExpiry && Date.now() < user.mfaCodeExpiry.getTime());

async function loadSnapshot(req: Request): Promise<User> {
  const user = req.session.userId ? await userRepository.findById(req.session.userId) : undefined;
  if (!user) throw new UnauthorizedError("Authentication changed; sign in again");
  return user;
}

async function writeAudit(tx: TransactionType, req: Request, userId: string, eventType: AuditEventType,
  details: Record<string, unknown>): Promise<void> {
  await tx.insert(securityAuditLogs).values({
    userId, eventType, details,
    ipAddress: req.ip || req.socket?.remoteAddress,
    userAgent: req.headers["user-agent"],
  });
}

/**
 * Email a fresh one-time code for exactly one action: "enable" starts
 * enrolment; "disable" and "regenerate" need MFA on. MFA state is never
 * changed here.
 */
export async function sendMfaSettingsCode(req: Request, purpose: MfaSettingsPurpose): Promise<{ expiresInSeconds: number }> {
  if (!isEmailServiceConfigured()) throw emailUnavailable();
  const expected = STATE_FOR[purpose];
  const snapshot = await loadSnapshot(req);
  assertState(snapshot, expected);
  const code = generateMfaCode();
  const hash = await hashPassword(settingsCodeInput(purpose, req.sessionID, code));
  const current = await withTransaction(async (tx) => {
    const locked = await lockCurrentSessionCredential(tx, snapshot, req.sessionID, req.session.securityGeneration);
    assertState(locked, expected);
    if (!locked.emailVerified) throw new EmailVerificationRequiredError();
    await tx.update(users).set({ mfaCode: hash, mfaCodeExpiry: new Date(Date.now() + MFA_CODE_TTL_MS) })
      .where(eq(users.id, locked.id));
    return locked;
  });
  const sent = await sendMfaCodeEmail(current.email, code, current.fullName || current.username, "settings");
  if (!sent) throw emailUnavailable();
  return { expiresInSeconds: MFA_CODE_TTL_MS / 1000 };
}

/**
 * Check the code against the snapshot (slow hash, outside the lock). Callers
 * do this before any other hashing, so a wrong code costs one comparison.
 */
async function proveCode(req: Request, snapshot: User, code: string, purpose: MfaSettingsPurpose): Promise<void> {
  const storedHash = snapshot.mfaCode;
  if (!storedHash || !isCodeLive(snapshot) ||
      !(await verifyPassword(settingsCodeInput(purpose, req.sessionID, code), storedHash))) throw invalidCode();
  assertState(snapshot, STATE_FOR[purpose]);
}

/** Consume exactly the proven code and apply `change` in one locked transaction. */
async function consumeCodeAndApply(req: Request, snapshot: User, expected: MfaState,
  change: (tx: TransactionType, current: User) => Promise<void>): Promise<void> {
  await withTransaction(async (tx) => {
    const current = await lockCurrentSessionCredential(tx, snapshot, req.sessionID, req.session.securityGeneration);
    if (!isCodeLive(current) || current.mfaCode !== snapshot.mfaCode) throw invalidCode();
    assertState(current, expected);
    await change(tx, current);
  });
}

async function newBackupCodes(): Promise<{ plain: string[]; hashed: string[] }> {
  const plain = generateBackupCodes();
  return { plain, hashed: await Promise.all(plain.map((value) => hashPassword(value))) };
}

/** Finish enrolment. Returns the plaintext backup codes — the only time they leave the server. */
export async function confirmMfaEnrolment(req: Request, code: string): Promise<string[]> {
  const snapshot = await loadSnapshot(req);
  await proveCode(req, snapshot, code, "enable");
  const backup = await newBackupCodes();
  await consumeCodeAndApply(req, snapshot, "off", async (tx, current) => {
    const now = new Date();
    await tx.update(users).set({
      mfaEnabled: true, mfaMethod: "email", mfaCode: null, mfaCodeExpiry: null,
      mfaBackupCodes: backup.hashed, mfaBackupCodesGeneratedAt: now, updatedAt: now,
    }).where(eq(users.id, current.id));
    await writeAudit(tx, req, current.id, AuditEventType.MFA_ENABLED, { method: "email", backupCodes: backup.hashed.length });
  });
  return backup.plain;
}

/** Turn MFA off. Needs the current password and a fresh emailed code. */
export async function disableMfa(req: Request, password: string, code: string): Promise<void> {
  const snapshot = await loadSnapshot(req);
  if (!(await verifyPassword(password, snapshot.passwordHash))) throw new InvalidCredentialsError("That password is not correct.");
  await proveCode(req, snapshot, code, "disable");
  await consumeCodeAndApply(req, snapshot, "on", async (tx, current) => {
    // AH-11: after the grace MFA is mandatory; checked on the locked row, so the code is not consumed.
    if (isMfaGraceOver(current)) throw new MfaRequiredError();
    await tx.update(users).set({
      mfaEnabled: false, mfaMethod: null, mfaCode: null, mfaCodeExpiry: null,
      mfaBackupCodes: null, mfaBackupCodesGeneratedAt: null, updatedAt: new Date(),
    }).where(eq(users.id, current.id));
    await writeAudit(tx, req, current.id, AuditEventType.MFA_DISABLED, { method: "email" });
  });
}

/** Replace every backup code. Needs a fresh emailed code; returns the new codes once. */
export async function regenerateMfaBackupCodes(req: Request, code: string): Promise<string[]> {
  const snapshot = await loadSnapshot(req);
  await proveCode(req, snapshot, code, "regenerate");
  const backup = await newBackupCodes();
  await consumeCodeAndApply(req, snapshot, "on", async (tx, current) => {
    const now = new Date();
    await tx.update(users).set({
      mfaCode: null, mfaCodeExpiry: null, mfaBackupCodes: backup.hashed, mfaBackupCodesGeneratedAt: now, updatedAt: now,
    }).where(eq(users.id, current.id));
    await writeAudit(tx, req, current.id, AuditEventType.MFA_BACKUP_CODES_REGENERATED, {
      replaced: current.mfaBackupCodes?.length ?? 0, backupCodes: backup.hashed.length,
    });
  });
  return backup.plain;
}
