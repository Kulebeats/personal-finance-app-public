import { isDeepStrictEqual } from "node:util";
import Decimal from "decimal.js";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { auditLogs, investmentTransactions, taxLots, type Holding, type InvestmentTransaction, type TaxLot } from "@shared/schema";
import { lockHoldingRemainingBasis } from "../../modules/investments/investmentHoldingBasisSource";
import type { TransactionType } from "../../utils/withTransaction";

const Exact = Decimal.clone({ precision: 48 });
const unavailable = () => new Error("SIP acquisition evidence is unavailable");
type Audit = typeof auditLogs.$inferSelect;
interface Sources { purchases: InvestmentTransaction[]; lots: TaxLot[]; audits: Audit[] }
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
function equal(left: unknown, right: string | null) {
  if (left === null || right === null) return left === right;
  if (typeof left !== "string") return false;
  const a = new Exact(left), b = new Exact(right);
  return a.isFinite() && b.isFinite() && a.eq(b);
}
async function read(tx: TransactionType, holding: Holding): Promise<Sources> {
  const purchases = await tx.select().from(investmentTransactions).where(and(
    eq(investmentTransactions.holdingId, holding.id), eq(investmentTransactions.type, "buy"),
  )).orderBy(investmentTransactions.id);
  const lots = await tx.select().from(taxLots).where(eq(taxLots.holdingId, holding.id)).orderBy(taxLots.id);
  // Include surviving original BUY declarations even if a damaged row lost or
  // changed its binding. Audience and actor are evidence, never read authority.
  const audits = await tx.select().from(auditLogs).where(and(eq(auditLogs.action, "CREATE"), or(
    and(eq(auditLogs.entityType, "holding"), eq(auditLogs.entityId, holding.id)),
    and(eq(auditLogs.entityType, "investment_transaction"), or(
      inArray(auditLogs.entityId, purchases.map(row => row.id)),
      sql`${auditLogs.details}->'newValue'->>'holdingId'=${holding.id} and ${auditLogs.details}->'newValue'->>'type'='buy'`,
    )),
  ))).orderBy(auditLogs.id);
  return { purchases, lots, audits };
}
function purchaseAudit(source: Sources, purchase: InvestmentTransaction, holding: Holding, currency: string) {
  const rows = source.audits.filter(row => row.entityType === "investment_transaction" && row.entityId === purchase.id);
  const audit = rows[0], details = object(audit?.details), value = object(details?.newValue);
  if (rows.length !== 1 || !audit || !audit.userId || !details || !value ||
    (audit.householdId !== null && audit.householdId !== holding.householdId) ||
    value.type !== "buy" || value.accountId !== holding.accountId || value.accountId !== purchase.accountId ||
    value.holdingId !== holding.id || value.securityId !== holding.securityId || value.securityId !== purchase.securityId ||
    value.currency !== currency || value.transactionDate !== purchase.transactionDate ||
    !equal(value.quantity, purchase.quantity) || !equal(value.amount, purchase.amount) ||
    !equal(value.price, purchase.price) || !equal(value.fees, purchase.fees)) throw unavailable();
  // Manual BUY audits did not emit FX fields. When present, the genuine
  // declaration must still match the retained purchase; never replace either.
  if ((value.amountZmw !== undefined && !equal(value.amountZmw, purchase.amountZmw)) ||
    (value.fxRate !== undefined && !equal(value.fxRate, purchase.fxRate))) throw unavailable();
  return { audit, details, value };
}
function validate(source: Sources, holding: Holding, currency: string) {
  const acquiredDate = holding.acquiredDate;
  if (!acquiredDate || !source.purchases.length || source.purchases.some(row => row.transactionDate < acquiredDate)) throw unavailable();
  const originals = source.purchases.filter(row => row.transactionDate === acquiredDate);
  if (!originals.length || source.audits.filter(row => row.entityType === "investment_transaction").length !== source.purchases.length) throw unavailable();
  for (const purchase of source.purchases) purchaseAudit(source, purchase, holding, currency);
  const declarations = source.audits.filter(row => row.entityType === "holding");
  if (declarations.length > 1) throw unavailable();
  if (declarations.length) {
    const declaration = declarations[0], details = object(declaration.details), value = object(details?.newValue);
    const purchase = originals.find(row => row.id === details?.openingPurchaseId);
    const lot = purchase && source.lots.find(row => row.transactionId === purchase.id);
    if (!declaration.userId || declaration.householdId !== null || !details || !value || details.openingBasis !== "declared_record_only_v1" ||
      details.cashMoved !== false || typeof details.openingOperationId !== "string" || !details.openingOperationId ||
      value.accountId !== holding.accountId || value.securityId !== holding.securityId || value.currency !== currency ||
      value.acquiredDate !== holding.acquiredDate || !purchase || !lot || details.taxLotId !== lot.id ||
      !equal(value.quantity, purchase.quantity) || !equal(value.costBasis, purchase.amount) ||
      !equal(value.costBasisZmw, purchase.amountZmw) || !equal(value.acquisitionFxRate, purchase.fxRate)) throw unavailable();
    const original = purchaseAudit(source, purchase, holding, currency);
    if (original.audit.userId !== declaration.userId || original.audit.householdId !== null ||
      original.details.openingBasis !== details.openingBasis || original.details.openingOperationId !== details.openingOperationId ||
      original.details.taxLotId !== lot.id || original.details.cashMoved !== false ||
      (holding.acquisitionFxRate !== null && !equal(value.acquisitionFxRate, holding.acquisitionFxRate))) throw unavailable();
  } else if (holding.acquisitionFxRate !== null && originals.some(row => !equal(row.fxRate, holding.acquisitionFxRate))) {
    // A later purchase, or a different rate on the original date, cannot certify
    // a stored original rate. A genuine manual acquisition needs no creator row.
    throw unavailable();
  }
}

/** Internal admission only. The SIP writer already owns holding UPDATE,
 * custody and instrument locks. Existing basis reconciliation locks actual
 * lots/trades/claims/disposals/cash with NOWAIT and rereads them. Audit SHARE
 * locks then protect the genuine original witness through the entire purchase.
 * Ordinary acquisition writers use the same holding anchor before emitting
 * their audits. No result or source evidence enters a shared response/audit. */
export async function lockSipHoldingFxSource(tx: TransactionType, holding: Holding, currency: string): Promise<void> {
  try {
    const before = await read(tx, holding);
    const basis = await lockHoldingRemainingBasis(tx, holding, currency);
    if (!equal(holding.costBasis, basis.costBasis) ||
      (holding.costBasisZmw !== null && !equal(holding.costBasisZmw, basis.costBasisZmw))) throw unavailable();
    const auditIds = before.audits.map(row => row.id);
    if (auditIds.length) await tx.select({ id: auditLogs.id }).from(auditLogs).where(inArray(auditLogs.id, auditIds))
      .orderBy(auditLogs.id).for("share", { noWait: true });
    const after = await read(tx, holding);
    if (!isDeepStrictEqual(before, after)) throw unavailable();
    validate(after, holding, currency);
  } catch {
    // Includes malformed sources, lock conflicts and database diagnostics.
    // Existing failed execution logs must never echo their IDs or amounts.
    throw unavailable();
  }
}
