/**
 * R17 (Astra #255 r3/r4): the fixed non-answers an "unavailable" outcome may
 * carry, and the minimal body a stored replay of one keeps.
 *
 * @module ai/ai.non-answers
 */
import { CANCELLED_REPLY, INVALID_REQUEST_REPLY, NO_DATA_REPLY, REFUSAL_REPLY } from "./ai.provider-orchestrator";
import type { ChatResponse } from "./ai.types";

/** The reply to a prompt-injection attempt (persisted to the thread, never answered). */
export const BLOCKED_PROMPT_REPLY =
  "I can only help with household finance questions and cannot process instruction-override requests.";

const FIXED_NON_ANSWERS: ReadonlySet<string> = new Set([
  NO_DATA_REPLY,
  REFUSAL_REPLY,
  INVALID_REQUEST_REPLY,
  CANCELLED_REPLY,
  BLOCKED_PROMPT_REPLY,
]);

/**
 * A stored "unavailable" replay: the fixed non-answer and nothing about the
 * request. No tool names, provenance, tokens, provider or conversation id; a
 * client that gets no id keeps the thread it already has.
 */
export function fixedNonAnswer(reply: string): ChatResponse {
  return {
    reply: FIXED_NON_ANSWERS.has(reply) ? reply : NO_DATA_REPLY,
    toolsUsed: [],
    tokenCount: 0,
    remainingQueries: 0,
    answerMode: "unavailable",
    providers: { analysis: null, answer: null },
  };
}
