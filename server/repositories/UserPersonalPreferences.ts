import { eq } from "drizzle-orm";
import { userPreferences, type User, type UserPreferences } from "@shared/schema";
import { toUserPreferencesResponse, type UserPreferencesPatch } from "@shared/user-preferences";
import { db } from "../db";
import { lockCurrentSessionCredential } from "../services/session-identity";

export async function readUserPersonalPreferences(userId: string): Promise<UserPreferences | undefined> {
  const [row] = await db.select().from(userPreferences)
    .where(eq(userPreferences.userId, userId)).limit(1);
  return row;
}

/** The existing user row serializes concurrent first inserts and partial edits. */
export async function patchUserPersonalPreferences(
  snapshot: User,
  sid: string,
  sessionGeneration: number | undefined,
  patch: UserPreferencesPatch,
): Promise<UserPreferences> {
  return db.transaction(async tx => {
    const { id: userId } = await lockCurrentSessionCredential(tx, snapshot, sid, sessionGeneration);

    const [current] = await tx.select().from(userPreferences)
      .where(eq(userPreferences.userId, userId)).limit(1).for("update");
    if (!current) {
      const [inserted] = await tx.insert(userPreferences).values({ userId, ...patch }).returning();
      toUserPreferencesResponse(userId, inserted);
      return inserted;
    }

    const [updated] = await tx.update(userPreferences).set({ ...patch, updatedAt: new Date() })
      .where(eq(userPreferences.userId, userId)).returning();
    // A malformed legacy sibling must abort the whole patch before COMMIT.
    toUserPreferencesResponse(userId, updated);
    return updated;
  });
}
