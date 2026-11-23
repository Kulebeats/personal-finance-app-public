import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { accounts, auditLogs, investmentOpeningOperationReceipts, investmentTransactions, taxLotDisposals, taxLots,
  transactions, type Holding } from "@shared/schema";
import { NotFoundError } from "../../core/errors";
import { Money } from "../../core/money";
import { visibleInvestmentTransactionPredicate } from "../../core/authz/investment-visibility";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { deletionUnavailable, zeroHoldingDeletionSchema } from "./investmentHoldingDeletionReceipt";
import { validatedOpeningCreationSnapshot } from "./investmentHoldingOpeningReceipt";
import { lockAuditedHoldingSources, readHoldingDeletionAudits } from "./investmentHoldingDeletionAudits";

const ids = (values: Array<string | null>) => Array.from(new Set(values.filter((value): value is string => value !== null))).sort();
const declarationSchema = zeroHoldingDeletionSchema.pick({ accountId: true, securityId: true, quantity: true, costBasis: true,
  costBasisZmw: true, acquiredDate: true, acquisitionFxRate: true }).extend({ currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
/** The holding's rate column became 8 places in 0047, so a CREATE audit or
 * receipt written before it holds "25.0000" where the live row now reads
 * "25.00000000". Compare the rate by value, never by its text. */
function byRate<T extends { acquisitionFxRate: string | null }>(value: T): T {
  return value.acquisitionFxRate === null ? value : { ...value, acquisitionFxRate: new Money(value.acquisitionFxRate).amount.toFixed(8) };
}
const originSchema = z.object({ newValue: declarationSchema, openingBasis: z.literal("declared_record_only_v1"),
  openingOperationId: z.string().uuid(), openingPurchaseId: z.null(), taxLotId: z.null(), cashMoved: z.literal(false) }).strict();

/** A destructive denial still reveals whether history exists. Check every
 * acquisition's actual cash audience before either aggregate or history409.
 * Visible-only NOWAIT locks preserve that decision without waiting on a
 * private source or inverting independent cash/account editor locks. */
async function visibleHistory(tx: TransactionType, holding: Pick<Holding, "id">, actor: HouseholdContext, auditedActivityIds: string[]) {
  const lots = await tx.select({ id: taxLots.id, transactionId: taxLots.transactionId }).from(taxLots).where(eq(taxLots.holdingId, holding.id));
  const disposals = await tx.select({ id: taxLotDisposals.id, transactionId: taxLotDisposals.transactionId }).from(taxLotDisposals).where(or(
    eq(taxLotDisposals.holdingId, holding.id), inArray(taxLotDisposals.taxLotId, ids(lots.map(row => row.id))),
  ));
  const activity = await tx.select({ id: investmentTransactions.id, householdId: investmentTransactions.householdId,
    accountId: investmentTransactions.accountId, linkedTransactionId: investmentTransactions.linkedTransactionId }).from(investmentTransactions).where(or(
    eq(investmentTransactions.holdingId, holding.id), inArray(investmentTransactions.id, ids([...lots.map(row => row.transactionId), ...disposals.map(row => row.transactionId), ...auditedActivityIds])),
  ));
  const localIds = ids(activity.filter(row => row.householdId === actor.householdId).map(row => row.id));
  if (localIds.length) {
    const visible = await tx.select({ id: investmentTransactions.id }).from(investmentTransactions).where(and(
      inArray(investmentTransactions.id, localIds), visibleInvestmentTransactionPredicate(actor),
    ));
    if (visible.length !== localIds.length) throw new NotFoundError("Holding");
    const cashIds = ids(activity.filter(row => row.householdId === actor.householdId).map(row => row.linkedTransactionId));
    const cash = await tx.select({ id: transactions.id, accountId: transactions.accountId }).from(transactions)
      .where(and(inArray(transactions.id, cashIds), visibleTransactionPredicate(actor)));
    if (cash.length !== cashIds.length) throw new NotFoundError("Holding");
    const accountIds = ids([...activity.filter(row => row.householdId === actor.householdId).map(row => row.accountId), ...cash.map(row => row.accountId)]);
    const lockedAccounts = await tx.select({ id: accounts.id }).from(accounts).where(and(inArray(accounts.id, accountIds), visibleAccountPredicate(actor)))
      .orderBy(accounts.id).for("share", { noWait: true });
    if (lockedAccounts.length !== accountIds.length) throw new NotFoundError("Holding");
    const lockedCash = await tx.select({ id: transactions.id }).from(transactions).where(and(inArray(transactions.id, cashIds), visibleTransactionPredicate(actor)))
      .orderBy(transactions.id).for("share", { noWait: true });
    if (lockedCash.length !== cashIds.length) throw new NotFoundError("Holding");
    const lockedActivity = await tx.select({ id: investmentTransactions.id }).from(investmentTransactions).where(and(
      inArray(investmentTransactions.id, localIds), visibleInvestmentTransactionPredicate(actor),
    )).orderBy(investmentTransactions.id).for("share", { noWait: true });
    if (lockedActivity.length !== localIds.length) throw new NotFoundError("Holding");
  }
  return lots.length > 0 || disposals.length > 0 || activity.length > 0;
}

export async function lockHoldingDeletionSourceVisibility(tx: TransactionType, holding: Pick<Holding, "id">, actor: HouseholdContext) {
  const frame = await readHoldingDeletionAudits(tx, holding.id);
  const unknownAuditSource = await lockAuditedHoldingSources(tx, frame, actor, holding.id);
  const auditedIds = frame.activity.map(row => row.entityId).filter((id): id is string => z.string().uuid().safeParse(id).success);
  const children = await visibleHistory(tx, holding, actor, auditedIds);
  if (unknownAuditSource) throw deletionUnavailable();
  return { ...frame, children };
}

export async function lockDeletableHoldingHistory(tx: TransactionType, holding: Holding, currency: string, actor: HouseholdContext) {
  const frame = await lockHoldingDeletionSourceVisibility(tx, holding, actor);
  if (frame.children || frame.activity.length) throw deletionUnavailable();
  if (!zeroHoldingDeletionSchema.safeParse({ ...holding, createdAt: holding.createdAt?.toISOString() ?? null,
    updatedAt: holding.updatedAt?.toISOString() ?? null }).success) throw deletionUnavailable();
  // Search by the immutable resource UUID, including corrupt cross-household
  // children and erased/other actors' historical evidence. Never delete them.
  const origins = await tx.select().from(auditLogs).where(and(eq(auditLogs.entityType, "holding"), eq(auditLogs.entityId, holding.id)))
    .orderBy(auditLogs.id).for("share", { noWait: true });
  if (await lockAuditedHoldingSources(tx, { origins, activity: [] }, actor, holding.id)) throw deletionUnavailable();
  if (origins.length > 1) throw deletionUnavailable();
  const declaration = { accountId: holding.accountId, securityId: holding.securityId, quantity: holding.quantity,
    costBasis: holding.costBasis, costBasisZmw: holding.costBasisZmw, acquiredDate: holding.acquiredDate,
    acquisitionFxRate: holding.acquisitionFxRate, currency };
  let originalCreateAuditId: string | null = null;
  if (origins.length) {
    const origin = origins[0], parsed = originSchema.safeParse(origin.details);
    if (origin.action !== "CREATE" || origin.householdId !== null || origin.userId === null || !parsed.success ||
      !isDeepStrictEqual(byRate(parsed.data.newValue), byRate(declaration))) throw deletionUnavailable();
    originalCreateAuditId = origin.id;
  }
  const openings = await tx.select().from(investmentOpeningOperationReceipts).where(eq(investmentOpeningOperationReceipts.holdingId, holding.id))
    .for("share", { noWait: true });
  for (const receipt of openings) {
    const original = validatedOpeningCreationSnapshot(receipt), prior = original.holding;
    if (receipt.householdId !== holding.householdId || receipt.currency !== currency || original.purchaseId !== null || original.lotId !== null ||
      !originalCreateAuditId || origins[0].userId !== receipt.actorUserId ||
      (origins[0].details as { openingOperationId?: unknown }).openingOperationId !== receipt.operationId ||
      !isDeepStrictEqual(byRate({ accountId: prior.accountId, securityId: prior.securityId, quantity: prior.quantity, costBasis: prior.costBasis,
        costBasisZmw: prior.costBasisZmw, acquiredDate: prior.acquiredDate, acquisitionFxRate: prior.acquisitionFxRate, currency: receipt.currency }), byRate(declaration)) ||
      prior.createdAt !== (holding.createdAt?.toISOString() ?? null) || prior.updatedAt !== (holding.updatedAt?.toISOString() ?? null)) throw deletionUnavailable();
  }
  return originalCreateAuditId;
}
