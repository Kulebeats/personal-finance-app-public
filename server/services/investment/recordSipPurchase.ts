import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { and, eq, sql } from "drizzle-orm";
import { accounts, holdings, investmentTransactions, securities } from "@shared/schema";
import { businessAuditService } from "../BusinessAuditService";
import { recordPurchaseLot } from "../../modules/investments/investmentTradeHistory";
import type { TransactionType } from "../../utils/withTransaction";
import { lockSipHoldingFxSource } from "./sipHoldingFxSource";
import { completeSipExecutionProof, reserveSipExecutionPurchase, sipExecutionPlan, type SipExecutionAuthority } from "./sipExecutionAuthorization";

const Exact = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });

export async function recordSipPurchase(tx: TransactionType, authority: SipExecutionAuthority, date: string, idempotencyKey: string) {
  const plan = sipExecutionPlan(tx, authority);
  if (!plan.securityId) throw new Error("SIP has no investment instrument");
  const position = and(eq(holdings.accountId, plan.accountId), eq(holdings.securityId, plan.securityId));
  const candidates = await tx.select().from(holdings).where(position).orderBy(holdings.id).limit(2).for("update");
  // With no holding row to lock, serialize first purchases on custody and
  // recheck. Manual trades take the holding lock first, so never wait for an
  // existing holding while holding the stronger account lock.
  const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, plan.accountId),
    eq(accounts.householdId, plan.householdId))).for(candidates.length ? "share" : "update");
  if (!account || account.deletedAt || (account.isPrivate && account.ownerUserId !== authority.grant.authorUserId)) {
    throw new Error("SIP has no authorized custody source");
  }
  const rows = candidates.length ? candidates : await tx.select().from(holdings)
    .where(position).orderBy(holdings.id).limit(2).for("update", { noWait: true });
  if (rows.length > 1 || (rows[0] && rows[0].householdId !== plan.householdId)) throw new Error("Ambiguous SIP holding");
  const [security] = await tx.select().from(securities).where(eq(securities.id, plan.securityId)).for("share");
  if (!security?.currentPrice || security.type === "tbill" || security.currency !== plan.currency ||
      !/^[A-Z]{3}$/.test(security.currency)) throw new Error("SIP quote is unavailable in the plan currency");
  const amount = new Exact(plan.amount), price = new Exact(security.currentPrice);
  if (!amount.isFinite() || !amount.gt(0) || !price.isFinite() || !price.gt(0)) throw new Error("Invalid SIP amount or price");
  const quantity = amount.div(price).toDecimalPlaces(8);
  if (!quantity.gt(0) || quantity.gte("1e10") || !quantity.times(price).toDecimalPlaces(2).eq(amount)) {
    throw new Error("SIP payment cannot be represented at the quoted share price");
  }
  const existing = rows[0];
  const purchaseId = randomUUID();
  let holdingId: string;
  if (existing) {
    if (security.currency !== "ZMW" && (existing.costBasisZmw !== null || existing.acquisitionFxRate !== null)) {
      await lockSipHoldingFxSource(tx, existing, security.currency);
    }
    const previous = new Exact(existing.quantity);
    const total = previous.plus(quantity);
    if (!previous.isFinite() || previous.lt(0) || total.gte("1e10")) throw new Error("Invalid SIP holding quantity");
    const oldBasis = existing.costBasis === null ? null : new Exact(existing.costBasis);
    if (oldBasis && (!oldBasis.isFinite() || oldBasis.lt(0))) throw new Error("Invalid SIP opening basis");
    const basis = oldBasis === null && !previous.isZero() ? null : new Exact(oldBasis ?? 0).plus(amount);
    if (basis?.gte("1e13")) throw new Error("SIP basis exceeds the supported amount");
    await reserveSipExecutionPurchase(tx, authority, purchaseId);
    await tx.update(holdings).set({ quantity: total.toFixed(8), costBasis: basis?.toFixed(2) ?? null,
      costBasisZmw: security.currency === "ZMW" && existing.costBasisZmw !== null ? basis?.toFixed(2) ?? null : null,
      acquisitionFxRate: null, updatedAt: new Date() }).where(eq(holdings.id, existing.id));
    holdingId = existing.id;
  } else {
    await reserveSipExecutionPurchase(tx, authority, purchaseId);
    const [holding] = await tx.insert(holdings).values({ householdId: plan.householdId, accountId: account.id,
      securityId: security.id, quantity: quantity.toFixed(8), costBasis: amount.toFixed(2), acquiredDate: date }).returning({ id: holdings.id });
    holdingId = holding.id;
  }
  const [purchase] = await tx.insert(investmentTransactions).values({ id: purchaseId, householdId: plan.householdId,
    accountId: account.id, holdingId, securityId: security.id, type: "buy", quantity: quantity.toFixed(8), price: price.toFixed(4),
    amount: amount.toFixed(2), currency: security.currency, transactionDate: date, createdAt: sql`clock_timestamp()`,
    notes: `Recurring Investment Execution (Plan ID: ${plan.id}) [idem:${idempotencyKey}]`,
  }).returning();
  await recordPurchaseLot(tx, purchase);
  await businessAuditService.logCreate({ tx, userId: null, householdId: account.isPrivate ? null : plan.householdId,
    entityType: "investment_transaction", entityId: purchase.id,
    newValue: { accountId: purchase.accountId, holdingId: purchase.holdingId, securityId: purchase.securityId,
      type: purchase.type, amount: purchase.amount, currency: purchase.currency, quantity: purchase.quantity,
      price: purchase.price, transactionDate: purchase.transactionDate },
    metadata: { actor: "system", trigger: "sip", recurringInvestmentId: plan.id, idempotencyKey,
      authorizationContractVersion: 1, authorizationProofPurchaseId: purchase.id },
  });
  await completeSipExecutionProof(tx, authority, purchase);
  return purchase.id;
}
