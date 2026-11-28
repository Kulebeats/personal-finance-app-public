import type { APIRequestContext, Page } from "@playwright/test";
import { test } from "../protected-test";
import type { SubmitStep } from "./submit";
import { isMutationRun, mutationEvidence, setCorruptStep } from "./read-back";

/**
 * QA-01 / R20.2: a persistence test plus its mutants.
 *
 * Normal run: defines `title` running `body`. Mutation run
 * (`PFA_E2E_MUTATION=each-step`): defines instead one `mutant: corrupt <step>`
 * per `corrupt` step, each running the same `body` with that step's write sent
 * with a wrong value. scripts/e2e-mutation-check.mjs runs only the mutants and
 * fails CI if one stays green.
 *
 * Each corrupt step's read-back is declared in the spec with
 * `readBack(step, expected, observers)`. A red mutant is credited as killed
 * only when the server accepted the corrupted write and that read-back
 * observed the corrupted value everywhere it looked (see read-back.ts); the
 * kill annotation records the observed and expected values. Any other outcome
 * is annotated `mutation-invalid`, which also fails the check.
 *
 * There is no skip operator: a skipped submit can only ever fail in the
 * submit's own response wait, before any read-back runs, so it could never
 * show that a read-back depends on the write.
 */
export interface MutantPlan {
  corrupt?: readonly SubmitStep[];
  timeoutMs?: number;
}

export const MUTATION_INVALID = "mutation-invalid";
export const MUTATION_KILLED_BY = "mutation-killed-by";

/** The test's page, and its own `request` fixture (an API context apart from the page's cookies). */
export type MutantBody = (page: Page, request: APIRequestContext) => Promise<void>;

export function testWithMutants(title: string, plan: MutantPlan, body: MutantBody): void {
  if (!isMutationRun()) {
    test(title, async ({ page, request }, testInfo) => {
      if (plan.timeoutMs) testInfo.setTimeout(plan.timeoutMs);
      await body(page, request);
    });
    return;
  }
  for (const step of plan.corrupt ?? []) {
    test(`mutant: corrupt ${step.name} submit`, async ({ page, request }, testInfo) => {
      if (plan.timeoutMs) testInfo.setTimeout(plan.timeoutMs);
      setCorruptStep(step.name);
      let failure: { error: unknown } | undefined;
      try {
        await body(page, request);
      } catch (error) {
        failure = { error };
        throw error;
      } finally {
        const evidence = mutationEvidence(step, failure);
        if (evidence && "invalid" in evidence) testInfo.annotations.push({ type: MUTATION_INVALID, description: evidence.invalid });
        else if (evidence) testInfo.annotations.push({ type: MUTATION_KILLED_BY, description: evidence.killedBy });
        setCorruptStep(null);
      }
    });
  }
}
