import { and, eq, isNull, sql } from "drizzle-orm";
import { householdMembers, users, type User } from "@shared/schema";
import { can } from "../../core/authz/capabilities";
import { ForbiddenError, UnauthorizedError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { lockCurrentSessionCredential } from "../../services/session-identity";
import type { TransactionType } from "../../utils/withTransaction";

export interface InvestmentReadSession {
  snapshot: User;
  sessionId: string;
  generation?: number;
}

export function requireInvestmentReadContext(caller: HouseholdContext, session: InvestmentReadSession) {
  if (!caller?.householdId || !caller.userId) throw new ForbiddenError("Financial read access required");
  if (session?.snapshot?.id !== caller.userId || !session.sessionId) throw new UnauthorizedError("Authentication changed; sign in again");
}

/** Shared accepted read order: current membership -> credential -> persisted SID. */
export async function lockInvestmentReadActor(
  tx: TransactionType,
  caller: HouseholdContext,
  session: InvestmentReadSession,
): Promise<HouseholdContext> {
  // Do not trust the role or identity status captured by HTTP middleware.
  // This check also runs for an empty result, when no custody row can gate it.
  const [grant] = await tx.select({ role: householdMembers.role })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(and(
      eq(householdMembers.householdId, caller.householdId),
      eq(householdMembers.userId, caller.userId),
      isNull(users.erasedAt),
      eq(users.emailVerified, true),
    )).for("share", { of: householdMembers });
  if (!grant || !can(grant.role, "financial.read")) throw new ForbiddenError("Financial read access required");
  const actor = { ...caller, role: grant.role };

  // Match the existing export authority order: membership -> credential ->
  // actual persisted SID. These locks belong only to this short source cut.
  const currentUser = await lockCurrentSessionCredential(tx, session.snapshot, session.sessionId, session.generation);
  if (!currentUser.emailVerified) throw new ForbiddenError("Financial read access required");
  // A selected-device revoke need not change the user tuple. Locking its SID
  // validates the current payload while harmless expiry touches stay valid.
  const liveSession = await tx.execute(sql`select sid from "session" where sid = ${session.sessionId} and expire >= now()
    and sess->>'userId' = ${currentUser.id} and coalesce(sess->>'securityGeneration', '0') = ${String(currentUser.securityGeneration)} for share`);
  if (liveSession.rows.length !== 1) throw new UnauthorizedError("Authentication changed; sign in again");
  return actor;
}
