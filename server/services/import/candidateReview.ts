/**
 * A-01 on the import wizard: execute does not trust the preview's candidate list.
 *
 * Under its locks, execute recomputes the duplicate candidates exactly as the
 * preview does. Each one needs a decision bound to the ledger row it matches
 * now: a skip (`skipRows`) or a post (`postRows`), each naming that
 * candidate's id. A candidate with neither (it appeared after the preview, or
 * now matches a different row) refuses the whole file with a 409 and the
 * fresh list, before any write. A skip is bound the same way (R2-01): a skip,
 * bound or bare, for a row whose reviewed candidate changed or disappeared is
 * refused too, so no row is left out against a match the member never saw.
 */
import { ConflictError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";
import { assignStatementCandidates, type AssignedCandidate, type CandidateReason } from "./candidates";
import { storedMatch, type StatementRow } from "./statement";

export interface CandidatePostDecision { ordinal: number; candidateId: string }

export interface ImportReviewCandidate {
  ordinal: number;
  candidate: { id: string; name: string; date: string; amount: string; reason: CandidateReason };
}

export class ImportReviewRequiredError extends ConflictError {
  readonly candidates: ImportReviewCandidate[];

  constructor(candidates: ImportReviewCandidate[]) {
    super("Some rows may repeat a transaction already in your ledger and need a decision. Review the import again; nothing was imported.");
    this.candidates = candidates;
  }

  toJSON() {
    const response = super.toJSON();
    return { ...response, error: { ...response.error, code: "IMPORT_REVIEW_REQUIRED", details: { candidates: this.candidates } } };
  }
}

/** Rows that neither replay a stored identity nor repeat an earlier row of the same file: the preview's "new" rows. */
export function openStatementRows(statement: StatementRow[], byKey: ReadonlyMap<string | null, unknown>): StatementRow[] {
  const seen = new Set<string>();
  return statement.filter(item => {
    const open = !storedMatch(byKey, item) && !seen.has(item.idempotencyKey);
    seen.add(item.idempotencyKey);
    return open;
  });
}

const toReviewCandidate = ([ordinal, match]: [number, AssignedCandidate]): ImportReviewCandidate => ({
  ordinal, candidate: { id: match.candidate.id, name: match.candidate.name, date: match.candidate.date,
    amount: match.candidate.amount, reason: match.reason },
});

export async function assertCandidatesReviewed(tx: TransactionType, params: {
  householdId: string; userId: string; accountId: string; statement: StatementRow[];
  byKey: ReadonlyMap<string | null, unknown>; skipOrdinals: ReadonlySet<number>;
  skipRows: readonly CandidatePostDecision[]; postRows: readonly CandidatePostDecision[];
}): Promise<Set<number>> {
  const open = openStatementRows(params.statement, params.byKey);
  const assigned = await assignStatementCandidates(tx, { householdId: params.householdId, userId: params.userId,
    accountId: params.accountId, open, ownedKeys: params.byKey });
  const bound = (rows: readonly CandidatePostDecision[]) => new Map(rows.map(item => [item.ordinal, item.candidateId.toLowerCase()]));
  const skipped = bound(params.skipRows);
  const posted = bound(params.postRows);
  const current = (ordinal: number) => assigned.get(ordinal)?.candidate.id.toLowerCase();
  const undecided = Array.from(assigned.keys()).some(ordinal =>
    skipped.get(ordinal) !== current(ordinal) && posted.get(ordinal) !== current(ordinal));
  const openOrdinals = new Set(open.map(item => item.row.rowIndex));
  const staleSkip = [...params.skipOrdinals, ...skipped.keys()].some(ordinal =>
    openOrdinals.has(ordinal) && (current(ordinal) === undefined || skipped.get(ordinal) !== current(ordinal)));
  if (undecided || staleSkip) {
    throw new ImportReviewRequiredError(Array.from(assigned).map(toReviewCandidate).sort((a, b) => a.ordinal - b.ordinal));
  }
  // Only open rows are skipped; a replayed or repeated row is already a duplicate.
  return new Set(Array.from(skipped.keys()).filter(ordinal => openOrdinals.has(ordinal)));
}
