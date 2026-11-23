import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { accounts, auditLogs, investmentOpeningOperationReceipts, investmentTransactions, securities, taxLots, transactions,
  type Holding, type OpeningCreationSnapshot, type OpeningHoldingSnapshot } from "@shared/schema";
import { Money } from "../../core/money";
import { ConflictError, NotFoundError } from "../../core/errors";
import { visibleInvestmentTransactionPredicate } from "../../core/authz/investment-visibility";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { getPostgresError } from "../../utils/postgresError";
import { lockInvestmentTransactionSources, type InvestmentSourceSession } from "./investmentTransactionAccess";
import { createHoldingSchema, type CreateHoldingInput } from "./investments.validation";

const unavailable = () => new ConflictError("Opening operation sources are unavailable");
/** Purchase and lot rates are stored at 8 places (0041), the holding's too
 * since 0047; a receipt written before 0047 holds the 4-place form. */
function sameRate(stored: string | null, declared: string | null) {
  return stored === null || declared === null ? stored === declared : new Money(stored).amount.eq(new Money(declared).amount);
}
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const quantity = z.string().regex(/^(?:0|[1-9]\d{0,9})\.\d{8}$/);
const money = z.string().regex(/^(?:0|[1-9]\d{0,12})\.\d{2}$/).nullable();
const rate = z.string().regex(/^(?:0|[1-9]\d{0,5})\.(?:\d{4}|\d{8})$/).nullable();
/** A rate with at most 4 places keeps its pre-0047 digest form, so every
 * existing receipt's digest is unchanged; only a finer rate uses 8 places. */
function digestRate(value: string) {
  const rate = new Money(value).amount;
  return rate.toFixed(rate.decimalPlaces() <= 4 ? 4 : 8);
}
const timestamp = z.string().datetime().refine(value => {
  try { return new Date(value).toISOString() === value; } catch { return false; }
}).nullable();
const snapshotSchema = z.object({ version: z.literal(1), purchaseId: uuid.nullable(), lotId: uuid.nullable(), holding: z.object({
  id: uuid, householdId: uuid, accountId: uuid, securityId: uuid, quantity, costBasis: money, costBasisZmw: money,
  acquiredDate: z.string(), acquisitionFxRate: rate, createdAt: timestamp, updatedAt: timestamp,
}).strict() }).strict();

export function openingRequestDigest(data: CreateHoldingInput) {
  const currency = data.expectedCurrency.toUpperCase();
  const cost = data.costBasis === null ? null : new Money(data.costBasis).toString();
  const declaredBase = data.costBasisZmw == null ? null : new Money(data.costBasisZmw).toString();
  // Omitted ZMW base is known from native identity. Preserve an explicit
  // different base in intent so an invalid changed retry cannot be acknowledged.
  const base = currency === "ZMW" && cost !== null && declaredBase === null ? cost : declaredBase;
  return createHash("sha256").update(JSON.stringify({ version: 1, accountId: data.accountId.toLowerCase(), securityId: data.securityId.toLowerCase(),
    expectedCurrency: currency, quantity: new Money(data.quantity).amount.toFixed(8),
    costBasis: cost, acquiredDate: data.acquiredDate, costBasisZmw: base,
    acquisitionFxRate: data.acquisitionFxRate == null ? null : digestRate(data.acquisitionFxRate),
  })).digest("hex");
}
export function openingCreationSnapshot(holding: Holding, purchaseId: string | null, lotId: string | null): OpeningCreationSnapshot {
  return { version: 1, holding: { id: holding.id, householdId: holding.householdId, accountId: holding.accountId, securityId: holding.securityId,
    quantity: holding.quantity, costBasis: holding.costBasis, costBasisZmw: holding.costBasisZmw, acquiredDate: holding.acquiredDate,
    acquisitionFxRate: holding.acquisitionFxRate, createdAt: holding.createdAt?.toISOString() ?? null, updatedAt: holding.updatedAt?.toISOString() ?? null }, purchaseId, lotId };
}
function responseHolding(row: OpeningHoldingSnapshot): Holding {
  return { id: row.id, householdId: row.householdId, accountId: row.accountId, securityId: row.securityId, quantity: row.quantity,
    costBasis: row.costBasis, costBasisZmw: row.costBasisZmw, acquiredDate: row.acquiredDate, acquisitionFxRate: row.acquisitionFxRate,
    createdAt: row.createdAt === null ? null : new Date(row.createdAt), updatedAt: row.updatedAt === null ? null : new Date(row.updatedAt) };
}
export function validatedOpeningCreationSnapshot(receipt: typeof investmentOpeningOperationReceipts.$inferSelect) {
  const parsed = snapshotSchema.safeParse(receipt.creationSnapshot);
  if (!parsed.success || receipt.requestVersion !== 1) throw unavailable();
  const original = parsed.data, holding = original.holding;
  const intent = createHoldingSchema.safeParse({ operationId: receipt.operationId, expectedCurrency: receipt.currency,
    accountId: holding.accountId, securityId: holding.securityId, quantity: holding.quantity, costBasis: holding.costBasis,
    costBasisZmw: holding.costBasisZmw, acquiredDate: holding.acquiredDate, acquisitionFxRate: holding.acquisitionFxRate });
  if (!intent.success || holding.id !== receipt.holdingId || holding.householdId !== receipt.householdId || holding.createdAt !== holding.updatedAt ||
    receipt.requestDigest !== openingRequestDigest(intent.data)) throw unavailable();
  const positive = !new Money(holding.quantity).isZero();
  if ((original.purchaseId !== null) !== positive || (original.lotId !== null) !== positive) throw unavailable();
  return original;
}

