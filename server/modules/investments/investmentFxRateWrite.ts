import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { fxRates, householdFxRateOverrides } from "@shared/schema";
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from "../../core/errors";
import { db } from "../../db";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { businessAuditService } from "../../services/BusinessAuditService";
import { withTransaction } from "../../utils/withTransaction";
import { lockInvestmentWriterIdentity, type InvestmentSourceSession } from "./investmentTransactionAccess";
import { createFxRateSchema, type ListFxRatesQuery } from "./investments.validation";

/** One row of the rates a household can see: its own manual rates and the shared provider rows. */
export interface VisibleFxRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  date: string;
  validThrough: string | null;
  source: string;
  scope: "household" | "shared";
}

class HouseholdFxRateConflict extends ConflictError {
  constructor(readonly existingOverride: { id: string; effectiveDate: string; validThrough: string }) {
    super(`These dates overlap a household rate from ${existingOverride.effectiveDate} through ${existingOverride.validThrough}. Resolve which rate should apply.`, existingOverride.id);
  }

  toJSON() {
    const result = super.toJSON();
    return { ...result, error: { ...result.error, existingOverride: this.existingOverride } };
  }
}

/** R12: only an owner or admin records a rate, and only for their own household. */
export async function recordHouseholdFxRate(
  input: unknown,
  caller: HouseholdContext,
  ipAddress: string | undefined,
  session: InvestmentSourceSession,
) {
  const parsed = createFxRateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Invalid request data", parsed.error.errors);
  }
  if (!session?.snapshot || !session.sessionId) {
    throw new UnauthorizedError("Authentication changed; sign in again");
  }
  const { fromCurrency, toCurrency, rate, date, validThrough } = parsed.data;

  return withTransaction(async tx => {
    const actor = await lockInvestmentWriterIdentity(tx, caller, session);
    if (actor.role !== "owner" && actor.role !== "admin") {
      throw new ForbiddenError("An owner or admin must record household exchange rates");
    }
    // Serialize date-window admission for this household and pair.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
      ${`household-fx-rate:${actor.householdId.toLowerCase()}:${fromCurrency}:${toCurrency}`}, 0))`);
    const [overlap] = await tx.select({
      id: householdFxRateOverrides.id,
      effectiveDate: householdFxRateOverrides.effectiveDate,
      validThrough: householdFxRateOverrides.validThrough,
    }).from(householdFxRateOverrides).where(and(
      eq(householdFxRateOverrides.householdId, actor.householdId),
      eq(householdFxRateOverrides.fromCurrency, fromCurrency),
      eq(householdFxRateOverrides.toCurrency, toCurrency),
      lte(householdFxRateOverrides.effectiveDate, validThrough),
      gte(householdFxRateOverrides.validThrough, date),
    )).limit(1);
    if (overlap) {
      throw new HouseholdFxRateConflict(overlap);
    }

    const [override] = await tx.insert(householdFxRateOverrides).values({
      householdId: actor.householdId,
      actorUserId: actor.userId,
      fromCurrency,
      toCurrency,
      effectiveDate: date,
      validThrough,
      rate,
      source: "manual",
    }).returning();

    await businessAuditService.logCreate({
      tx,
      userId: actor.userId,
      householdId: actor.householdId,
      entityType: "fx_rate",
      entityId: override.id,
      newValue: {
        fromCurrency: override.fromCurrency,
        toCurrency: override.toCurrency,
        rate: override.rate,
        date: override.effectiveDate,
        validThrough: override.validThrough,
        source: override.source,
      },
      metadata: { rateScope: "household" },
      ipAddress,
    });
    return override;
  });
}

/** The household's own manual rates first, then the shared provider rows; never another household's. */
export async function listVisibleFxRates(householdId: string, filters: ListFxRatesQuery): Promise<VisibleFxRate[]> {
  const own = await db.select().from(householdFxRateOverrides).where(and(
    eq(householdFxRateOverrides.householdId, householdId),
    filters.from ? eq(householdFxRateOverrides.fromCurrency, filters.from) : undefined,
    filters.to ? eq(householdFxRateOverrides.toCurrency, filters.to) : undefined,
  )).orderBy(desc(householdFxRateOverrides.effectiveDate));
  const shared = await db.select().from(fxRates).where(and(
    filters.from ? eq(fxRates.fromCurrency, filters.from) : undefined,
    filters.to ? eq(fxRates.toCurrency, filters.to) : undefined,
  )).orderBy(desc(fxRates.date));
  return [
    ...own.map(row => ({
      id: row.id, fromCurrency: row.fromCurrency, toCurrency: row.toCurrency, rate: row.rate,
      date: row.effectiveDate, validThrough: row.validThrough, source: row.source, scope: "household" as const,
    })),
    ...shared.map(row => ({
      id: row.id, fromCurrency: row.fromCurrency, toCurrency: row.toCurrency, rate: row.rate,
      date: row.date, validThrough: null, source: row.source, scope: "shared" as const,
    })),
  ];
}
