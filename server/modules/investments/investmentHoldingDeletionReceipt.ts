import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, investmentHoldingDeletionReceipts, type Holding } from "@shared/schema";
import { ConflictError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { Money } from "../../core/money";

export const deletionUnavailable = () => new ConflictError("Review this holding's history before attempting deletion");
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().datetime().refine(value => {
  try { return new Date(value).toISOString() === value; } catch { return false; }
}).nullable();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  try { return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value; } catch { return false; }
}).nullable();
// 4 places before 0047 widened holdings.acquisition_fx_rate, 8 after.
const rate = z.string().regex(/^(?:0|[1-9]\d{0,5})\.(?:\d{4}|\d{8})$/).refine(value => new Money(value).gt(0)).nullable();
export const zeroHoldingDeletionSchema = z.object({ id: uuid, householdId: uuid, accountId: uuid, securityId: uuid,
  quantity: z.literal("0.00000000"), costBasis: z.literal("0.00").nullable(), costBasisZmw: z.literal("0.00").nullable(),
  acquiredDate: date, acquisitionFxRate: rate, createdAt: timestamp, updatedAt: timestamp }).strict();
const detailsSchema = z.object({ oldValue: zeroHoldingDeletionSchema, holdingDeletion: z.object({ version: z.literal(1),
  householdId: uuid, requestDigest: hash, originalCreateAuditId: uuid.nullable() }).strict() }).strict();
type DeletionDetails = z.infer<typeof detailsSchema>;
type Receipt = typeof investmentHoldingDeletionReceipts.$inferSelect;

/** A holding UUID denotes this immutable resource generation. No financial
 * request body, client operation UUID or original session is part of DELETE. */
export function holdingDeletionRequestDigest(householdId: string, actorUserId: string, holdingId: string) {
  return createHash("sha256").update(JSON.stringify({ version: 1, householdId, actorUserId, verb: "DELETE", holdingId: holdingId.toLowerCase() })).digest("hex");
}
function effectDigest(actorUserId: string, deleteAuditId: string, details: DeletionDetails) {
  // The strict parser fixes property order and preserves unknown versus zero.
  // Its immutable digest makes general-purpose mutable audits only a witness,
  // never independent authority for a replayed acknowledgement.
  return createHash("sha256").update(JSON.stringify({ version: 1, householdId: details.holdingDeletion.householdId,
    actorUserId, verb: "DELETE", holding: details.oldValue, originalCreateAuditId: details.holdingDeletion.originalCreateAuditId, deleteAuditId })).digest("hex");
}
export function holdingDeletionEvidence(holding: Holding, actor: HouseholdContext, originalCreateAuditId: string | null, deleteAuditId: string) {
  const requestDigest = holdingDeletionRequestDigest(actor.householdId, actor.userId, holding.id);
  const parsed = detailsSchema.safeParse({ oldValue: { id: holding.id, householdId: holding.householdId,
    accountId: holding.accountId, securityId: holding.securityId, quantity: holding.quantity, costBasis: holding.costBasis,
    costBasisZmw: holding.costBasisZmw, acquiredDate: holding.acquiredDate, acquisitionFxRate: holding.acquisitionFxRate,
    createdAt: holding.createdAt?.toISOString() ?? null, updatedAt: holding.updatedAt?.toISOString() ?? null },
    holdingDeletion: { version: 1, householdId: actor.householdId, requestDigest, originalCreateAuditId } });
  if (!parsed.success || (parsed.data.oldValue.createdAt === null && originalCreateAuditId === null)) throw deletionUnavailable();
  return { details: parsed.data, requestDigest, effectDigest: effectDigest(actor.userId, deleteAuditId, parsed.data) };
}
export async function findHoldingDeletionReceipt(tx: TransactionType, actor: HouseholdContext, holdingId: string) {
  const [receipt] = await tx.select().from(investmentHoldingDeletionReceipts).where(and(
    eq(investmentHoldingDeletionReceipts.householdId, actor.householdId), eq(investmentHoldingDeletionReceipts.actorUserId, actor.userId),
    eq(investmentHoldingDeletionReceipts.holdingId, holdingId),
  )).for("share"); return receipt;
}
/** The caller must lock CURRENT identity and ORIGINAL custody before entering.
 * Validation returns no historical financial DTO and performs no write. */
export async function validateHoldingDeletionReceipt(tx: TransactionType, receipt: Receipt, actor: HouseholdContext, holdingId: string) {
  if (receipt.requestVersion !== 1 || receipt.householdId !== actor.householdId || receipt.actorUserId !== actor.userId || receipt.holdingId !== holdingId ||
    receipt.requestDigest !== holdingDeletionRequestDigest(actor.householdId, actor.userId, holdingId) || !hash.safeParse(receipt.effectDigest).success) throw deletionUnavailable();
  const [audit] = await tx.select().from(auditLogs).where(eq(auditLogs.id, receipt.deleteAuditId)).for("share", { noWait: true });
  const parsed = detailsSchema.safeParse(audit?.details);
  if (!audit || audit.userId !== actor.userId || audit.householdId !== null || audit.entityType !== "holding" || audit.entityId !== holdingId ||
    audit.action !== "DELETE" || !parsed.success || !isDeepStrictEqual(parsed.data, audit.details)) throw deletionUnavailable();
  const details = parsed.data, old = details.oldValue;
  if (old.id !== holdingId || old.householdId !== actor.householdId || old.accountId !== receipt.accountId || old.securityId !== receipt.securityId ||
    details.holdingDeletion.householdId !== actor.householdId || details.holdingDeletion.requestDigest !== receipt.requestDigest ||
    (old.createdAt === null && details.holdingDeletion.originalCreateAuditId === null) || effectDigest(actor.userId, audit.id, details) !== receipt.effectDigest) throw deletionUnavailable();
}
