/**
 * What saving a rule with "apply to past" did (A-32).
 *
 * The server returns the saved rule and, apart from it, the apply outcome:
 * how many past transactions the rules changed, how many failed, and why each
 * listed one failed (server/services/rule/apply-outcome.ts). A save whose
 * apply refused rows is reported as a warning naming those rows, never as a
 * plain success.
 */
import { toast } from "sonner";

export interface RuleApplyFailure {
  transactionId: string;
  name: string;
  date: string;
  code: string;
  message: string;
}

export interface RuleApplyOutcome {
  updated: number;
  failed: number;
  failures: RuleApplyFailure[];
}

/** Rows named in the toast; the rest are summed up as "and N more". */
const ROWS_SHOWN = 3;
/** A warning that lists rows stays up long enough to read. */
const WARNING_DURATION_MS = 12_000;

function transactions(count: number): string {
  return `${count} past transaction${count === 1 ? "" : "s"}`;
}

function updatedLine(updated: number): string {
  return updated === 0 ? "No past transactions were changed." : `Applied to ${transactions(updated)}.`;
}

function failureLines(outcome: RuleApplyOutcome): string[] {
  const shown = outcome.failures.slice(0, ROWS_SHOWN).map((row) => `${row.name} (${row.date}): ${row.message}`);
  const more = outcome.failed - shown.length;
  return more > 0 ? [...shown, `and ${more} more.`] : shown;
}

/** The text of the save toast, for a rule that was "created" or "updated". */
export function ruleSaveMessage(verb: "created" | "updated", applied?: RuleApplyOutcome) {
  if (!applied) return { kind: "success" as const, title: `Rule ${verb} successfully` };
  if (applied.failed === 0) {
    return { kind: "success" as const, title: `Rule ${verb} successfully`, description: updatedLine(applied.updated) };
  }
  return {
    kind: "warning" as const,
    title: `Rule ${verb}, but ${transactions(applied.failed)} could not be changed`,
    description: [updatedLine(applied.updated), ...failureLines(applied)].join(" "),
  };
}

export function announceRuleSave(verb: "created" | "updated", applied?: RuleApplyOutcome): void {
  const message = ruleSaveMessage(verb, applied);
  if (message.kind === "warning") {
    toast.warning(message.title, { description: message.description, duration: WARNING_DURATION_MS });
    return;
  }
  if (message.description) {
    toast.success(message.title, { description: message.description });
    return;
  }
  toast.success(message.title);
}
