import type { Request } from "express";
import { eq } from "drizzle-orm";
import { users, securityAuditLogs, type User } from "@shared/schema";
import { userRepository } from "../../repositories/UserRepository";
import { verifyPassword } from "../../auth";
import { UnauthorizedError } from "../../core/errors";
import { withTransaction } from "../../utils/withTransaction";
import { lockCredentialSnapshot, lockCurrentSessionCredential } from "../../services/session-identity";

const invalid = () => new UnauthorizedError("Invalid or expired MFA code");
const backupsCurrent = (date: Date | null) => date !== null && Date.now() < date.getTime() + 90 * 86400000;

/** A reset/erasure crossing challenge creation cannot write a fresh challenge. */
export async function storeMfaChallenge(snapshot: User, hash: string, expiresAt: Date): Promise<void> {
  await withTransaction(async (tx) => {
    const current = await lockCredentialSnapshot(tx, snapshot);
    if (!current.mfaEnabled) throw invalid();
    await tx.update(users).set({ mfaCode: hash, mfaCodeExpiry: expiresAt }).where(eq(users.id, current.id));
  });
}

/** Verify optimistically, then consume only that exact credential under a user lock. */
export async function consumeMfaCredential(req: Request, code: string, purpose: "login" | "step-up") {
  const userId = purpose === "login" ? req.session.mfaPendingUserId : req.session.userId;
  if (!userId || (purpose === "login" ? req.session.userId : req.session.mfaPendingUserId)) throw invalid();
  const snapshot = await userRepository.findById(userId);
  if (!snapshot || !snapshot.mfaEnabled || snapshot.erasedAt || snapshot.passwordHash.startsWith("!erased!")) throw invalid();
  let kind: "otp" | "backup" | undefined;
  const backupMatches = new Set<string>();
  if (snapshot.mfaCode && snapshot.mfaCodeExpiry && Date.now() < snapshot.mfaCodeExpiry.getTime() && await verifyPassword(code, snapshot.mfaCode)) kind = "otp";
  if (!kind && purpose === "login" && backupsCurrent(snapshot.mfaBackupCodesGeneratedAt)) {
    // Consume duplicate representations of the same raw code together, while
    // preserving a concurrent different code's removal from the fresh array.
    for (const hash of snapshot.mfaBackupCodes ?? []) if (await verifyPassword(code, hash)) backupMatches.add(hash);
    if (backupMatches.size) kind = "backup";
  }
  if (!kind) throw invalid();

  return withTransaction(async (tx) => {
    const generation = purpose === "login" ? req.session.mfaPendingSecurityGeneration : req.session.securityGeneration;
    const current = await lockCurrentSessionCredential(tx, snapshot, req.sessionID, generation, purpose === "login" ? "pendingMfa" : "authenticated");
    if (!current.mfaEnabled || (current.lockedUntil && current.lockedUntil.getTime() > Date.now())) throw invalid();
    let remaining = current.mfaBackupCodes;
    if (kind === "otp") {
      if (!current.mfaCode || current.mfaCode !== snapshot.mfaCode || !current.mfaCodeExpiry || Date.now() >= current.mfaCodeExpiry.getTime()) throw invalid();
      await tx.update(users).set({ mfaCode: null, mfaCodeExpiry: null }).where(eq(users.id, current.id));
    } else {
      if (!backupsCurrent(current.mfaBackupCodesGeneratedAt) || current.mfaBackupCodesGeneratedAt?.getTime() !== snapshot.mfaBackupCodesGeneratedAt?.getTime() ||
          !current.mfaBackupCodes?.some((hash) => backupMatches.has(hash))) throw invalid();
      remaining = current.mfaBackupCodes.filter((hash) => !backupMatches.has(hash));
      await tx.update(users).set({ mfaBackupCodes: remaining, updatedAt: new Date() }).where(eq(users.id, current.id));
    }
    await tx.insert(securityAuditLogs).values({ userId: current.id, eventType: "MFA_VERIFIED", ipAddress: req.ip || req.socket?.remoteAddress,
      userAgent: req.headers["user-agent"], details: { action: purpose, method: kind } });
    return { user: { ...current, ...(kind === "otp" ? { mfaCode: null, mfaCodeExpiry: null } : { mfaBackupCodes: remaining }) }, kind };
  });
}
