import type { Request } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { passwordResetTokens, securityAuditLogs, users } from "@shared/schema";
import { db } from "../db";
import { userRepository } from "../repositories/UserRepository";
import { verifyPassword } from "../auth";
import { UnauthorizedError, ValidationError, InvalidCredentialsError, RateLimitError } from "../core/errors";
import { sha256Hex } from "../core/tokenHash";
import { withTransaction } from "../utils/withTransaction";
import { lockCurrentSessionCredential } from "./session-identity";
import { enqueueSecurityNotice } from "./security-notice";

const invalidToken = () => new ValidationError("Invalid or expired verification link");
const live = (user: typeof users.$inferSelect | undefined) => user && !user.erasedAt && !user.passwordHash.startsWith("!erased!");
const verificationLifetimeMs = 24 * 60 * 60 * 1000;
const resendCooldownMs = 60 * 1000;
function challenge() { return { token: randomBytes(32).toString("hex"), expiry: new Date(Date.now() + verificationLifetimeMs) }; }
// All current issuers use the same 24-hour lifetime (including registration).
// Check the locked persisted challenge, so new IPs/processes cannot bypass it.
function resendDelay(user: typeof users.$inferSelect): number {
  if (!user.emailVerificationToken || !user.emailVerificationExpiry) return 0;
  const issuedAt = user.emailVerificationExpiry.getTime() - verificationLifetimeMs;
  return Math.max(0, Math.ceil((issuedAt + resendCooldownMs - Date.now()) / 1000));
}

/** Both token consumers share the same user-first, single-use state. The initial
 * auth endpoint cannot consume a pending email-change challenge. */
export async function consumeEmailVerificationToken(token: string, options: { initialOnly: boolean; request?: Request }): Promise<boolean> {
  const tokenHash = sha256Hex(token);
  const [candidate] = await db.select({ id: users.id }).from(users).where(eq(users.emailVerificationToken, tokenHash)).limit(1);
  if (!candidate) throw invalidToken();
  return withTransaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, candidate.id)).for("update");
    if (!live(current) || current.emailVerificationToken !== tokenHash || !current.emailVerificationExpiry || current.emailVerificationExpiry.getTime() <= Date.now()) throw invalidToken();
    const changing = current.pendingEmail !== null;
    if (changing && (options.initialOnly || !options.request)) throw invalidToken();
    const next = changing ? z.string().email().max(255).parse(current.pendingEmail) : current.email;
    await tx.update(users).set({ email: next, emailVerified: true, pendingEmail: null, emailVerificationToken: null,
      emailVerificationExpiry: null, ...(changing ? { mfaCode: null, mfaCodeExpiry: null } : {}), updatedAt: new Date() }).where(eq(users.id, current.id));
    if (changing) {
      await tx.update(passwordResetTokens).set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.userId, current.id), isNull(passwordResetTokens.usedAt)));
      await enqueueSecurityNotice(tx, current, options.request!, { eventType: "EMAIL_CHANGED", kind: "email_changed", action: "email_change",
        recipients: [...(current.emailVerified ? [current.email] : []), next] });
    } else {
      await tx.insert(securityAuditLogs).values({ eventType: "EMAIL_VERIFIED", userId: current.id,
        details: { action: "email_verified" }, ipAddress: options.request?.ip || null, userAgent: options.request?.headers["user-agent"] || null });
    }
    return changing;
  });
}

export async function requestEmailChange(req: Request, newEmail: string, password: string) {
  const snapshot = await userRepository.findById(req.session.userId!);
  if (!snapshot) throw new UnauthorizedError("Authentication changed; sign in again");
  if (!await verifyPassword(password, snapshot.passwordHash)) throw new InvalidCredentialsError("Invalid password");
  return withTransaction(async (tx) => {
    const current = await lockCurrentSessionCredential(tx, snapshot, req.sessionID, req.session.securityGeneration);
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, newEmail)).limit(1);
    if (existing) throw new ValidationError("This email is already in use");
    const issued = challenge();
    await tx.update(users).set({ pendingEmail: newEmail, emailVerificationToken: sha256Hex(issued.token),
      emailVerificationExpiry: issued.expiry, updatedAt: new Date() }).where(eq(users.id, current.id));
    return { email: newEmail, token: issued.token, isEmailChange: true };
  });
}
export async function resendOwnEmailVerification(req: Request) {
  const snapshot = await userRepository.findById(req.session.userId!);
  if (!snapshot) throw new UnauthorizedError("Authentication changed; sign in again");
  return withTransaction(async (tx) => {
    const current = await lockCurrentSessionCredential(tx, snapshot, req.sessionID, req.session.securityGeneration);
    if (current.emailVerified && !current.pendingEmail) return null;
    const delay = resendDelay(current);
    if (delay > 0) throw new RateLimitError(delay);
    const issued = challenge();
    await tx.update(users).set({ emailVerificationToken: sha256Hex(issued.token), emailVerificationExpiry: issued.expiry,
      updatedAt: new Date() }).where(eq(users.id, current.id));
    return { email: current.pendingEmail || current.email, token: issued.token, isEmailChange: !!current.pendingEmail };
  });
}
export async function cancelOwnEmailChange(req: Request): Promise<void> {
  const snapshot = await userRepository.findById(req.session.userId!);
  if (!snapshot) throw new UnauthorizedError("Authentication changed; sign in again");
  await withTransaction(async (tx) => {
    const current = await lockCurrentSessionCredential(tx, snapshot, req.sessionID, req.session.securityGeneration);
    if (!current.pendingEmail) return;
    await tx.update(users).set({ pendingEmail: null, emailVerificationToken: null, emailVerificationExpiry: null,
      updatedAt: new Date() }).where(eq(users.id, current.id));
  });
}

/** Public registration resend must not overwrite a pending change challenge or
 * issue a usable link to a former-address snapshot. Unknowns remain generic. */
export async function issueInitialEmailVerification(email: string) {
  const snapshot = await userRepository.findByEmail(email);
  if (!snapshot) return null;
  return withTransaction(async (tx) => {
    const [current] = await tx.select().from(users).where(eq(users.id, snapshot.id)).for("update");
    if (!live(current) || current.email !== email || current.emailVerified || current.pendingEmail) return null;
    // Public replies remain generic and cannot reveal registration/cooldown state.
    if (resendDelay(current) > 0) return null;
    const issued = challenge();
    await tx.update(users).set({ emailVerificationToken: sha256Hex(issued.token), emailVerificationExpiry: issued.expiry,
      updatedAt: new Date() }).where(eq(users.id, current.id));
    return { userId: current.id, email: current.email, token: issued.token };
  });
}
