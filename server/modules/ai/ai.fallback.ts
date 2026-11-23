/**
 * AI keyword fallback: the local degraded mode (R17.1, AI-04).
 *
 * Answers a finance question using ONLY local analytics, with no external
 * call. Reached when no external provider is configured, or when every
 * eligible provider failed. The reply is always labelled as a limited local
 * summary, and when the keywords match no tool, or no tool returns renderable
 * data, the result is `useful: false` so the caller reports "unavailable"
 * rather than a success-shaped or irrelevant answer.
 *
 * Pure by construction: the tool executor is injected, so the fallback runs
 * through the same validated, sanitising, visibility-scoped tool layer as the
 * provider path.
 *
 * @module ai/ai.fallback
 */

import { AI_TOOL_CALL_CAP, estimateTokens } from './ai.guardrails';
import { renderLocalSummary } from './ai.local-templates';
import type { ProviderToolCall } from './ai.provider.types';
import { AIErrorCode, type QueryContext, type ToolResult } from './ai.types';

/**
 * Is this an EXTERNAL provider failure (as opposed to one of our own)?
 *
 * Adapters throw `ProviderError`, whose `code` is one of these two values.
 * A Zod failure, a DB error, or a bug in our tool layer must NOT be silently
 * downgraded to a keyword answer.
 */
export function isProviderFailure(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return (
    code === AIErrorCode.RATE_LIMIT_EXCEEDED ||
    code === AIErrorCode.EXTERNAL_API_ERROR
  );
}

/** Keyword → tool. Order matters only for the AI_TOOL_CALL_CAP truncation. */
const KEYWORD_TOOLS: ReadonlyArray<{ pattern: RegExp; tool: string }> = [
  { pattern: /spend|spent|expense/, tool: 'get_spending_by_category' },
  { pattern: /budget/, tool: 'get_budget_status' },
  { pattern: /goal|saving/, tool: 'get_goals_status' },
  { pattern: /transaction|recent|purchase/, tool: 'get_recent_transactions' },
  { pattern: /recurring|upcoming|bill|subscription/, tool: 'get_upcoming_recurring' },
  { pattern: /account|balance/, tool: 'get_account_balances' },
  { pattern: /merchant|store|shop|vendor/, tool: 'get_merchant_spending' },
  { pattern: /cash ?flow|forecast|projection/, tool: 'get_cash_flow' },
  { pattern: /income|net savings|monthly summary/, tool: 'get_monthly_summary' },
  { pattern: /trend/, tool: 'get_category_trends' },
];

export const LOCAL_MODE_HELP =
  'Thandi is running in limited local mode and could not match your question to the data it can summarise. ' +
  'Try asking about your spending, budgets, goals, recent transactions, upcoming bills or account balances.';

export const LOCAL_MODE_NO_DATA =
  "Thandi is running in limited local mode and couldn't retrieve the information for your question. Please try again later.";

/** Select tools by keyword. No match returns no tools: never a default guess. */
export function determineTools(message: string): string[] {
  const lowerMessage = message.toLowerCase();
  const tools: string[] = [];
  for (const { pattern, tool } of KEYWORD_TOOLS) {
    if (pattern.test(lowerMessage) && !tools.includes(tool)) tools.push(tool);
  }
  return tools;
}

/**
 * Template a reply from ALREADY-SANITISED tool results, or null when nothing
 * renderable came back.
 */
export function generateFallbackResponse(
  toolResults: ToolResult[],
  currency: string,
  providerAttempted = false
): string | null {
  const sanitisedData = toolResults
    .filter((result) => result.success && result.sanitized !== false && result.data !== undefined)
    .map((result) => result.data);
  return renderLocalSummary(sanitisedData, currency, providerAttempted);
}

export interface KeywordFallbackResult {
  reply: string;
  /** True only when the reply carries rendered data. False → "unavailable". */
  useful: boolean;
  toolsToCall: string[];
  executedToolCalls: ProviderToolCall[];
  tokenCount: number;
  dataSanitized: boolean;
}

/**
 * Run the full keyword path: pick tools, execute them, template a reply.
 * All tools here are read-only analytics, so re-running them after a failed
 * provider analysis is idempotent.
 */
export async function runKeywordFallback(
  userMessage: string,
  context: QueryContext,
  requestTokenBudget: number,
  executeTool: (toolName: string, context: QueryContext) => Promise<ToolResult>,
  providerAttempted = false
): Promise<KeywordFallbackResult> {
  const toolsToCall = determineTools(userMessage).slice(0, AI_TOOL_CALL_CAP);
  const executedToolCalls: ProviderToolCall[] = toolsToCall.map((name) => ({ name, args: {} }));

  let dataSanitized = true;
  const toolResults: ToolResult[] = [];
  for (const toolName of toolsToCall) {
    const result = await executeTool(toolName, context);
    if (result.sanitized === false) {
      dataSanitized = false;
    }
    toolResults.push(result);
  }

  const rendered = generateFallbackResponse(toolResults, context.currency, providerAttempted);
  const reply = rendered ?? (toolsToCall.length === 0 ? LOCAL_MODE_HELP : LOCAL_MODE_NO_DATA);

  return {
    reply,
    useful: rendered !== null,
    toolsToCall,
    executedToolCalls,
    tokenCount: Math.min(requestTokenBudget, estimateTokens(userMessage) + estimateTokens(reply)),
    dataSanitized
  };
}
