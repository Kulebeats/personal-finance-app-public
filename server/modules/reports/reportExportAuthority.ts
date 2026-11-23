import { and, eq, sql } from "drizzle-orm";
import { householdMembers, type User } from "@shared/schema";
import { db } from "../../db";
import { can, isHouseholdRole, type HouseholdRole } from "../../core/authz/capabilities";
import { ForbiddenError, UnauthorizedError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { lockCurrentSessionCredential } from "../../services/session-identity";
import { getPostgresError } from "../../utils/postgresError";
import type { TransactionType } from "../../utils/withTransaction";

export interface TransactionCsvSession { snapshot: User; sessionId: string; generation?: number }

/** Membership -> credential -> persisted SID is the financial/erasure order.
 * A selected-device revoke can leave the user tuple unchanged; locking its
 * actual SID makes a deletion since the RR cut retry from fresh authority.
 */
export async function withReportExportAuthority<T>(actor: HouseholdContext, session: TransactionCsvSession,
  read: (tx: TransactionType, role: HouseholdRole) => Promise<T>): Promise<T> {
  if (session.snapshot.id !== actor.userId || !session.sessionId) throw new UnauthorizedError("Authentication changed; sign in again");
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async tx => {
        const [grant] = await tx.select({ role: householdMembers.role }).from(householdMembers).where(and(
          eq(householdMembers.householdId, actor.householdId), eq(householdMembers.userId, actor.userId),
        )).for("share");
        if (!grant || !isHouseholdRole(grant.role) || !can(grant.role, "financial.export")) throw new ForbiddenError("Report access unavailable");
        const currentUser = await lockCurrentSessionCredential(tx, session.snapshot, session.sessionId, session.generation);
        if (currentUser.emailVerified !== true) throw new ForbiddenError("Report access unavailable");
        const liveSession = await tx.execute(sql`select sid from "session" where sid = ${session.sessionId} and expire >= now()
          and sess->>'userId' = ${currentUser.id} and coalesce(sess->>'securityGeneration', '0') = ${String(currentUser.securityGeneration)} for share`);
        if (liveSession.rows.length !== 1) throw new UnauthorizedError("Authentication changed; sign in again");
        return read(tx, grant.role);
      }, { isolationLevel: "repeatable read" });
    } catch (error) {
      if (getPostgresError(error)?.code === "40001") {
        if (attempt < 2) continue;
        throw new Error("Transaction export sources changed. Retry the request.");
      }
      throw error;
    }
  }
}
