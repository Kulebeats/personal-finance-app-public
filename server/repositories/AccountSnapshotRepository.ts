import { eq, and, gte, lte, asc, sql } from "drizzle-orm";
import { db } from "../db";
import { accountBalanceSnapshots, netWorthSnapshots } from "@shared/schema";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { Money } from "../core/money";

/**
 * AccountSnapshotRepository
 *
 * Handles all snapshot-related operations for accounts and net worth.
 * Split from AccountRepository per TODO-023.
 */
export class AccountSnapshotRepository {
  /**
   * Get net worth snapshots for a date range (household-scoped, from netWorthSnapshots table)
   */
  async getNetWorthSnapshots(
    householdId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<
    {
      date: string;
      totalAssets: string;
      totalLiabilities: string;
      netWorth: string;
    }[]
  > {
    const results = await db
      .select({
        date: netWorthSnapshots.date,
        totalAssets: netWorthSnapshots.totalAssets,
        totalLiabilities: netWorthSnapshots.totalLiabilities,
        netWorth: netWorthSnapshots.netWorth,
      })
      .from(netWorthSnapshots)
      .where(
        and(
          eq(netWorthSnapshots.householdId, householdId),
          gte(netWorthSnapshots.date, startDate.toISOString().split("T")[0]),
          lte(netWorthSnapshots.date, endDate.toISOString().split("T")[0]),
        ),
      )
      .orderBy(asc(netWorthSnapshots.date));

    return results.map((r) => ({
      date: r.date,
      totalAssets: r.totalAssets,
      totalLiabilities: r.totalLiabilities,
      netWorth: r.netWorth,
    }));
  }

  /**
   * TODO-009: Get user-scoped net worth series
   *
   * Unlike getNetWorthSnapshots (household-level), this computes net worth
   * from accountBalanceSnapshots joined with accounts, applying visibility filters:
   * - Excludes private accounts not owned by user
   * - Excludes accounts with excludeFromNetWorth=true
   * - Excludes archived accounts (isArchived=true)
   * - Excludes hidden accounts (isHidden=true)
   */
  async getUserNetWorthSeries(
    householdId: string,
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<
    {
      date: string;
      totalAssets: string;
      totalLiabilities: string;
      netWorth: string;
    }[]
  > {
    // Join account snapshots with accounts, grouped by date
    // Must aggregate assets and liabilities per date, respecting visibility
    const results = await db.execute(sql`
      WITH user_visible_accounts AS (
        SELECT a.id, a.is_asset
        FROM accounts a
        WHERE a.household_id = ${householdId}
          AND a.deleted_at IS NULL
          AND a.exclude_from_net_worth = false
          AND a.is_archived = false
          AND a.is_hidden = false
          AND (a.is_private = false OR a.owner_user_id = ${userId})
      )
      SELECT 
        abs.date,
        COALESCE(SUM(CASE WHEN uva.is_asset THEN CAST(abs.balance AS DECIMAL(20,2)) ELSE 0 END), 0)::TEXT AS total_assets,
        COALESCE(SUM(CASE WHEN NOT uva.is_asset THEN CAST(abs.balance AS DECIMAL(20,2)) ELSE 0 END), 0)::TEXT AS total_liabilities
      FROM account_balance_snapshots abs
      INNER JOIN user_visible_accounts uva ON abs.account_id = uva.id
      WHERE abs.date >= ${startDate.toISOString().split("T")[0]}
        AND abs.date <= ${endDate.toISOString().split("T")[0]}
      GROUP BY abs.date
      ORDER BY abs.date ASC
    `);

    // TODO-009: Use Money class for financial calculations (Rule 1)
    return (results.rows as { date: string; total_assets: string; total_liabilities: string }[]).map((r) => {
      const assets = new Money(r.total_assets || "0");
      const liabilities = new Money(r.total_liabilities || "0");
      const netWorth = assets.subtract(liabilities);
      return {
        date: r.date,
        totalAssets: assets.toString(),
        totalLiabilities: liabilities.toString(),
        netWorth: netWorth.toString(),
      };
    });
  }

  /**
   * Get balance snapshots for an account within a date range
   */
  async getBalanceSnapshots(
    accountId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ date: string; balance: string }[]> {
    const results = await db
      .select({
        date: accountBalanceSnapshots.date,
        balance: accountBalanceSnapshots.balance,
      })
      .from(accountBalanceSnapshots)
      .where(
        and(
          eq(accountBalanceSnapshots.accountId, accountId),
          gte(
            accountBalanceSnapshots.date,
            startDate.toISOString().split("T")[0],
          ),
          lte(
            accountBalanceSnapshots.date,
            endDate.toISOString().split("T")[0],
          ),
        ),
      )
      .orderBy(asc(accountBalanceSnapshots.date));

    return results.map((r) => ({
      date: r.date,
      balance: r.balance,
    }));
  }

  /**
   * Import balance snapshots for an account
   */
  async importBalanceSnapshots(
    accountId: string,
    data: { date: string; balance: string }[],
    callerTx?: TransactionType,
  ): Promise<number> {
    if (data.length === 0) return 0;

    // Use upsert to handle existing dates. With callerTx the rows commit with
    // the caller's audit row (NEW-32).
    let imported = 0;
    const run = (body: (tx: TransactionType) => Promise<void>) => callerTx ? body(callerTx) : withTransaction(body);
    await run(async (tx) => {
      for (const entry of data) {
        await tx
          .insert(accountBalanceSnapshots)
          .values({
            accountId,
            date: entry.date,
            balance: entry.balance,
          })
          .onConflictDoUpdate({
            target: [
              accountBalanceSnapshots.accountId,
              accountBalanceSnapshots.date,
            ],
            set: { balance: entry.balance },
          });
        imported++;
      }
    });

    return imported;
  }
}

// Export singleton instance
export const accountSnapshotRepository = new AccountSnapshotRepository();
