/**
 * Owner ruling (21 Nov): the built-in per-question token budget is 8000.
 *
 * On staging, Claude's first step alone (system prompt + all tool
 * declarations + the question) used 2,583 input tokens, so the old default
 * of 2000 left nothing for the answer stage and every question failed with
 * "shorten the question". These tests keep a realistic question inside the
 * default, so the prompt or the tool list cannot outgrow it silently.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_REQUEST_TOKEN_BUDGET } from "../ai.guardrails";
import { AI_TOOL_DEFINITIONS, buildAnswerPrompt, buildSystemPrompt } from "../ai.tool-definitions";
import { estimatePromptTokens } from "../ai.provider.types";

/** The adapters' output cap per call (ai.claude.ts / ai.gemini.ts), unchanged by the ruling. */
const ANSWER_OUTPUT_CAP = 1024;
/**
 * Staging, 21 Nov, prompt v1.2.0, claude-sonnet-5-5 ("hello" -> account balances):
 * analysis 2583 in + 126 out; answer 627 in + 371 out.
 */
const OBSERVED_FIRST_STEP_TOKENS = 2583 + 126;
const OBSERVED_ANSWER_PROMPT_TOKENS = 627;
/**
 * The characters/4 heuristic the guard uses counted that first step as about
 * 1,505 tokens: real usage was 1.7x. Estimates below are doubled to stay
 * on the safe side of that gap.
 */
const ESTIMATE_UNDERCOUNT_MARGIN = 2;
const QUESTION = "What are my account balances and how much did I spend this month?";

/** A full account-balances result at the sanitiser's limit of 20 accounts. */
function fullBalancesResult() {
  const accounts = Array.from({ length: 20 }, (_, index) => ({
    type: "checking", name: `checking_${index + 1}`, balance: "1234567.89", isActive: true,
  }));
  return [{ name: "get_account_balances", result: { accounts } }];
}

describe("the built-in per-question token budget", () => {
  it("is 8000", () => {
    expect(DEFAULT_AI_REQUEST_TOKEN_BUDGET).toBe(8000);
  });

  it("fits the first step measured on staging plus a full answer stage", () => {
    const remainingAfterFirstStep = DEFAULT_AI_REQUEST_TOKEN_BUDGET - OBSERVED_FIRST_STEP_TOKENS;

    expect(remainingAfterFirstStep).toBeGreaterThanOrEqual(OBSERVED_ANSWER_PROMPT_TOKENS + ANSWER_OUTPUT_CAP);
  });

  it("fits today's system prompt, every tool declaration and a full answer stage, with margin for the estimate", () => {
    const system = buildSystemPrompt();
    const firstStep = estimatePromptTokens(system)
      + estimatePromptTokens(JSON.stringify(AI_TOOL_DEFINITIONS))
      + estimatePromptTokens(QUESTION);
    const answerStage = estimatePromptTokens(system)
      + estimatePromptTokens(buildAnswerPrompt(QUESTION, fullBalancesResult(), "ZMW"));
    const worstCase = (firstStep + answerStage) * ESTIMATE_UNDERCOUNT_MARGIN + 2 * ANSWER_OUTPUT_CAP;

    expect(worstCase).toBeLessThanOrEqual(DEFAULT_AI_REQUEST_TOKEN_BUDGET);
  });
});
