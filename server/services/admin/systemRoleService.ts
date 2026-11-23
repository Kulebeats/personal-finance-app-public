import { and, eq } from "drizzle-orm";
import { securityAuditLogs, systemRoles, userSystemRoles, users } from "@shared/schema";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { AuditEventType } from "../AuditService";

/**
 * System role grant and revoke (super_admin only), NEW-32 / F4.
 *
 * Each change and its security audit row commit in one transaction, so a role
 * can never change without a ROLE_ASSIGNED or ROLE_REMOVED row naming the
 * actor, the target and the role. The target user row is locked first so two
 * concurrent changes to one user apply in order. A request that changes
 * nothing (a role already held) writes nothing and is not audited.
 */
export interface RoleChangeRequest {
  readonly actorUserId: string;
  readonly targetUserId: string;
  readonly roleId: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export type RoleGrantResult =
  | { readonly kind: "user_not_found" }
  | { readonly kind: "role_not_found" }
  | { readonly kind: "granted" | "already_held"; readonly roleName: string };

export type RoleRevokeResult =
  | { readonly kind: "not_assigned" }
  | { readonly kind: "revoked"; readonly roleName: string };

async function auditRoleChange(
  tx: TransactionType, eventType: AuditEventType, request: RoleChangeRequest, roleName: string,
): Promise<void> {
  await tx.insert(securityAuditLogs).values({
    eventType,
    userId: request.actorUserId,
    targetUserId: request.targetUserId,
    ipAddress: request.ipAddress,
    userAgent: request.userAgent,
    details: { roleId: request.roleId, roleName },
  });
}

async function lockTarget(tx: TransactionType, userId: string): Promise<boolean> {
  const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  return user !== undefined;
}

async function findRoleName(tx: TransactionType, roleId: string): Promise<string | undefined> {
  const [role] = await tx.select({ name: systemRoles.name }).from(systemRoles).where(eq(systemRoles.id, roleId)).limit(1);
  return role?.name;
}

export async function grantSystemRole(request: RoleChangeRequest): Promise<RoleGrantResult> {
  return withTransaction(async (tx) => {
    if (!await lockTarget(tx, request.targetUserId)) return { kind: "user_not_found" };
    const roleName = await findRoleName(tx, request.roleId);
    if (roleName === undefined) return { kind: "role_not_found" };
    const inserted = await tx.insert(userSystemRoles).values({
      userId: request.targetUserId, roleId: request.roleId, grantedBy: request.actorUserId,
    }).onConflictDoNothing().returning({ id: userSystemRoles.id });
    if (inserted.length === 0) return { kind: "already_held", roleName };
    await auditRoleChange(tx, AuditEventType.ROLE_ASSIGNED, request, roleName);
    return { kind: "granted", roleName };
  });
}

/** Removes exactly the named role; the user's other roles are untouched. */
export async function revokeSystemRole(request: RoleChangeRequest): Promise<RoleRevokeResult> {
  return withTransaction(async (tx) => {
    if (!await lockTarget(tx, request.targetUserId)) return { kind: "not_assigned" };
    const deleted = await tx.delete(userSystemRoles).where(and(
      eq(userSystemRoles.userId, request.targetUserId), eq(userSystemRoles.roleId, request.roleId),
    )).returning({ id: userSystemRoles.id });
    if (deleted.length === 0) return { kind: "not_assigned" };
    const roleName = (await findRoleName(tx, request.roleId)) ?? "unknown";
    await auditRoleChange(tx, AuditEventType.ROLE_REMOVED, request, roleName);
    return { kind: "revoked", roleName };
  });
}
