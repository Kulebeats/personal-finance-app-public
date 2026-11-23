/**
 * NEW-17 duplicate candidates: ledger rows a statement row may repeat.
 *
 * A candidate is offered for review; it is never skipped without the user
 * confirming it (execute `skipRowOrdinals`). Matching is one-to-one, so two
 * identical purchases in a file against one existing purchase yield one
 * candidate and one new row.
 */
import { accounts, transactions } from "@shared/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Money } from "../../core/money";
import type { db } from "../../db";
import type { TransactionType } from "../../utils/withTransaction";
import { couponCashDescriptionFields } from "../grz/couponCashDescription";
import { importRowKey, ledgerDedupeKey } from "./dedupe";
import { importTransactionScope, visibleImportAccount } from "./reviewVisibility";
import type { StatementRow } from "./statement";

export interface LedgerCandidate {
  id: string;
  name: string;
  date: string;
  type: string;
  amount: string;
  currency: string;
  idempotencyKey: string | null;
}

export type CandidateReason = "legacy_import" | "same_merchant" | "same_date_amount";

export interface AssignedCandidate {
  candidate: LedgerCandidate;
  reason: CandidateReason;
}

type Reader = TransactionType | typeof db;

/** Live rows on the account in the date range that this user may see. */
export async function readLedgerCandidates(reader: Reader, params: {
  householdId: string; userId: string; accountId: string; startDate: string; endDate: string;
}): Promise<LedgerCandidate[]> {
  return reader.select({
    // The preview echoes a candidate's name: GRZ cash reads as the ledger does (R1-05).
    id: transactions.id, name: couponCashDescriptionFields().name, date: transactions.date, type: transactions.type,
    amount: transactions.amount, currency: sql<string>`coalesce(${transactions.currency}, ${accounts.currency})`,
    idempotencyKey: transactions.idempotencyKey,
  }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.accountId)).where(and(
    importTransactionScope(params), visibleImportAccount(params),
    gte(transactions.date, params.startDate), lte(transactions.date, params.endDate),
  )).orderBy(transactions.date, transactions.id);
}

const normalise = (name: string) => name.trim().toLowerCase();

/** Strongest evidence first: an old-engine key, then the same merchant, then date/type/amount alone. */
const PASSES: Array<{ reason: CandidateReason; matches: (item: StatementRow, candidate: LedgerCandidate) => boolean }> = [
  { reason: "legacy_import", matches: (item, candidate) => candidate.idempotencyKey === item.legacyKey },
  { reason: "same_merchant", matches: (item, candidate) => normalise(candidate.name) === normalise(item.row.merchantName) },
  { reason: "same_date_amount", matches: () => true },
];

/**
 * @param open statement rows not already matched by identity
 * @param ledger visible candidates, minus rows this batch already owns by identity
 */
export function assignDuplicateCandidates(open: StatementRow[], ledger: LedgerCandidate[]): Map<number, AssignedCandidate> {
  const pool = new Map<string, LedgerCandidate[]>();
  for (const candidate of ledger) {
    const key = ledgerDedupeKey(candidate.date, candidate.type, new Money(candidate.amount));
    pool.set(key, [...(pool.get(key) ?? []), candidate]);
  }
  const assigned = new Map<number, AssignedCandidate>();
  for (const pass of PASSES) {
    for (const item of open) {
      if (assigned.has(item.row.rowIndex)) continue;
      const key = importRowKey(item.row);
      const available = pool.get(key) ?? [];
      const match = available.find(candidate => pass.matches(item, candidate));
      if (!match) continue;
      pool.set(key, available.filter(candidate => candidate.id !== match.id));
      assigned.set(item.row.rowIndex, { candidate: match, reason: pass.reason });
    }
  }
  return assigned;
}

/**
 * The candidates a statement's open rows are offered against: preview shows them, and execute
 * recomputes them under its locks (A-01). `ownedKeys` are identities this batch already holds.
 */
export async function assignStatementCandidates(reader: Reader, params: {
  householdId: string; userId: string; accountId: string; open: StatementRow[]; ownedKeys: ReadonlyMap<string | null, unknown>;
}): Promise<Map<number, AssignedCandidate>> {
  const { open } = params;
  if (!open.length) return new Map();
  const dates = open.map(item => item.row.dateString).sort();
  const ledger = await readLedgerCandidates(reader, { householdId: params.householdId, userId: params.userId,
    accountId: params.accountId, startDate: dates[0], endDate: dates[dates.length - 1] });
  return assignDuplicateCandidates(open, ledger.filter(candidate => !candidate.idempotencyKey || !params.ownedKeys.has(candidate.idempotencyKey)));
}
