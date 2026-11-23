import { eq } from "drizzle-orm";
import { holdings, investmentOpeningOperationReceipts, investmentTransactions, securities, taxLots } from "@shared/schema";
import { Money } from "../../core/money";
import { ConflictError, UnauthorizedError, ValidationError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";
import { createHoldingRequestSchema, createHoldingSchema, type CreateHoldingInput } from "./investments.validation";
import { lockInvestmentTransactionSources, lockInvestmentWriterIdentity, type InvestmentSourceSession } from "./investmentTransactionAccess";
import { openingCreationSnapshot, openingRequestDigest, replayOpeningOperation } from "./investmentHoldingOpeningReceipt";
import { convertInvestmentEventToZmw, DATED_INVESTMENT_FX_POLICY } from "./investmentDatedFx";

const openingBasis = "declared_record_only_v1";

/** A new opening is an explicit dated total-cost declaration, not a cash
 * posting or a historical per-share execution price. Legacy aggregates do not
 * enter this writer and cannot acquire provenance from their current values. */
export async function createDeclaredOpeningHolding(input: CreateHoldingInput, caller: HouseholdContext, ipAddress: string | undefined, session: InvestmentSourceSession) {
  if (session?.snapshot?.id !== caller?.userId || !session?.sessionId) throw new UnauthorizedError("Authentication changed; sign in again");
  const parsed = createHoldingRequestSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid request data", parsed.error.errors);
  const data = parsed.data;
  return withTransaction(async tx => {
    // The current user UPDATE lock serializes this actor's operation receipt
    // admission. Composite uniqueness also enforces actor/household/key identity.
    const identity = await lockInvestmentWriterIdentity(tx, caller, session);
    const replay = await replayOpeningOperation(tx, identity, data, session);
    if (replay) return replay;
    // Existing operation intent is adjudicated above under its ORIGINAL
    // authority. Full cross-field admission validation belongs to new writes.
    const admitted = createHoldingSchema.safeParse(data);
    if (!admitted.success) throw new ValidationError("Invalid request data", admitted.error.errors);
    const { actor } = await lockInvestmentTransactionSources(tx, caller, data, session);
    // The source guard holds this security SHARE lock through the commit.
    // Native opening cost uses the same instrument units as ordinary trades.
    const [security] = await tx.select({ currency: securities.currency }).from(securities).where(eq(securities.id, data.securityId));
    const currency = security?.currency;
    if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new ValidationError("Opening denomination must match its investment source");
    if (currency !== data.expectedCurrency) throw new ConflictError("Opening denomination changed. Review the investment source");
    const cost = data.costBasis === null ? null : new Money(data.costBasis, currency);
    const base = data.costBasisZmw == null ? null : new Money(data.costBasisZmw, "ZMW");
    const rate = data.acquisitionFxRate ?? null;
    if (currency === "ZMW" && ((base !== null && !base.equals(cost ?? "0")) || (rate !== null && !new Money(rate).equals("1")))) {
      throw new ValidationError("A ZMW opening must use its native cost and a unit conversion rate");
    }
    // A declared foreign base or rate must be the dated rate for the acquired
    // date (#236 F2): no rate is a 422, a disagreeing claim a 400. What the
    // caller left out stays unknown rather than invented.
    const verified = currency !== "ZMW" && (base !== null || rate !== null) ? await convertInvestmentEventToZmw(tx, actor.householdId,
      currency, data.acquiredDate, cost?.toString() ?? "0", { fxRate: rate ?? undefined, amountZmw: base?.toString() }) : null;
    const costBasisZmw = currency === "ZMW" ? cost?.toString() ?? base?.toString() ?? null : base?.toString() ?? null;
    const [holding] = await tx.insert(holdings).values({
      householdId: actor.householdId, accountId: data.accountId, securityId: data.securityId,
      quantity: new Money(data.quantity).amount.toFixed(8), costBasis: cost?.toString() ?? null,
      acquiredDate: data.acquiredDate, costBasisZmw, acquisitionFxRate: rate,
    }).returning();
    let purchaseId: string | null = null, lotId: string | null = null;
    if (!new Money(holding.quantity).isZero()) {
      // Positive shares require a declared cost in the schema above. Leave
      // unknown execution price, fee split and foreign conversion unknown.
      const [purchase] = await tx.insert(investmentTransactions).values({
        householdId: actor.householdId, accountId: holding.accountId, holdingId: holding.id, securityId: holding.securityId,
        type: "buy", quantity: holding.quantity, price: null, amount: cost!.toString(), currency,
        amountZmw: costBasisZmw, fxRate: rate, fees: null, withholdingTax: null, linkedTransactionId: null,
        transactionDate: data.acquiredDate, notes: "Declared record-only opening; no cash movement",
      }).returning();
      const [lot] = await tx.insert(taxLots).values({
        householdId: actor.householdId, holdingId: holding.id, transactionId: purchase.id,
        quantity: purchase.quantity!, remainingQuantity: purchase.quantity!, costBasis: purchase.amount,
        costBasisZmw: purchase.amountZmw, acquiredDate: purchase.transactionDate, acquisitionFxRate: purchase.fxRate,
      }).returning({ id: taxLots.id });
      purchaseId = purchase.id; lotId = lot.id;
      await businessAuditService.logCreate({
        tx, userId: actor.userId, householdId: null, entityType: "investment_transaction", entityId: purchase.id, ipAddress,
        newValue: { type: purchase.type, accountId: purchase.accountId, holdingId: holding.id, securityId: purchase.securityId,
          quantity: purchase.quantity, amount: purchase.amount, currency: purchase.currency, price: purchase.price,
          fees: purchase.fees, amountZmw: purchase.amountZmw, fxRate: purchase.fxRate, transactionDate: purchase.transactionDate,
          linkedTransactionId: purchase.linkedTransactionId },
        metadata: { openingBasis, openingOperationId: data.operationId, taxLotId: lot.id, cashMoved: false,
          ...(verified && purchase.fxRate !== null
            ? { fxRateBasis: DATED_INVESTMENT_FX_POLICY, fxRateSource: verified.source } : {}) },
      });
    }
    await businessAuditService.logCreate({
      tx, userId: actor.userId, householdId: null, entityType: "holding", entityId: holding.id, ipAddress,
      newValue: { accountId: holding.accountId, securityId: holding.securityId, quantity: holding.quantity,
        costBasis: holding.costBasis, acquiredDate: holding.acquiredDate, currency,
        costBasisZmw: holding.costBasisZmw, acquisitionFxRate: holding.acquisitionFxRate },
      metadata: { openingBasis, openingOperationId: data.operationId, openingPurchaseId: purchaseId, taxLotId: lotId, cashMoved: false },
    });
    await tx.insert(investmentOpeningOperationReceipts).values({ householdId: actor.householdId, actorUserId: actor.userId,
      operationId: data.operationId, requestVersion: 1, requestDigest: openingRequestDigest(data), currency,
      holdingId: holding.id, creationSnapshot: openingCreationSnapshot(holding, purchaseId, lotId) });
    return holding;
  });
}
