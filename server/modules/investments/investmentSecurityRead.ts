import { and, desc, eq, getTableColumns, gte, lte, sql } from "drizzle-orm";
import { securities, securityPrices } from "@shared/schema";
import { db } from "../../db";
import { ConflictError, NotFoundError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { householdSecurityPriceProjection } from "../../services/investment/householdSecurityPriceRead";
import { securityVisibleTo } from "../../services/investment/securityCatalogueScope";
import { getPostgresError } from "../../utils/postgresError";
import {
  lockInvestmentReadActor,
  requireInvestmentReadContext,
  type InvestmentReadSession,
} from "./investmentReadAuthority";
import type { GetSecurityPricesQuery, ListSecuritiesQuery } from "./investments.validation";

/**
 * Global reference history for a security in the caller's catalogue (NEW-13).
 * Only visibility is checked: the household's own marks play no part here, so
 * overlapping marks cannot hide history. Unknown and foreign ids are both 404.
 */
export async function readVisibleSecurityPriceHistory(
  caller: HouseholdContext,
  session: InvestmentReadSession,
  securityId: string,
  options: GetSecurityPricesQuery,
) {
  requireInvestmentReadContext(caller, session);
  return db.transaction(async tx => {
    const actor = await lockInvestmentReadActor(tx, caller, session);
    const [visible] = await tx.select({ id: securities.id }).from(securities)
      .where(and(eq(securities.id, securityId), securityVisibleTo(actor.householdId)));
    if (!visible) throw new NotFoundError("Security not found");
    return tx.select().from(securityPrices).where(and(
      eq(securityPrices.securityId, visible.id),
      options.startDate ? gte(securityPrices.date, options.startDate) : undefined,
      options.endDate ? lte(securityPrices.date, options.endDate) : undefined,
    )).orderBy(desc(securityPrices.date)).limit(options.limit || 365);
  }, { isolationLevel: "read committed" });
}

/** Catalogue metadata and its caller's current valuation price share one read. */
export async function readHouseholdSecurities(
  caller: HouseholdContext,
  session: InvestmentReadSession,
  filters: ListSecuritiesQuery,
  securityId?: string,
) {
  requireInvestmentReadContext(caller, session);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async tx => {
        const actor = await lockInvestmentReadActor(tx, caller, session);
        const valuationDate = sql`(statement_timestamp() AT TIME ZONE 'UTC')::date`;
        const priceEvidence = householdSecurityPriceProjection({
          householdId: actor.householdId,
          securityId: securities.id,
          currency: securities.currency,
          globalReferencePrice: securities.currentPrice,
          valuationDate,
        });
        const rows = await tx.select({ security: getTableColumns(securities), priceEvidence })
          .from(securities)
          .where(and(
            securityVisibleTo(actor.householdId),
            securityId ? eq(securities.id, securityId) : undefined,
            filters.type ? eq(securities.type, filters.type) : undefined,
            filters.exchange ? eq(securities.exchange, filters.exchange) : undefined,
            filters.currency ? eq(securities.currency, filters.currency) : undefined,
          ));
        const search = filters.search?.toLowerCase();
        const selected = search ? rows.filter(({ security }) =>
          security.symbol.toLowerCase().includes(search) || security.name.toLowerCase().includes(search),
        ) : rows;
        return selected.map(({ security, priceEvidence: evidence }) => {
          if (evidence.overrides.length > 1) {
            throw new ConflictError("Household security price periods overlap. Resolve the overlapping prices and try again.");
          }
          const mark = evidence.overrides[0];
          return {
            ...security,
            currentPrice: evidence.currentPrice,
            valuationPrice: mark ? {
              source: "manual" as const,
              effectiveDate: mark.effectiveDate,
              validThrough: mark.validThrough,
              recordedAt: mark.recordedAt,
            } : null,
          };
        });
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (getPostgresError(error)?.code === "40001") {
        if (attempt < 2) continue;
        throw new ConflictError("Security prices changed. Refresh and try again.");
      }
      throw error;
    }
  }
}
