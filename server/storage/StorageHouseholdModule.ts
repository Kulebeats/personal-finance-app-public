import { and, eq } from "drizzle-orm";
import { db } from "../db";
import {
  households,
  householdMembers,
  householdPreferences,
  type Household,
  type InsertHousehold,
} from "@shared/schema";
import { StorageUserModule } from "./StorageUserModule";

export class StorageHouseholdModule extends StorageUserModule {
  // ============================================================================
  // HOUSEHOLD METHODS
  // ============================================================================

  async getHousehold(id: string): Promise<Household | undefined> {
    const result = await db
      .select()
      .from(households)
      .where(eq(households.id, id))
      .limit(1);
    return result[0];
  }

  async getHouseholdByUserId(userId: string): Promise<Household | undefined> {
    const result = await db
      .select({ household: households })
      .from(householdMembers)
      .innerJoin(households, eq(householdMembers.householdId, households.id))
      .where(eq(householdMembers.userId, userId))
      .limit(1);
    return result[0]?.household;
  }

  async createHousehold(insertHousehold: InsertHousehold): Promise<Household> {
    const result = await db
      .insert(households)
      .values(insertHousehold)
      .returning();
    return result[0];
  }

  async updateHousehold(
    id: string,
    data: Partial<Household>
  ): Promise<Household | undefined> {
    const result = await db
      .update(households)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(households.id, id))
      .returning();
    return result[0];
  }

  // ============================================================================
  // HOUSEHOLD MEMBER METHODS
  // ============================================================================

  async getHouseholdMember(householdId: string, userId: string) {
    const result = await db
      .select()
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.userId, userId)
        )
      )
      .limit(1);
    return result[0];
  }

  // Alias for getHouseholdMember (used by middleware)
  async getHouseholdMembership(householdId: string, userId: string) {
    return this.getHouseholdMember(householdId, userId);
  }

  async getHouseholdMembers(householdId: string) {
    return await db
      .select()
      .from(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
  }

  async addHouseholdMember(data: {
    householdId: string;
    userId: string;
    role: "owner" | "admin" | "member" | "view_only" | "professional";
  }) {
    const result = await db.insert(householdMembers).values(data).returning();
    return result[0];
  }

  async updateHouseholdMemberRole(
    householdId: string,
    userId: string,
    role: "owner" | "admin" | "member" | "view_only" | "professional"
  ) {
    const result = await db
      .update(householdMembers)
      .set({ role })
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.userId, userId)
        )
      )
      .returning();
    return result[0];
  }

  async removeHouseholdMember(householdId: string, userId: string) {
    await db
      .delete(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.userId, userId)
        )
      );
  }

  // ============================================================================
  // HOUSEHOLD PREFERENCES METHODS
  // ============================================================================

  async getHouseholdPreferences(householdId: string) {
    const result = await db
      .select()
      .from(householdPreferences)
      .where(eq(householdPreferences.householdId, householdId))
      .limit(1);
    return result[0];
  }

  async createHouseholdPreferences(data: { householdId: string }) {
    const result = await db
      .insert(householdPreferences)
      .values(data)
      .returning();
    return result[0];
  }

  async updateHouseholdPreferences(householdId: string, data: Partial<typeof householdPreferences.$inferSelect>) {
    const result = await db
      .update(householdPreferences)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(householdPreferences.householdId, householdId))
      .returning();
    return result[0];
  }

  // ============================================================================
  // HOUSEHOLD INVITATION METHODS
  // ============================================================================

  async getInvitationByEmail(householdId: string, email: string) {
    const { householdInvitations } = await import("@shared/schema");
    const result = await db
      .select()
      .from(householdInvitations)
      .where(
        and(
          eq(householdInvitations.householdId, householdId),
          eq(householdInvitations.email, email.toLowerCase())
        )
      )
      .limit(1);
    return result[0];
  }

  async getPendingInvitationByEmail(email: string) {
    const { householdInvitations } = await import("@shared/schema");
    const { isNull, gt } = await import("drizzle-orm");
    const result = await db
      .select()
      .from(householdInvitations)
      .where(
        and(
          eq(householdInvitations.email, email.toLowerCase()),
          isNull(householdInvitations.acceptedAt),
          gt(householdInvitations.expiresAt, new Date())
        )
      )
      .limit(1);
    return result[0];
  }

  async createInvitation(data: {
    householdId: string;
    email: string;
    role: "owner" | "admin" | "member" | "view_only" | "professional";
    inviteCode: string;
    invitedBy: string;
    expiresAt: Date;
  }) {
    const { householdInvitations } = await import("@shared/schema");
    const result = await db
      .insert(householdInvitations)
      .values({
        householdId: data.householdId,
        email: data.email.toLowerCase(),
        role: data.role,
        inviteCode: data.inviteCode,
        invitedBy: data.invitedBy,
        expiresAt: data.expiresAt,
      })
      .returning();
    return result[0];
  }

  async acceptInvitation(invitationId: string) {
    const { householdInvitations } = await import("@shared/schema");
    const result = await db
      .update(householdInvitations)
      .set({ acceptedAt: new Date() })
      .where(eq(householdInvitations.id, invitationId))
      .returning();
    return result[0];
  }

  async getHouseholdInvitations(householdId: string) {
    const { householdInvitations } = await import("@shared/schema");
    const { isNull } = await import("drizzle-orm");
    return await db
      .select()
      .from(householdInvitations)
      .where(
        and(
          eq(householdInvitations.householdId, householdId),
          isNull(householdInvitations.acceptedAt)
        )
      );
  }
}
