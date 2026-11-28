import { and, eq, isNull, gt, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  householdMembers,
  householdPreferences,
  householdInvitations,
  households,
  users,
  type Household,
  type InsertHousehold,
  type HouseholdInvitation,
  type InsertHouseholdInvitation,
} from "@shared/schema";
import { withTransaction } from "../utils/withTransaction";
import { seedDefaultCategories, seedDefaultTags } from "../seed";
import { ConflictError, NotFoundError } from "../utils/errorHandler";
import { isPostgresError } from "../utils/postgresError";
import { lockUserMembership } from "./householdMembershipLock";

type HouseholdRole = typeof householdMembers.$inferInsert["role"];
type HouseholdPreferences = typeof householdPreferences.$inferSelect;

const PENDING_INVITATION_UNIQUE_INDEX = "household_invitations_pending_email_unique";

export class HouseholdRepository {
  async findById(id: string): Promise<Household | undefined> {
    const result = await db
      .select()
      .from(households)
      .where(eq(households.id, id))
      .limit(1);
    return result[0];
  }

  async findByUserId(userId: string): Promise<Household | undefined> {
    const result = await db
      .select({ household: households })
      .from(householdMembers)
      .innerJoin(households, eq(householdMembers.householdId, households.id))
      .where(eq(householdMembers.userId, userId)).orderBy(householdMembers.id)
      .limit(1);
    return result[0]?.household;
  }

  /**
   * Low-level household insert with no owner membership. Prefer
   * {@link createWithOwner} for the create flow — calling this alone leaves an
   * ownerless household that findByUserId can never reach. Retained for test
   * fixtures and internal composition only.
   */
  async create(data: InsertHousehold): Promise<Household> {
    const result = await db.insert(households).values(data).returning();
    return result[0];
  }

  /**
   * Create a household with its owner, default tags and categories as one
   * atomic unit. The controller previously issued these as separate,
   * non-transactional writes (household insert → owner addMember →
   * seedDefaultTags), so a failure in the second or third step left an
   * orphaned, ownerless household: findByUserId joins through household_members,
   * so the creating user could neither see nor delete it. Wrapping these steps in
   * a single transaction makes creation all-or-nothing — a partial failure rolls
   * back fully and never leaves an ownerless household.
   *
   * This is also the single, authoritative guard for the "one household per
   * user" rule. A bare findByUserId-then-create check (as the controller used
   * to do) is a TOCTOU race: two concurrent create requests by the same user
   * both pass the check — neither sees the other's uncommitted owner membership
   * — and both insert a household, leaving the user a member of two households.
   * To close the race this takes a per-user, transaction-scoped Postgres
   * advisory lock (pg_advisory_xact_lock) as the first statement, then re-checks
   * membership inside the lock: a second concurrent create blocks until the
   * first commits, then observes the committed membership and is rejected with
   * ConflictError. The lock auto-releases on commit/rollback. A unique index on
   * household_members.userId would be the WRONG fix — a user legitimately
   * belongs to multiple households via acceptInvite.
   */
  async createWithOwner(params: {
    name: string;
    currency: string;
    userId: string;
  }): Promise<Household> {
    return await withTransaction(async (tx) => {
      // Serialize concurrent creates and invite accepts for this user (Rule 10).
      await lockUserMembership(tx, params.userId);

      // A-20: an erasure holding this lock may have just committed; an erased
      // account gets no household.
      const [user] = await tx.select({ erasedAt: users.erasedAt }).from(users).where(eq(users.id, params.userId)).limit(1);
      if (user?.erasedAt) {
        throw new NotFoundError("User not found");
      }

      // Authoritative single-household guard, now under the lock so it observes
      // any membership a concurrent create committed just before us.
      const existing = await tx
        .select({ id: householdMembers.id })
        .from(householdMembers)
        .where(eq(householdMembers.userId, params.userId))
        .limit(1);
      if (existing.length > 0) {
        throw new ConflictError("User already has a household");
      }

      const [household] = await tx
        .insert(households)
        .values({ name: params.name, currency: params.currency })
        .returning();
      await tx.insert(householdMembers).values({
        householdId: household.id,
        userId: params.userId,
        role: "owner",
      });
      await seedDefaultTags(household.id, tx);
      await seedDefaultCategories(household.id, tx);
      return household;
    });
  }

