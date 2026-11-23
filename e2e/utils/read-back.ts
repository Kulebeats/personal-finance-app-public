import { test } from "@playwright/test";
import type { SubmitStep } from "./submit";
import { sameValue, withCurrencyOf } from "./money-value";

/**
 * Mutation evidence for the QA-01 / R20.2 corrupt mutants (see submit.ts and
 * mutants.ts). A read-back reports the value it OBSERVED for the mutated field
 * in each place it looks (the database, the API, the rendered page), and the
 * verdict comes from those values, not from whichever exception was thrown:
 *
 * - every observed value equals the expected one: the read-back passes (in a
 *   mutant run that is a survivor, which fails the check);
 * - every observed value equals the corrupted one the mutant sent: KILL, the
 *   read-back saw the wrong value and refused it;
 * - anything else (a value that is neither, or one observed but another not,
 *   or an error before a value was observed: an error view, a timeout, a
 *   database error): INVALID, it proves nothing about the mutation.
 */

/** One reader per place the field is read back; each returns the value it found. */
export type Observers = Readonly<Record<string, () => Promise<string>>>;

interface Rewrite { step: string; original: string; corrupted: string; status: number | null }
type VerdictKind = "kill" | "unobserved" | "unexplained";
interface Verdict { step: string; kind: VerdictKind; detail: string; error: unknown }

/** The submit step whose write the running mutant corrupts, or null. */
let corruptStep: string | null = null;
let rewrite: Rewrite | null = null;
let verdict: Verdict | null = null;

/** Set by a mutant test before it runs its body; `null` runs every submit unchanged. */
export function setCorruptStep(stepName: string | null): void {
  corruptStep = stepName;
  rewrite = null;
  verdict = null;
}

export const isMutationRun = (): boolean => process.env.PFA_E2E_MUTATION === "each-step";
export const isCorruptStep = (step: SubmitStep): boolean => corruptStep === step.name;
export const hasRewrite = (): boolean => rewrite !== null;

export function recordRewrite(step: SubmitStep, original: string, corrupted: string): void {
  rewrite = { step: step.name, original, corrupted, status: null };
}

export function recordRewriteStatus(status: number): void {
  if (rewrite) rewrite = { ...rewrite, status };
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n").find((line) => line.trim() !== "")?.trim() ?? "(no message)";
}

async function observeAll(observers: Observers): Promise<[string, string][]> {
  const observed: [string, string][] = [];
  for (const [source, observe] of Object.entries(observers)) {
    try {
      observed.push([source, (await observe()).trim()]);
    } catch (error) {
      throw new Error(`${source} was never observed: ${firstLine(error)}`, { cause: error });
    }
  }
  return observed;
}

function judge(step: SubmitStep, expected: string, observed: [string, string][]): { kind: VerdictKind; detail: string } {
  const summary = observed.map(([source, value]) => `${source}=${JSON.stringify(value)}`).join(", ");
  const current = rewrite?.step === step.name ? rewrite : null;
  // A bare request amount is sent with its currency in another field; the
  // mutant changes only the amount, so it is read in the expected currency.
  const original = current ? withCurrencyOf(current.original, expected) : null;
  const corrupted = current ? withCurrencyOf(current.corrupted, expected) : null;
  const isKill = original !== null && corrupted !== null && sameValue(original, expected)
    && observed.every(([, value]) => sameValue(value, corrupted));
  if (isKill) return { kind: "kill", detail: `observed ${summary}; expected ${JSON.stringify(expected)}` };
  const sent = current ? `, nor the corrupted ${JSON.stringify(corrupted)} (sent for ${JSON.stringify(original)})` : "";
  return { kind: "unexplained", detail: `observed ${summary}: not the expected ${JSON.stringify(expected)} everywhere${sent}` };
}

/**
 * The read-back of `step`'s field: every observer must find `expected`. It
 * throws when one does not, and records whether that failure is the mutant's
 * corrupted value (a kill) or something else.
 */
export async function readBack(step: SubmitStep, expected: string, observers: Observers): Promise<void> {
  // Set inside the step's callback; a holder, so the catch below sees it.
  const outcome: { pending: { kind: VerdictKind; detail: string } | null } = { pending: null };
  try {
    await test.step(`read-back: ${step.name}`, async () => {
      let observed: [string, string][];
      try {
        observed = await observeAll(observers);
      } catch (error) {
        outcome.pending = { kind: "unobserved", detail: firstLine(error) };
        throw error;
      }
      if (observed.every(([, value]) => sameValue(value, expected))) return;
      const judged = judge(step, expected, observed);
      outcome.pending = judged;
      throw new Error(`read-back ${step.name}: ${judged.detail}`);
    });
  } catch (error) {
    if (outcome.pending && !verdict) verdict = { step: step.name, ...outcome.pending, error };
    throw error;
  }
}

export type MutationEvidence = { invalid: string } | { killedBy: string } | null;

/**
 * What the running mutant proved: `killedBy` when its read-back saw the
 * corrupted value, `invalid` when the run cannot count either way, `null`
 * for a survivor (it passed with its corruption accepted by the server).
 */
export function mutationEvidence(step: SubmitStep, failure: { error: unknown } | undefined): MutationEvidence {
  const current = rewrite?.step === step.name ? rewrite : null;
  if (!current) return { invalid: `${step.name}: no ${step.method} request body had field "${step.corruptField ?? "(none)"}"` };
  if (current.status === null) return { invalid: `${step.name}: the corrupted request got no response` };
  if (current.status < 200 || current.status > 299) {
    return { invalid: `${step.name}: the server rejected the corrupted write (HTTP ${current.status}), so the read-back was never tested` };
  }
  if (!failure) return null;
  if (!verdict || verdict.step !== step.name || verdict.error !== failure.error) {
    return { invalid: `${step.name}: failed outside its read-back: ${firstLine(failure.error)}` };
  }
  if (verdict.kind === "kill") return { killedBy: `read-back: ${step.name}: ${verdict.detail}` };
  return { invalid: `${step.name}: read-back ${verdict.kind}: ${verdict.detail}` };
}
