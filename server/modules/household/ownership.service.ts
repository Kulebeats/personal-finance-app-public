/**
 * Household ownership and member-role changes (NEW-12, R03.2).
 *
 * Invariant: a household always has exactly one owner. Every operation here
 * that can change who the owner is, or who is a member, runs in one
 * transaction that:
 *   1. locks the household row FOR UPDATE (the same parent-first anchor that
 *      acceptInvite and account erasure take, so they all serialise);
 *   2. locks every member row FOR UPDATE, ordered by userId;
 *   3. re-checks the actor's role and the target under those locks;
 *   4. writes the change and its audit row through the same transaction.
 * The partial unique index household_members_one_owner (migration 0031) is
 * the database backstop: a second owner row cannot be written at all.
 *
 * Rules:
 *   - Only the owner transfers ownership, never to themselves, and only to a
 *     current member of the household (400 otherwise).
 *   - A role change never assigns "owner" (409: use transfer) and never
 *     changes the owner's role (403).
 *   - Granting or removing admin is owner-only; an admin manages member,
 *     view-only and Professional only (spec §A3; 403 otherwise).
 *   - The owner cannot be removed (403) and cannot leave (403) until they
 *     have transferred ownership.
 *   - A member who owns a live private account cannot leave or be removed (409).
 *
 * @module modules/household/ownership.service
 */

import { and, eq, isNull } from "drizzle-orm";
import { accounts, householdMembers, households } from "@shared/schema";
import { deleteUserSubscriptions } from "../../services/notification/push-subscriptions";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../../services/BusinessAuditService";
import {
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  ValidationError,
} from "../../core/errors";

type MemberRow = typeof householdMembers.$inferSelect;
export type HouseholdRole = MemberRow["role"];

const MANAGER_ROLES: readonly HouseholdRole[] = ["owner", "admin"];
const ADMIN_GRANT_MESSAGE = "Only the owner can grant or remove admin";

/** Who is acting, on which household, from where. */
export interface OwnershipActor {
  householdId: string;
  actorUserId: string;
  ipAddress?: string;
}

interface LockedHousehold {
  actor: MemberRow;
  members: MemberRow[];
}

/**
 * Lock the household row, then every member row (userId order), and return
 * the acting member. Throws 404 when the household or the actor's membership
 * is gone by the time the locks are held.
 */
async function lockHousehold(
  tx: TransactionType,
  householdId: string,
  actorUserId: string,
): Promise<LockedHousehold> {
  const [householdRow] = await tx
    .select({ id: households.id })
    .from(households)
    .where(eq(households.id, householdId))
    .for("update")
    .limit(1);
  if (!householdRow) {
    throw new NotFoundError("Household");
  }

  const members = await tx
    .select()
    .from(householdMembers)
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(householdMembers.userId)
    .for("update");

  const actor = members.find((m) => m.userId === actorUserId);
  if (!actor) {
    throw new NotFoundError("Household membership");
  }
  return { actor, members };
}

function memberWhere(householdId: string, userId: string) {
  return and(
    eq(householdMembers.householdId, householdId),
    eq(householdMembers.userId, userId),
  );
}

class PrivateAccountsPreventDeparture extends HttpError {
  readonly statusCode = 409;
  readonly code: string;

  constructor(departure: "leave" | "remove") {
    super(departure === "leave"
      ? "Resolve your private accounts before leaving this household. Share or transfer them where account controls allow it, or delete them."
      : "This member must resolve their private accounts before they can be removed.");
    this.code = departure === "leave" ? "PRIVATE_ACCOUNTS_PREVENT_LEAVING" : "PRIVATE_ACCOUNTS_PREVENT_REMOVAL";
  }
}

async function requireNoPrivateAccounts(
  tx: TransactionType, householdId: string, userId: string, departure: "leave" | "remove",
): Promise<void> {
  // The household and memberships are already locked, in account-writer order.
  // Account creation and custody changes must take those locks before writing.
  const privateAccounts = await tx.select({ id: accounts.id }).from(accounts).where(and(
    eq(accounts.householdId, householdId),
    eq(accounts.ownerUserId, userId),
    eq(accounts.isPrivate, true),
    isNull(accounts.deletedAt),
  )).orderBy(accounts.id).for("update");
  if (privateAccounts.length > 0) throw new PrivateAccountsPreventDeparture(departure);
}

async function setRole(
  tx: TransactionType,
  householdId: string,
  userId: string,
  role: HouseholdRole,
): Promise<MemberRow> {
  const [updated] = await tx
    .update(householdMembers)
    .set({ role })
    .where(memberWhere(householdId, userId))
    .returning();
  return updated;
}

function requireManager(actor: MemberRow, message: string): void {
  if (!MANAGER_ROLES.includes(actor.role)) {
    throw new ForbiddenError(message);
  }
}

/**
 * Spec §A3 capability table: an admin may manage member, view-only and
 * Professional only; granting or removing admin is owner-only. So an admin
 * actor may not touch an admin target, nor make anyone an admin.
 */
function requireAdminCapability(
  actor: MemberRow,
  target: MemberRow,
  newRole?: HouseholdRole,
): void {
  if (actor.role !== "owner" && target.role === "admin") {
    throw new ForbiddenError(ADMIN_GRANT_MESSAGE);
  }
  if (newRole) {
    assertMayGrantRole(actor.role, newRole);
  }
}

/**
 * Granting admin is owner-only (spec §A3), whether by role change or by
 * invitation. Invitation acceptance re-checks the inviter under the household
 * lock (HouseholdRepository.acceptInvite).
 */
