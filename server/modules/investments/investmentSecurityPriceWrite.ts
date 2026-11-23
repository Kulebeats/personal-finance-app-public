import { and, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { householdSecurityPriceOverrides, securities } from "@shared/schema";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";
import { lockInvestmentWriterIdentity, type InvestmentSourceSession } from "./investmentTransactionAccess";
import { updateSecurityPriceSchema } from "./investments.validation";
import { securityVisibleTo } from "../../services/investment/securityCatalogueScope";

class HouseholdSecurityPriceConflict extends ConflictError {
  constructor(readonly existingOverride: { id: string; effectiveDate: string; validThrough: string }) {
    super(`These dates overlap a household price from ${existingOverride.effectiveDate} through ${existingOverride.validThrough}. Resolve which price should apply.`, existingOverride.id);
  }

  toJSON() {
    const result = super.toJSON();
    return { ...result, error: { ...result.error, existingOverride: this.existingOverride } };
  }
}

export async function recordHouseholdSecurityPrice(
  id: string,
  input: unknown,
  caller: HouseholdContext,
  ipAddress: string | undefined,
  session: InvestmentSourceSession,
) {
  const instrumentId = z.string().uuid().safeParse(id);
  if (!instrumentId.success) {
    throw new ValidationError("Invalid security identifier", instrumentId.error.errors);
  }
  const parsed = updateSecurityPriceSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Invalid request data", parsed.error.errors);
  }
  if (!session?.snapshot || !session.sessionId) {
    throw new UnauthorizedError("Authentication changed; sign in again");
  }

  return withTransaction(async tx => {
    const actor = await lockInvestmentWriterIdentity(tx, caller, session);
    if (actor.role !== "owner" && actor.role !== "admin") {
      throw new ForbiddenError("An owner or admin must record household prices");
    }
    const [instrument] = await tx.select({
      id: securities.id,
      symbol: securities.symbol,
      currency: securities.currency,
    }).from(securities).where(and(eq(securities.id, instrumentId.data), securityVisibleTo(actor.householdId))).for("share");
    if (!instrument) {
      throw new NotFoundError("Security not found");
    }
    if (!/^[A-Z]{3}$/.test(instrument.currency)) {
      throw new ValidationError("Security requires a valid native currency");
    }

    // Serialize date-window admission for this household and instrument.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
      ${`household-security-price:${actor.householdId.toLowerCase()}:${instrument.id}`}, 0))`);
    const [overlap] = await tx.select({
      id: householdSecurityPriceOverrides.id,
      effectiveDate: householdSecurityPriceOverrides.effectiveDate,
      validThrough: householdSecurityPriceOverrides.validThrough,
    })
      .from(householdSecurityPriceOverrides).where(and(
        eq(householdSecurityPriceOverrides.householdId, actor.householdId),
        eq(householdSecurityPriceOverrides.securityId, instrument.id),
        lte(householdSecurityPriceOverrides.effectiveDate, parsed.data.validThrough),
        gte(householdSecurityPriceOverrides.validThrough, parsed.data.date),
      )).limit(1);
    if (overlap) {
      throw new HouseholdSecurityPriceConflict(overlap);
    }

    const [override] = await tx.insert(householdSecurityPriceOverrides).values({
      householdId: actor.householdId,
      actorUserId: actor.userId,
      securityId: instrument.id,
      effectiveDate: parsed.data.date,
      validThrough: parsed.data.validThrough,
      price: parsed.data.price,
      currency: instrument.currency,
      source: "manual",
    }).onConflictDoNothing({ target: [
      householdSecurityPriceOverrides.householdId,
      householdSecurityPriceOverrides.securityId,
      householdSecurityPriceOverrides.effectiveDate,
    ] }).returning();
    if (!override) {
      throw new ConflictError("This household already has a recorded price for that security and date");
    }

    await businessAuditService.logUpdate({
      tx,
      userId: actor.userId,
      householdId: actor.householdId,
      entityType: "security",
      entityId: instrument.id,
      newValue: {
        price: override.price,
        date: override.effectiveDate,
        validThrough: override.validThrough,
        currency: override.currency,
        source: override.source,
        overrideId: override.id,
      },
      metadata: { priceScope: "household" },
      ipAddress,
    });
    return {
      id: override.id,
      householdId: override.householdId,
      securityId: override.securityId,
      symbol: instrument.symbol,
      effectiveDate: override.effectiveDate,
      validThrough: override.validThrough,
      price: override.price,
      currency: override.currency,
      source: override.source,
      recordedAt: override.recordedAt,
    };
  });
}