  async update(
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

  async findMember(householdId: string, userId: string) {
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

  /**
   * SCP-333: list members joined to the users table so the client can render
   * each member's name and email. Previously this returned only
   * household_members rows (no name/email), so MemberList showed blank rows.
   * LEFT JOIN keeps a row even if a user record is somehow missing; the
   * controller applies PRIV-001 email filtering on top of this.
   */
  async findMembers(householdId: string) {
    return await db
      .select({
        id: householdMembers.id,
        householdId: householdMembers.householdId,
        userId: householdMembers.userId,
        role: householdMembers.role,
        joinedAt: householdMembers.joinedAt,
        lastActiveAt: householdMembers.lastActiveAt,
        // AH-05: never a blank name on the members screen.
        name: sql<string | null>`coalesce(${users.fullName}, ${users.displayName}, ${users.username})`,
        email: users.email,
      })
      .from(householdMembers)
      .leftJoin(users, eq(householdMembers.userId, users.id))
      .where(eq(householdMembers.householdId, householdId));
  }

  async addMember(data: {
    householdId: string;
    userId: string;
    role: HouseholdRole;
  }) {
    try {
      const result = await db.insert(householdMembers).values(data).returning();
      return result[0];
    } catch (error: unknown) {
      // A user may belong to a household at most once
      // (household_members_household_user_unique). Surface a re-add as a
      // ConflictError (Rule 7) instead of leaking a raw 23505 / 500, and so the
      // duplicate never persists.
      if (
        isPostgresError(
          error,
          "23505",
          "household_members_household_user",
        )
      ) {
        throw new ConflictError("User is already a member of this household");
      }
      throw error;
    }
  }

  async findPreferences(householdId: string) {
    const result = await db
      .select()
      .from(householdPreferences)
      .where(eq(householdPreferences.householdId, householdId))
      .limit(1);
    return result[0];
  }

  async createPreferences(data: { householdId: string }) {
    const result = await db
      .insert(householdPreferences)
      .values(data)
      .returning();
    return result[0];
  }

  async updatePreferences(
    householdId: string,
    data: Partial<HouseholdPreferences>
  ) {
    const result = await db
      .update(householdPreferences)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(householdPreferences.householdId, householdId))
      .returning();
    return result[0];
  }

  // ============================================================================
  // INVITATION METHODS
  // ============================================================================

  /**
   * Create a new household invitation.
   *
   * AH-05: one unaccepted invitation per household and lower-cased address is
   * a database rule (`household_invitations_pending_email_unique`, migration
   * 0064), so two concurrent invites cannot both land. An expired, never
   * accepted invitation for the same address still holds that slot, so it is
   * deleted in the same transaction before the insert. Losing the race is a
   * 409, the same answer the controller's earlier check gives.
   *
   * Lock order: the household row FOR UPDATE first, then the invitation rows,
   * as resend (invitations.resend.ts) and accept (invitations.accept.ts) do.
   * Deleting the expired row first would hold its lock while the insert's
   * foreign-key check waits on the household, and a resend or accept holding
   * the household while it waits on that row would deadlock with it.
   */
  async createInvitation(
    data: Omit<InsertHouseholdInvitation, "id" | "createdAt">
  ): Promise<HouseholdInvitation> {
    try {
      return await withTransaction(async (tx) => {
        const [household] = await tx
          .select({ id: households.id })
          .from(households)
          .where(eq(households.id, data.householdId))
          .for("update")
          .limit(1);
        if (!household) throw new NotFoundError("Household not found");
        await tx
          .delete(householdInvitations)
          .where(
            and(
              eq(householdInvitations.householdId, data.householdId),
              sql`lower(${householdInvitations.email}) = lower(${data.email})`,
              isNull(householdInvitations.acceptedAt),
              lte(householdInvitations.expiresAt, new Date())
            )
          );
        const [invitation] = await tx
          .insert(householdInvitations)
          .values(data)
          .returning();
        return invitation;
      });
    } catch (error) {
      if (isPostgresError(error, "23505", PENDING_INVITATION_UNIQUE_INDEX)) {
        throw new ConflictError("An invitation for this email is already pending");
      }
      throw error;
    }
  }

  /**
   * Find an invitation by its secure invite code
   */
  async findInvitationByCode(
    inviteCode: string
  ): Promise<HouseholdInvitation | undefined> {
    const result = await db
      .select()
      .from(householdInvitations)
      .where(eq(householdInvitations.inviteCode, inviteCode))
      .limit(1);
    return result[0];
  }

  /**
   * Find an invitation by ID within a household
   */
  async findInvitationById(
    invitationId: string,
    householdId: string
  ): Promise<HouseholdInvitation | undefined> {
    const result = await db
      .select()
      .from(householdInvitations)
      .where(
        and(
          eq(householdInvitations.id, invitationId),
          eq(householdInvitations.householdId, householdId)
        )
      )
      .limit(1);
    return result[0];
  }

  /**
   * Find pending (not accepted, not expired) invitations for a household
   */
  async findPendingInvitationsByHousehold(
    householdId: string
  ): Promise<HouseholdInvitation[]> {
    return await db
      .select()
      .from(householdInvitations)
      .where(
        and(
          eq(householdInvitations.householdId, householdId),
          isNull(householdInvitations.acceptedAt),
          gt(householdInvitations.expiresAt, new Date())
        )
      );
  }

  /**
   * Find pending invitation for a specific email in a household
   */
  async findPendingInvitationByEmail(
    householdId: string,
    email: string
  ): Promise<HouseholdInvitation | undefined> {
    const result = await db
      .select()
      .from(householdInvitations)
      .where(
        and(
          eq(householdInvitations.householdId, householdId),
          eq(householdInvitations.email, email.toLowerCase()),
          isNull(householdInvitations.acceptedAt),
          gt(householdInvitations.expiresAt, new Date())
        )
      )
      .limit(1);
    return result[0];
  }

  /**
   * Delete an invitation (cancel it)
   */
  async deleteInvitation(invitationId: string, householdId: string): Promise<void> {
    await db
      .delete(householdInvitations)
      .where(
        and(
          eq(householdInvitations.id, invitationId),
          eq(householdInvitations.householdId, householdId)
        )
      );
  }

  /**
   * Mark an invitation as accepted
   */
  async markInvitationAccepted(
    invitationId: string,
    acceptedByUserId: string
  ): Promise<HouseholdInvitation | undefined> {
    const result = await db
      .update(householdInvitations)
      .set({
        acceptedAt: new Date(),
        acceptedBy: acceptedByUserId,
      })
      .where(eq(householdInvitations.id, invitationId))
      .returning();
    return result[0];
  }
}

export const householdRepository = new HouseholdRepository();