export function assertMayGrantRole(actorRole: HouseholdRole, newRole: HouseholdRole): void {
  if (actorRole !== "owner" && newRole === "admin") {
    throw new ForbiddenError(ADMIN_GRANT_MESSAGE);
  }
}

function findTarget(members: MemberRow[], targetUserId: string): MemberRow {
  const target = members.find((m) => m.userId === targetUserId);
  if (!target) {
    throw new NotFoundError("Member");
  }
  return target;
}

export async function transferOwnership(
  ctx: OwnershipActor,
  newOwnerId: string,
): Promise<void> {
  if (newOwnerId === ctx.actorUserId) {
    throw new ValidationError("You already own this household", [
      { field: "newOwnerId", message: "Choose another member of the household" },
    ]);
  }

  await withTransaction(async (tx) => {
    const { actor, members } = await lockHousehold(tx, ctx.householdId, ctx.actorUserId);
    if (actor.role !== "owner") {
      throw new ForbiddenError("Only the owner can transfer ownership");
    }
    if (!members.some((m) => m.userId === newOwnerId)) {
      throw new ValidationError("The new owner must be a member of this household", [
        { field: "newOwnerId", message: "Not a member of this household" },
      ]);
    }

    // Demote first: the one-owner index is checked row by row, so promoting
    // first would briefly hold two owner rows and be refused.
    await setRole(tx, ctx.householdId, ctx.actorUserId, "admin");
    await setRole(tx, ctx.householdId, newOwnerId, "owner");

    await businessAuditService.log({
      tx,
      householdId: ctx.householdId,
      userId: ctx.actorUserId,
      action: "TRANSFER",
      entityType: "user",
      entityId: newOwnerId,
      details: {
        action: "ownership_transfer",
        fromUserId: ctx.actorUserId,
        toUserId: newOwnerId,
        previousRoleOfNewOwner: findTarget(members, newOwnerId).role,
      },
      ipAddress: ctx.ipAddress,
    });
  });
}

export async function changeMemberRole(
  ctx: OwnershipActor,
  targetUserId: string,
  role: HouseholdRole,
): Promise<MemberRow> {
  if (targetUserId === ctx.actorUserId) {
    throw new ValidationError("Cannot modify your own role");
  }
  if (role === "owner") {
    throw new ConflictError(
      "A household has exactly one owner. Use transfer ownership instead.",
    );
  }

  return await withTransaction(async (tx) => {
    const { actor, members } = await lockHousehold(tx, ctx.householdId, ctx.actorUserId);
    requireManager(actor, "Only owners and admins can change member roles");
    const target = findTarget(members, targetUserId);
    if (target.role === "owner") {
      throw new ForbiddenError(
        "The owner's role cannot be changed. The owner must transfer ownership first.",
      );
    }
    requireAdminCapability(actor, target, role);

    const updated = await setRole(tx, ctx.householdId, targetUserId, role);
    await businessAuditService.logUpdate({
      tx,
      householdId: ctx.householdId,
      userId: ctx.actorUserId,
      entityType: "user",
      entityId: targetUserId,
      oldValue: { role: target.role },
      newValue: { role },
      ipAddress: ctx.ipAddress,
      metadata: { action: "role_change" },
    });
    return updated;
  });
}

export async function removeMember(
  ctx: OwnershipActor,
  targetUserId: string,
): Promise<void> {
  if (targetUserId === ctx.actorUserId) {
    throw new ValidationError("Cannot remove yourself");
  }

  await withTransaction(async (tx) => {
    const { actor, members } = await lockHousehold(tx, ctx.householdId, ctx.actorUserId);
    requireManager(actor, "Only owners and admins can remove members");
    const target = findTarget(members, targetUserId);
    if (target.role === "owner") {
      throw new ForbiddenError(
        "The owner cannot be removed. The owner must transfer ownership first.",
      );
    }
    requireAdminCapability(actor, target);

    await requireNoPrivateAccounts(tx, ctx.householdId, targetUserId, "remove");
    await tx.delete(householdMembers).where(memberWhere(ctx.householdId, targetUserId));
    await endPushWithLastMembership(tx, targetUserId);
    await businessAuditService.logDelete({
      tx,
      householdId: ctx.householdId,
      userId: ctx.actorUserId,
      entityType: "user",
      entityId: targetUserId,
      oldValue: { role: target.role },
      ipAddress: ctx.ipAddress,
      metadata: { action: "member_removed" },
    });
  });
}

export async function leaveHousehold(ctx: OwnershipActor): Promise<void> {
  await withTransaction(async (tx) => {
    const { actor } = await lockHousehold(tx, ctx.householdId, ctx.actorUserId);
    if (actor.role === "owner") {
      throw new ForbiddenError(
        "Owner must transfer ownership before leaving household",
      );
    }

    await requireNoPrivateAccounts(tx, ctx.householdId, ctx.actorUserId, "leave");
    await tx.delete(householdMembers).where(memberWhere(ctx.householdId, ctx.actorUserId));
    await endPushWithLastMembership(tx, ctx.actorUserId);
    await businessAuditService.log({
      tx,
      householdId: ctx.householdId,
      userId: ctx.actorUserId,
      action: "DELETE",
      entityType: "user",
      entityId: ctx.actorUserId,
      details: { action: "self_removal", role: actor.role },
      ipAddress: ctx.ipAddress,
    });
  });
}

/** A user with no household left gets no more pushes: every subscription goes. */
async function endPushWithLastMembership(tx: TransactionType, userId: string): Promise<void> {
  const [remaining] = await tx.select({ id: householdMembers.id }).from(householdMembers)
    .where(eq(householdMembers.userId, userId)).limit(1);
  if (!remaining) await deleteUserSubscriptions(tx, userId);
}
