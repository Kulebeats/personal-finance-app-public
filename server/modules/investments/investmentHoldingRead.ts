import { and, eq, getTableColumns, ne, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { accounts, holdings, securities, type Holding, type Security } from "@shared/schema";
import { db } from "../../db";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { ConflictError, HttpError } from "../../core/errors";
import { CalculationError } from "../../core/calculations/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { getPostgresError } from "../../utils/postgresError";
import { lockInvestmentReadActor, requireInvestmentReadContext, type InvestmentReadSession as HoldingReadSession } from "./investmentReadAuthority";
import { verifiedOpeningRateProjection } from "./investmentHoldingRateEvidence";
import {
  assertHouseholdSecurityPriceAvailable,
  householdSecurityPriceProjection,
  type HouseholdSecurityPriceSelection,
} from "../../services/investment/householdSecurityPriceRead";
export type { InvestmentReadSession as HoldingReadSession } from "./investmentReadAuthority";

interface HoldingReadFilters {
  accountId?: string;
  holdingId?: string;
}

interface VisibleHolding {
  holding: Holding;
  verifiedOpeningRate: boolean;
  security: Security & {
    valuationPrice: {
      source: "manual";
      effectiveDate: string;
      validThrough: string;
      recordedAt: string;
    } | null;
  };
  priceEvidence: HouseholdSecurityPriceSelection;
}

class HoldingValuationUnavailable extends HttpError {
  readonly statusCode = 422;
  readonly code = "FINANCIAL_DATA_UNAVAILABLE";
}

/** Lock current authority, then select custody/security in one joined source cut. */
export async function readVisibleHoldings(
  caller: HouseholdContext,
  session: HoldingReadSession,
  filters: HoldingReadFilters = {},
): Promise<VisibleHolding[]> {
  requireInvestmentReadContext(caller, session);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async tx => {
        const actor = await lockInvestmentReadActor(tx, caller, session);

        const priceEvidence = householdSecurityPriceProjection({
          householdId: actor.householdId,
          securityId: securities.id,
          currency: securities.currency,
          globalReferencePrice: securities.currentPrice,
          valuationDate: sql`(statement_timestamp() AT TIME ZONE 'UTC')::date`,
        });
        const rows = await tx.select({ holding: holdings, security: getTableColumns(securities), priceEvidence,
          verifiedOpeningRate: verifiedOpeningRateProjection() })
          .from(holdings)
          .innerJoin(securities, eq(securities.id, holdings.securityId))
          .innerJoin(accounts, eq(accounts.id, holdings.accountId))
          .where(and(
            eq(holdings.householdId, actor.householdId),
            visibleAccountPredicate(actor),
            filters.accountId ? eq(holdings.accountId, filters.accountId) : undefined,
            filters.holdingId !== undefined ? eq(holdings.id, filters.holdingId) : undefined,
            // A hidden account is omitted from lists, but visible native detail is
            // still supported. Privacy/deletion checks above apply to both reads.
            filters.holdingId === undefined ? ne(accounts.isHidden, true) : undefined,
          ))
          // Stable ordering makes the complete holding/security source comparable.
          .orderBy(holdings.id);
        return rows.map(row => {
          const mark = row.priceEvidence.overrides.length === 1 ? row.priceEvidence.overrides[0] : null;
          return {
            ...row,
            security: {
              ...row.security,
              currentPrice: row.priceEvidence.currentPrice,
              valuationPrice: mark ? {
                source: "manual" as const,
                effectiveDate: mark.effectiveDate,
                validThrough: mark.validThrough,
                recordedAt: mark.recordedAt,
              } : null,
            },
          };
        });
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (getPostgresError(error)?.code === "40001") {
        if (attempt < 2) continue;
        throw new ConflictError("Holdings changed. Refresh and try again.");
      }
      throw error;
    }
  }
}

/**
 * An external valuation await cannot keep an earlier source authorized. A
 * holdingId filter values only that holding (A-11), so another holding's
 * missing price or rate cannot fail its read.
 */
export async function valueVisibleHoldings<T>(
  caller: HouseholdContext,
  session: HoldingReadSession,
  filters: HoldingReadFilters,
  calculate: (rows: VisibleHolding[]) => Promise<T>,
): Promise<T> {
  const before = await readVisibleHoldings(caller, session, filters);
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    for (const row of before) assertHouseholdSecurityPriceAvailable(row.priceEvidence, row.holding.quantity);
    outcome = { ok: true, value: await calculate(before) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  // Revalidate success and failure alike: an FX error can name a denomination
  // that the caller is no longer allowed to associate with a holding.
  const after = await readVisibleHoldings(caller, session, filters);
  if (!isDeepStrictEqual(before, after)) throw new ConflictError("Holdings changed. Refresh and try again.");
  if (!outcome.ok) {
    if (outcome.error instanceof CalculationError && outcome.error.code === "MISSING_FX_RATE") {
      throw new HoldingValuationUnavailable("The holding valuation is unavailable because an exchange rate is missing.");
    }
    throw outcome.error;
  }
  return outcome.value;
}
