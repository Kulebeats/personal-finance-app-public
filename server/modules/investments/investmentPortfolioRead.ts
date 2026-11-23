import { and, eq, ne, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { accounts, grzTBills, holdings, pensionHoldings, securities } from "@shared/schema";
import { db } from "../../db";
import { getLatestFxRates } from "../../core/calculations";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { ConflictError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { PortfolioValuationSource, ValuationReadContext } from "../../services/PortfolioValuationService";
import { getPostgresError } from "../../utils/postgresError";
import { heldTBillPredicate, tbillCarryingValueSql } from "../../services/grz/tbillCarryingValue";
import { lockInvestmentReadActor, requireInvestmentReadContext, type InvestmentReadSession } from "./investmentReadAuthority";
import { verifiedOpeningRateProjection } from "./investmentHoldingRateEvidence";
import {
  assertHouseholdSecurityPriceAvailable,
  householdSecurityPriceProjection,
  type HouseholdSecurityPriceSelection,
} from "../../services/investment/householdSecurityPriceRead";

type Custody = { id: string; householdId: string; ownerUserId: string | null; isPrivate: boolean | null };
type PortfolioReadCut = {
  holdings: (PortfolioValuationSource["holdings"][number] & {
    account: Custody & { isHidden: boolean | null };
    priceEvidence: HouseholdSecurityPriceSelection;
  })[];
  /** faceValue is the bill's carrying value: face while active, face less withholding awaiting receipt (A-36). */
  bills: { id: string; householdId: string; accountId: string; status: "active" | "awaiting_receipt"; faceValue: string | null; account: Custody }[];
  pensions: { id: string; householdId: string; accountId: string; balance: string | null; account: Custody }[];
};

/** One SQL statement supplies one source snapshot for all returned valuation legs. */
async function readPortfolioCut(caller: HouseholdContext, session: InvestmentReadSession, includeAlternatives: boolean) {
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
        const custody = sql`jsonb_build_object('id', ${accounts.id}, 'householdId', ${accounts.householdId},
          'ownerUserId', ${accounts.ownerUserId}, 'isPrivate', ${accounts.isPrivate})`;
        const bills = includeAlternatives ? sql`(select jsonb_agg(jsonb_build_object(
          'id', ${grzTBills.id}, 'householdId', ${grzTBills.householdId}, 'accountId', ${grzTBills.accountId},
          'status', ${grzTBills.status}, 'faceValue', ${tbillCarryingValueSql}, 'account', ${custody}) order by ${grzTBills.id})
          from ${grzTBills} inner join ${accounts} on ${accounts.id} = ${grzTBills.accountId}
          where ${and(eq(grzTBills.householdId, actor.householdId), heldTBillPredicate(), visibleAccountPredicate(actor))})` : sql`null`;
        const pensions = includeAlternatives ? sql`(select jsonb_agg(jsonb_build_object(
          'id', ${pensionHoldings.id}, 'householdId', ${pensionHoldings.householdId}, 'accountId', ${pensionHoldings.accountId},
          'balance', ${pensionHoldings.currentBalance}::text, 'account', ${custody}) order by ${pensionHoldings.id})
          from ${pensionHoldings} inner join ${accounts} on ${accounts.id} = ${pensionHoldings.accountId}
          where ${and(eq(pensionHoldings.householdId, actor.householdId), visibleAccountPredicate(actor))})` : sql`null`;
        // Explicit text casts keep numeric money/quantity out of JSON number
        // parsing. Deterministic ordering makes publication compare the source.
        const result = await tx.execute<PortfolioReadCut>(sql`select
          coalesce((select jsonb_agg(jsonb_build_object(
            'holding', jsonb_build_object('id', ${holdings.id}, 'householdId', ${holdings.householdId},
              'accountId', ${holdings.accountId}, 'securityId', ${holdings.securityId}, 'quantity', ${holdings.quantity}::text,
              'costBasis', ${holdings.costBasis}::text, 'costBasisZmw', ${holdings.costBasisZmw}::text,
              'acquisitionFxRate', ${holdings.acquisitionFxRate}::text, 'acquiredDate', ${holdings.acquiredDate}::text,
              'verifiedOpeningRate', ${verifiedOpeningRateProjection()}),
            'security', jsonb_build_object('id', ${securities.id}, 'type', ${securities.type},
              'currency', ${securities.currency}, 'currentPrice', (${priceEvidence})->>'currentPrice'),
            'priceEvidence', ${priceEvidence},
            'account', ${custody} || jsonb_build_object('isHidden', ${accounts.isHidden})) order by ${holdings.id})
            from ${holdings} inner join ${securities} on ${securities.id} = ${holdings.securityId}
            inner join ${accounts} on ${accounts.id} = ${holdings.accountId}
            where ${and(eq(holdings.householdId, actor.householdId), visibleAccountPredicate(actor), ne(accounts.isHidden, true))}), '[]'::jsonb) as holdings,
          coalesce(${bills}, '[]'::jsonb) as bills,
          coalesce(${pensions}, '[]'::jsonb) as pensions`);
        return result.rows[0];
      }, { isolationLevel: "read committed" });
    } catch (error) {
      if (getPostgresError(error)?.code === "40001") {
        if (attempt < 2) continue;
        throw new ConflictError("Portfolio changed. Refresh and try again.");
      }
      throw error;
    }
  }
}

/** FX and all valuation awaits must finish before current publication authority. */
export async function valueVisiblePortfolio<T>(
  caller: HouseholdContext,
  session: InvestmentReadSession,
  calculate: (context: ValuationReadContext) => Promise<T>,
  includeAlternatives = true,
): Promise<T> {
  const before = await readPortfolioCut(caller, session, includeAlternatives);
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    for (const row of before.holdings) assertHouseholdSecurityPriceAvailable(row.priceEvidence, row.holding.quantity);
    outcome = { ok: true, value: await calculate({ database: db, getLatestFxRates, source: before }) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  // Recheck failures as well: retired valuation errors can name private units.
  const after = await readPortfolioCut(caller, session, includeAlternatives);
  if (!isDeepStrictEqual(before, after)) throw new ConflictError("Portfolio changed. Refresh and try again.");
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
