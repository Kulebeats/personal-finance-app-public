/**
 * What an apply-to-past batch did (A-32).
 *
 * Saving a rule with "apply to past" runs the rules over every past
 * transaction the caller can see. Each row's apply is atomic (SCP-334), so a
 * row can roll back while the rest go through. The outcome says how many rows
 * changed and which rows failed and why, apart from the saved rule, so the
 * save is never reported as a full success when rows were refused.
 *
 * Only rows the caller can see are ever in the batch (the controller fetches
 * with visibility, and the batch skips another member's private row), so no
 * hidden row is counted or listed.
 *
 * @module services/rule/apply-outcome
 */
import type { Transaction } from "@shared/schema";
import { HttpError } from "../../core/errors/HttpError";

/** At most this many failed rows are listed; `failed` still counts every one. */
export const MAX_REPORTED_FAILURES = 50;

/** A failure that is not one of our own HTTP errors carries no reason worth showing. */
const UNEXPLAINED_CODE = "RULE_APPLY_FAILED";
const UNEXPLAINED_MESSAGE = "The rule could not be applied to this transaction.";

export interface RuleApplyFailure {
  transactionId: string;
  name: string;
  date: string;
  code: string;
  message: string;
}

export interface RuleApplyOutcome {
  /** Rows the rules changed. */
  updated: number;
  /** Rows whose apply rolled back. */
  failed: number;
  /** The first MAX_REPORTED_FAILURES failed rows, each with its reason. */
  failures: RuleApplyFailure[];
}

/**
 * The reason a row failed. Our own HTTP errors carry a message written for the
 * user ("Transaction is already linked to this goal"); anything else (a driver
 * or programming error) may carry internal detail, so it gets a generic reason.
 */
export function failureOf(transaction: Transaction, error: unknown): RuleApplyFailure {
  const isOwnError = error instanceof HttpError;
  return {
    transactionId: transaction.id,
    name: transaction.name,
    date: transaction.date,
    code: isOwnError ? error.code : UNEXPLAINED_CODE,
    message: isOwnError ? error.message : UNEXPLAINED_MESSAGE,
  };
}

/** The outcome after one more row: changed, unchanged, or failed. */
export function withRow(outcome: RuleApplyOutcome, row: { changed: boolean } | { failure: RuleApplyFailure }): RuleApplyOutcome {
  if (!("failure" in row)) {
    return row.changed ? { ...outcome, updated: outcome.updated + 1 } : outcome;
  }
  const failures = outcome.failures.length < MAX_REPORTED_FAILURES
    ? [...outcome.failures, row.failure]
    : outcome.failures;
  return { ...outcome, failed: outcome.failed + 1, failures };
}

export const EMPTY_OUTCOME: Readonly<RuleApplyOutcome> = { updated: 0, failed: 0, failures: [] };
