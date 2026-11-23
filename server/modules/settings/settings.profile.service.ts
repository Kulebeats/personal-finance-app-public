/**
 * AH-07: a profile save and its audit row commit together. The member's row is
 * locked, read, written and audited in one transaction, so a failed audit rolls
 * the save back and the audited field names are exactly what was written.
 * Only field names are audited: the profile holds phone, address and income values.
 */
import { eq } from "drizzle-orm";
import { households, users, type User } from "@shared/schema";
import { NotFoundError } from "../../core/errors";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";
import { changedProfileFields, profileForStorage } from "./settings.profile.helpers";
import type { UpdateProfileInput } from "./settings.profile.validation";

export interface ProfileSaveContext {
  readonly userId: string;
  readonly householdId: string | null;
  readonly ipAddress?: string;
}

export interface ProfileSaveResult {
  readonly user: User;
  readonly changedFields: string[];
}

export async function saveOwnProfile(context: ProfileSaveContext, input: UpdateProfileInput): Promise<ProfileSaveResult> {
  const { userId, householdId, ipAddress } = context;
  return withTransaction(async (tx) => {
    // The audit row's household foreign key takes KEY SHARE on the household; take it
    // before the user lock, in the household-first order the membership paths use.
    if (householdId) await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("key share");
    const [existing] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!existing) throw new NotFoundError("User not found");
    const [user] = await tx.update(users).set({ ...profileForStorage(input), updatedAt: new Date() })
      .where(eq(users.id, userId)).returning();
    const changedFields = changedProfileFields(existing, user, input);
    await businessAuditService.logUpdate({
      householdId, userId, entityType: "user", entityId: userId, ipAddress, metadata: { changedFields }, tx,
    });
    return { user, changedFields };
  });
}