/** Replay witnesses only the original creation. Later peer purchases, cash
 * withdrawals and disposals must not govern acknowledgment of this operation. */
export async function replayOpeningOperation(tx: TransactionType, actor: HouseholdContext, data: CreateHoldingInput, session: InvestmentSourceSession): Promise<Holding | null> {
  const [receipt] = await tx.select().from(investmentOpeningOperationReceipts).where(and(
    eq(investmentOpeningOperationReceipts.householdId, actor.householdId), eq(investmentOpeningOperationReceipts.actorUserId, actor.userId),
    eq(investmentOpeningOperationReceipts.operationId, data.operationId),
  ));
  if (!receipt) return null;
  const original = validatedOpeningCreationSnapshot(receipt), declared = original.holding;
  try {
    const source = await lockInvestmentTransactionSources(tx, actor, { accountId: declared.accountId, securityId: declared.securityId, holdingId: receipt.holdingId }, session);
    if (!source.holding || (source.holding.createdAt?.toISOString() ?? null) !== declared.createdAt) throw unavailable();
    const [security] = await tx.select({ currency: securities.currency }).from(securities).where(eq(securities.id, declared.securityId));
    if (!security || security.currency !== receipt.currency) throw unavailable();
    const origins = await tx.select({ details: auditLogs.details }).from(auditLogs).where(and(
      eq(auditLogs.entityId, receipt.holdingId), eq(auditLogs.entityType, "holding"), eq(auditLogs.action, "CREATE"),
      eq(auditLogs.userId, actor.userId), isNull(auditLogs.householdId),
    )).for("share", { noWait: true });
    const details = origins.length === 1 ? origins[0].details as Record<string, unknown> : null;
    const creation = details?.newValue as Record<string, unknown> | undefined;
    if (!details || details.openingBasis !== "declared_record_only_v1" || details.openingOperationId !== receipt.operationId ||
      details.openingPurchaseId !== original.purchaseId || details.taxLotId !== original.lotId || creation?.currency !== receipt.currency ||
      !["accountId", "securityId", "quantity", "costBasis", "costBasisZmw", "acquiredDate", "acquisitionFxRate"]
        .every(key => creation?.[key] === declared[key as keyof typeof declared])) throw unavailable();
    if (original.purchaseId !== null && original.lotId !== null) {
      const [purchase] = await tx.select().from(investmentTransactions).where(eq(investmentTransactions.id, original.purchaseId)).for("share", { noWait: true });
      // Remaining quantity and later disposal state are intentionally outside
      // this original acquisition witness and outside the replay response.
      const [lot] = await tx.select({ id: taxLots.id, householdId: taxLots.householdId, holdingId: taxLots.holdingId, transactionId: taxLots.transactionId,
        quantity: taxLots.quantity, costBasis: taxLots.costBasis, costBasisZmw: taxLots.costBasisZmw,
        acquiredDate: taxLots.acquiredDate, acquisitionFxRate: taxLots.acquisitionFxRate }).from(taxLots).where(eq(taxLots.id, original.lotId)).for("share", { noWait: true });
      if (!purchase || !lot || purchase.householdId !== actor.householdId || purchase.holdingId !== receipt.holdingId || purchase.accountId !== declared.accountId ||
        purchase.securityId !== declared.securityId || purchase.type !== "buy" || purchase.currency !== receipt.currency ||
        purchase.quantity !== declared.quantity || purchase.amount !== declared.costBasis || purchase.amountZmw !== declared.costBasisZmw ||
        !sameRate(purchase.fxRate, declared.acquisitionFxRate) || purchase.transactionDate !== declared.acquiredDate ||
        lot.transactionId !== purchase.id || lot.holdingId !== receipt.holdingId || lot.householdId !== actor.householdId ||
        lot.quantity !== declared.quantity || lot.costBasis !== declared.costBasis || lot.costBasisZmw !== declared.costBasisZmw ||
        lot.acquiredDate !== declared.acquiredDate || !sameRate(lot.acquisitionFxRate, declared.acquisitionFxRate)) throw unavailable();
      if (purchase.linkedTransactionId) {
        const [cash] = await tx.select().from(transactions).where(and(eq(transactions.id, purchase.linkedTransactionId), visibleTransactionPredicate(source.actor))).for("share", { noWait: true });
        if (!cash || cash.currency !== receipt.currency) throw unavailable();
        const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, cash.accountId), visibleAccountPredicate(source.actor))).for("share", { noWait: true });
        if (!account) throw unavailable();
      }
      const [visible] = await tx.select({ id: investmentTransactions.id }).from(investmentTransactions)
        .where(and(eq(investmentTransactions.id, purchase.id), visibleInvestmentTransactionPredicate(source.actor)));
      if (!visible) throw unavailable();
    }
  } catch (error) {
    if (["55P03", "40P01", "40001"].includes(getPostgresError(error)?.code ?? "")) throw unavailable();
    if (error instanceof NotFoundError && error.message !== "Account not found") throw unavailable();
    throw error;
  }
  if (receipt.requestDigest !== openingRequestDigest(data)) throw new ConflictError("Opening operation does not match its original declaration");
  return responseHolding(original.holding);
}
