import { and, eq, isNull, gt, inArray, sql } from "drizzle-orm";
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
import { seedDefaultTags } from "../seed";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errorHandler";
import { isPostgresError } from "../utils/postgresError";

type HouseholdRole = typeof householdMembers.$inferInsert["role"];
type HouseholdPreferences = typeof householdPreferences.$inferSelect;

/**
 * Advisory-lock namespace (classid) for the per-user household-create lock.
 * Paired with hashtext(userId) as the objid in pg_advisory_xact_lock so these
 * create locks never collide with advisory locks taken for other purposes.
 * Value is ASCII "hous" (0x686F7573), an arbitrary but stable positive int4.
 */
const HOUSEHOLD_CREATE_LOCK_NAMESPACE = 0x686f7573;

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
      .where(eq(householdMembers.userId, userId))
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
   * Create a household together with its owner membership and default tags as
   * one atomic unit. The controller previously issued these as three separate,
   * non-transactional writes (household insert → owner addMember →
   * seedDefaultTags), so a failure in the second or third step left an
   * orphaned, ownerless household: findByUserId joins through household_members,
   * so the creating user could neither see nor delete it. Wrapping all three in
   * a single transaction makes creation all-or-nothing — a partial failure rolls
   * back fully and never leaves an ownerless household. Mirrors the atomic
   * membership-lifecycle methods (acceptInvite, transferOwnership) below.
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
      // Serialize concurrent creates for this user (CLAUDE.md Rule 10: atomic
      // read-then-write on a contended path). hashtext(userId) maps the UUID to
      // the int4 lock key; a hash collision only briefly over-serializes two
      // unrelated users and never affects correctness, because the membership
      // check below is still scoped to this exact userId.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${HOUSEHOLD_CREATE_LOCK_NAMESPACE}::int4, hashtext(${params.userId}))`
      );

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
        name: users.fullName,
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

  async updateMemberRole(
    householdId: string,
    userId: string,
    role: HouseholdRole
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

  async removeMember(householdId: string, userId: string) {
    await db
      .delete(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.userId, userId)
        )
      );
  }

  /**
   * SCP-318: transfer ownership atomically. The two role flips (new owner →
   * "owner", current owner → "admin") must be one unit, else a partial failure
   * or a concurrent transfer leaves the household with two owners or none.
   * Both member rows are locked FOR UPDATE (consistent userId order, deadlock-
   * safe) and the current owner's role is re-checked under the lock, so a second
   * concurrent transfer sees the demoted owner and is rejected — guaranteeing
   * exactly one owner.
   */
  async transferOwnership(
    householdId: string,
    currentOwnerId: string,
    newOwnerId: string
  ): Promise<void> {
    await withTransaction(async (tx) => {
      const lockedMembers = await tx
        .select()
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            inArray(householdMembers.userId, [currentOwnerId, newOwnerId])
          )
        )
        .orderBy(householdMembers.userId)
        .for("update");

      const currentMember = lockedMembers.find(
        (m) => m.userId === currentOwnerId
      );
      const targetMember = lockedMembers.find((m) => m.userId === newOwnerId);

      if (!currentMember || currentMember.role !== "owner") {
        throw new ForbiddenError(
          "Only the current owner can transfer ownership"
        );
      }
      if (!targetMember) {
        throw new NotFoundError("Target member not found");
      }

      await tx
        .update(householdMembers)
        .set({ role: "owner" })
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            eq(householdMembers.userId, newOwnerId)
          )
        );
      await tx
        .update(householdMembers)
        .set({ role: "admin" })
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            eq(householdMembers.userId, currentOwnerId)
          )
        );
    });
  }

  /**
   * SCP-333: change a member's role atomically. The previous flow read the
   * target member outside a transaction, then wrote the new role, so a
   * concurrent remove/transfer could change the row in between (read-then-write
   * race). Here the target row is locked FOR UPDATE and re-checked under the
   * lock before the update, so the decision and the write are one consistent
   * unit. Authorization (who may change which role) stays in the controller;
   * this method only guarantees the write is race-safe.
   */
  async updateMemberRoleAtomic(
    householdId: string,
    userId: string,
    role: HouseholdRole
  ) {
    return await withTransaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            eq(householdMembers.userId, userId)
          )
        )
        .for("update")
        .limit(1);

      if (!locked) {
        throw new NotFoundError("Member not found");
      }

      const [updated] = await tx
        .update(householdMembers)
        .set({ role })
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            eq(householdMembers.userId, userId)
          )
        )
        .returning();
      return updated;
    });
  }

  /**
   * SCP-333: remove a member atomically with a race-safe last-member guard.
   * The previous flow counted members and then deleted in two separate
   * statements, so two concurrent removals could each see count > 1 and both
   * delete, emptying the household. Here every member row is locked FOR UPDATE
   * (consistent userId order, deadlock-safe), the target's presence and the
   * "not the last member" invariant are re-checked under the lock, and only
   * then is the delete issued — so the count check and the delete are one unit.
   */
  async removeMemberWithLastMemberGuard(
    householdId: string,
    userId: string
  ): Promise<void> {
    await withTransaction(async (tx) => {
      const lockedMembers = await tx
        .select()
        .from(householdMembers)
        .where(eq(householdMembers.householdId, householdId))
        .orderBy(householdMembers.userId)
        .for("update");

      const target = lockedMembers.find((m) => m.userId === userId);
      if (!target) {
        throw new NotFoundError("Member not found");
      }
      if (lockedMembers.length <= 1) {
        throw new ValidationError(
          "Cannot remove the last member of the household"
        );
      }

      await tx
        .delete(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            eq(householdMembers.userId, userId)
          )
        );
    });
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
   * Create a new household invitation
   */
  async createInvitation(
    data: Omit<InsertHouseholdInvitation, "id" | "createdAt">
  ): Promise<HouseholdInvitation> {
    const result = await db
      .insert(householdInvitations)
      .values(data)
      .returning();
    return result[0];
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

  /**
   * SCP-318: accept an invitation atomically. addMember + markInvitationAccepted
   * must be one unit, else two concurrent accepts of the same code can both add
   * the member unless the invitation is serialized; the database membership
   * constraint remains the final backstop. The invitation row is locked FOR
   * UPDATE and its acceptedAt re-checked under the lock, and a
   * duplicate-membership guard runs inside the same transaction.
   *
   * Membership-lifecycle race (Gap 2): the household row is locked FOR UPDATE
   * FIRST, as a stable serialization anchor against a concurrent sole-member
   * account erasure (which deletes this household). The invitation lock alone is
   * not enough: a sole-member erase would not contend on it in time, so the
   * joiner could be inserted into a household being deleted and then silently
   * cascade-removed (household_members.household_id is ON DELETE CASCADE).
   * eraseAccount takes the same household lock, so the two fully serialize.
   * Parent-first lock order (household → invitation → member) is deadlock-safe.
   */
  async acceptInvite(
    invitationId: string,
    householdId: string,
    userId: string,
    role: HouseholdRole
  ): Promise<void> {
    await withTransaction(async (tx) => {
      const [householdRow] = await tx
        .select({ id: households.id })
        .from(households)
        .where(eq(households.id, householdId))
        .for("update")
        .limit(1);
      if (!householdRow) {
        throw new NotFoundError("Household no longer exists");
      }

      const [locked] = await tx
        .select()
        .from(householdInvitations)
        .where(eq(householdInvitations.id, invitationId))
        .for("update")
        .limit(1);

      if (!locked) {
        throw new NotFoundError("Invitation not found or invalid code");
      }
      if (locked.acceptedAt) {
        throw new ConflictError("This invitation has already been used");
      }

      const existing = await tx
        .select()
        .from(householdMembers)
        .where(
          and(
            eq(householdMembers.householdId, householdId),
            eq(householdMembers.userId, userId)
          )
        )
        .for("update")
        .limit(1);
      if (existing[0]) {
        throw new ConflictError("You are already a member of this household");
      }

      await tx.insert(householdMembers).values({ householdId, userId, role });
      await tx
        .update(householdInvitations)
        .set({ acceptedAt: new Date(), acceptedBy: userId })
        .where(eq(householdInvitations.id, invitationId));
    });
  }

  /**
   * Update invitation expiry (for resending invites)
   */
  async updateInvitationExpiry(
    invitationId: string,
    householdId: string,
    newExpiresAt: Date
  ): Promise<HouseholdInvitation | undefined> {
    const result = await db
      .update(householdInvitations)
      .set({ expiresAt: newExpiresAt })
      .where(
        and(
          eq(householdInvitations.id, invitationId),
          eq(householdInvitations.householdId, householdId)
        )
      )
      .returning();
    return result[0];
  }
}

export const householdRepository = new HouseholdRepository();
