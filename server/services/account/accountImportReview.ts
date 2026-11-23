/**
 * A-01: an Account Detail import posts nothing while a row may repeat a
 * transaction already on the account (one posted through the import wizard,
 * say) and the member has not decided on it.
 *
 * A decision is bound to the match the member was shown: the row and the id
 * of the transaction it matched. Matches are recomputed under the account's
 * import lock on every attempt; a flagged row with no decision for its CURRENT
 * match refuses the whole file again, with the fresh list. Rows repeated inside
 * one file are never matched against each other (NEW-17).
 */
import type { MoneyDto } from "@shared/money";
import { ConflictError } from "../../core/errors";
import { Money } from "../../core/money";
import type { LedgerCandidate } from "../import/candidates";

export type AccountImportDecisionKind = "post" | "skip";

export interface AccountImportDecision {
  row: number;
  matchesTransactionId: string;
  decision: AccountImportDecisionKind;
}

export interface AccountImportReviewItem {
  row: number;
  matchesTransactionId: string;
  match: { name: string; date: string; type: string; amount: MoneyDto };
}

export class AccountImportReviewRequiredError extends ConflictError {
  readonly possibleDuplicates: AccountImportReviewItem[];

  constructor(possibleDuplicates: AccountImportReviewItem[]) {
    super("Some rows may repeat a transaction already on this account. Choose to post or skip each one; nothing was imported.");
    this.possibleDuplicates = possibleDuplicates;
  }

  toJSON() {
    const response = super.toJSON();
    return { ...response, error: { ...response.error, code: "IMPORT_REVIEW_REQUIRED", details: { possibleDuplicates: this.possibleDuplicates } } };
  }
}

/**
 * Every flagged row needs a decision for its CURRENT match. A skip is bound the
 * same way (R2-01): a skip for an open row that no longer has a match (its
 * reviewed transaction was deleted, edited away or hidden) is stale and refuses
 * the file again, exactly as a stale post does.
 */
export function decidedSkips(
  flagged: ReadonlyMap<number, LedgerCandidate>, decisions: readonly AccountImportDecision[], open: ReadonlySet<number>,
): Set<number> | undefined {
  const byRow = new Map(decisions.map(decision => [decision.row, decision]));
  for (const [row, match] of flagged) {
    const decision = byRow.get(row);
    if (!decision || decision.matchesTransactionId.toLowerCase() !== match.id.toLowerCase()) return undefined;
  }
  const skips = Array.from(byRow.values()).filter(decision => decision.decision === "skip" && open.has(decision.row));
  if (skips.some(decision => !flagged.has(decision.row))) return undefined;
  return new Set(skips.map(decision => decision.row));
}

/** Format the same actor-visible rows used to identify the matches. */
export function reviewItems(flagged: ReadonlyMap<number, LedgerCandidate>): AccountImportReviewItem[] {
  return Array.from(flagged, ([row, match]) => ({
    row,
    matchesTransactionId: match.id,
    match: { name: match.name, date: match.date, type: match.type,
      amount: { amount: new Money(match.amount, match.currency).toString(), currency: match.currency } },
  })).sort((a, b) => a.row - b.row);
}
