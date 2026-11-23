import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, holdings, investmentHoldingDeletionReceipts, securities } from "@shared/schema";
import { NotFoundError, UnauthorizedError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { getPostgresError } from "../../utils/postgresError";
import { withTransaction } from "../../utils/withTransaction";
import { lockInvestmentTransactionSources, lockInvestmentWriterIdentity, type InvestmentSourceSession } from "./investmentTransactionAccess";
import { lockDeletableHoldingHistory, lockHoldingDeletionSourceVisibility } from "./investmentHoldingDeletionHistory";
import { deletionUnavailable, findHoldingDeletionReceipt, holdingDeletionEvidence, validateHoldingDeletionReceipt } from "./investmentHoldingDeletionReceipt";

/** DELETE is a zero-shell lifecycle operation. The live actor/SID, custody,
 * original generation, history, private audit and durable acknowledgement
 * commit under one transaction; a retry never repeats the physical effect. */
export async function deleteAuthorizedHolding(resourceId: string, caller: HouseholdContext, ipAddress: string | undefined, session: InvestmentSourceSession): Promise<boolean> {
  if (session?.snapshot?.id !== caller?.userId || !session?.sessionId) throw new UnauthorizedError("Authentication changed; sign in again");
  try {
    return await withTransaction(async tx => {
      const actor = await lockInvestmentWriterIdentity(tx, caller, session);
      if (!z.string().uuid().safeParse(resourceId).success) throw new NotFoundError("Holding");
      const id = resourceId.toLowerCase();
      const receipt = await findHoldingDeletionReceipt(tx, actor, id);
      if (receipt) {
        // Reauthorize this request's current credentials and original custody.
        // It may come from another live device; the original SID is irrelevant.
        const original = await lockInvestmentTransactionSources(tx, actor, { accountId: receipt.accountId, securityId: receipt.securityId }, session);
        const [recreated] = await tx.select({ id: holdings.id, householdId: holdings.householdId, accountId: holdings.accountId, securityId: holdings.securityId })
          .from(holdings).where(eq(holdings.id, id));
        if (recreated) {
          if (recreated.householdId !== actor.householdId || recreated.accountId !== receipt.accountId || recreated.securityId !== receipt.securityId) throw new NotFoundError("Holding");
          // This is only a refusal, never a second physical delete. Inspect
          // current source visibility without taking a holding write lock
          // after the original account lock or exposing hidden history409.
          await lockHoldingDeletionSourceVisibility(tx, recreated, original.actor);
          throw deletionUnavailable();
        }
        await validateHoldingDeletionReceipt(tx, receipt, actor, id);
        return true;
      }
      const [hint] = await tx.select({ accountId: holdings.accountId, securityId: holdings.securityId }).from(holdings)
        .where(and(eq(holdings.id, id), eq(holdings.householdId, actor.householdId)));
      if (!hint) throw new NotFoundError("Holding");
      // The shared source helper checks visibility BEFORE acquiring the actual
      // holding UPDATE lock, then custody/instrument SHARE locks. Do not add an
      // unlocked controller read or a private holding pre-lock here.
      const source = await lockInvestmentTransactionSources(tx, actor, { ...hint, holdingId: id }, session);
      if (!source.holding) throw new NotFoundError("Holding");
      const [security] = await tx.select({ currency: securities.currency }).from(securities).where(eq(securities.id, source.holding.securityId));
      if (!security) throw new NotFoundError("Holding");
      const originalCreateAuditId = await lockDeletableHoldingHistory(tx, source.holding, security.currency, source.actor);
      const [priorEffect] = await tx.select({ holdingId: investmentHoldingDeletionReceipts.holdingId }).from(investmentHoldingDeletionReceipts)
        .where(and(eq(investmentHoldingDeletionReceipts.householdId, actor.householdId), eq(investmentHoldingDeletionReceipts.holdingId, id)));
      if (priorEffect) throw deletionUnavailable();
      const deleteAuditId = randomUUID(), evidence = holdingDeletionEvidence(source.holding, source.actor, originalCreateAuditId, deleteAuditId);
      await tx.insert(auditLogs).values({ id: deleteAuditId, householdId: null, userId: actor.userId, action: "DELETE",
        entityType: "holding", entityId: id, details: evidence.details, ipAddress: ipAddress ?? null });
      const deleted = await tx.delete(holdings).where(and(eq(holdings.id, id), eq(holdings.householdId, actor.householdId))).returning({ id: holdings.id });
      if (deleted.length !== 1) throw deletionUnavailable();
      await tx.insert(investmentHoldingDeletionReceipts).values({ householdId: actor.householdId, actorUserId: actor.userId, holdingId: id,
        accountId: source.holding.accountId, securityId: source.holding.securityId, requestVersion: 1, requestDigest: evidence.requestDigest,
        effectDigest: evidence.effectDigest, deleteAuditId });
      return true;
    });
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError("Holding");
    const pg = getPostgresError(error);
    if (pg && (["55P03", "40P01", "40001"].includes(pg.code) ||
      (pg.code === "23505" && pg.constraint?.startsWith("investment_holding_deletion_")))) throw deletionUnavailable();
    throw error;
  }
}
