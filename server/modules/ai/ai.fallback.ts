/**
 * AI keyword fallback — the no-provider answer path.
 *
 * Extracted from `ai.service.ts`, which was already well over the 500-LOC limit
 * before the provider-failure work pushed it further (the LOC ratchet guard
 * flags exactly this). These functions are a coherent unit: they answer a
 * finance question using ONLY local analytics, with no external call.
 *
 * Reached two ways:
 *  1. No provider configured (`geminiClient.isAvailable() === false`).
 *  2. The provider WAS configured but failed at runtime — quota, outage,
 *     timeout. Before that path existed, a configured-but-failing provider
 *     returned a 500 to the user even though this serviceable answer was
 *     available the whole time.
 *
 * Pure by construction: the tool executor is injected rather than reached
 * through `this`, so the fallback can be tested without standing up the whole
 * service.
 *
 * @module ai/ai.fallback
 */

import { AI_TOOL_CALL_CAP, estimateTokens } from './ai.guardrails';
import type { GeminiToolCall } from './ai.gemini';
import { AIErrorCode, type QueryContext, type ToolResult } from './ai.types';

/**
 * Is this an EXTERNAL provider failure (as opposed to one of our own)?
 *
 * `ai.gemini.ts` normalises everything it throws into these two codes, so they
 * are the complete set of "the provider let us down" outcomes: quota/429
 * (`RATE_LIMIT_EXCEEDED`) and everything else network/API-shaped
 * (`EXTERNAL_API_ERROR`, which also covers timeouts).
 *
 * Deliberately a narrow allowlist rather than `catch (anything)`: a Zod
 * failure, a DB error, or a bug in our tool layer must NOT be silently
 * downgraded to a keyword answer — that would hide real defects behind a
 * plausible-looking reply, which is exactly the failure mode the 2026-06-04
 * audit was full of.
 */
export function isProviderFailure(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return (
    code === AIErrorCode.RATE_LIMIT_EXCEEDED ||
    code === AIErrorCode.EXTERNAL_API_ERROR
  );
}

/**
 * Determine which tools to call based on user query.
 * Simple keyword matching — the deliberate no-model path.
 */
export function determineTools(message: string): string[] {
  const lowerMessage = message.toLowerCase();
  const tools: string[] = [];

  // Keyword-based tool detection
  if (lowerMessage.includes('spend') || lowerMessage.includes('expense')) {
    tools.push('get_spending_by_category');
  }

  if (lowerMessage.includes('goal') || lowerMessage.includes('saving')) {
    tools.push('get_goals_status');
  }

  if (lowerMessage.includes('transaction') || lowerMessage.includes('recent')) {
    tools.push('get_recent_transactions');
  }

  if (lowerMessage.includes('recurring') || lowerMessage.includes('upcoming')) {
    tools.push('get_upcoming_recurring');
  }

  if (lowerMessage.includes('budget')) {
    tools.push('get_budget_status');
  }

  if (lowerMessage.includes('account') || lowerMessage.includes('balance')) {
    tools.push('get_account_balances');
  }

  // Default to spending if no matches
  if (tools.length === 0) {
    tools.push('get_spending_by_category');
  }

  return tools;
}

/**
 * Generate a response from tool results without a model.
 * Template-based; operates on ALREADY-SANITIZED tool data.
 */
export function generateFallbackResponse(
  query: string,
  toolResults: ToolResult[],
  currency: string
): string {
  const successful = toolResults.filter(r => r.success);

  if (successful.length === 0) {
    return "I'm sorry, I couldn't retrieve the information you requested. Please try again.";
  }

  // Simple response generation
  let response = 'Based on your financial data:\n\n';

  for (const result of successful) {
    if (!result.data) continue;

    const data = result.data as Record<string, unknown>;

    // Handle different data types
    if (data.categories && Array.isArray(data.categories)) {
      const topCategories = data.categories.slice(0, 5) as Array<{ name: string; amount: string; count: number }>;
      response += 'Top spending categories:\n';
      topCategories.forEach((cat) => {
        response += `- ${cat.name}: ${currency} ${cat.amount} (${cat.count} transactions)\n`;
      });
      response += `\nTotal: ${currency} ${data.total}\n\n`;
    }

    if (data.goals && Array.isArray(data.goals)) {
      response += 'Your goals:\n';
      (data.goals as Array<{ name: string; progressPercent: number; currentAmount: string; targetAmount: string }>).forEach((goal) => {
        response += `- ${goal.name}: ${goal.progressPercent}% complete (${currency} ${goal.currentAmount} of ${currency} ${goal.targetAmount})\n`;
      });
      response += '\n';
    }

    if (data.transactions && Array.isArray(data.transactions)) {
      response += `Recent transactions (${data.transactions.length}):\n`;
      (data.transactions.slice(0, 5) as Array<{ date: string; description: string; amount: string }>).forEach((txn) => {
        response += `- ${txn.date}: ${txn.description} - ${currency} ${txn.amount}\n`;
      });
      response += '\n';
    }
  }

  return response.trim();
}

export interface KeywordFallbackResult {
  reply: string;
  toolsToCall: string[];
  executedToolCalls: GeminiToolCall[];
  tokenCount: number;
  dataSanitized: boolean;
}

/**
 * Run the full keyword path: pick tools, execute them, template a reply.
 *
 * `executeTool` is injected (the service passes its own sanitizing executor) so
 * this stays independent of AIService. All tools here are read-only analytics,
 * so re-running them after a failed provider attempt is idempotent.
 */
export async function runKeywordFallback(
  userMessage: string,
  context: QueryContext,
  requestTokenBudget: number,
  executeTool: (toolName: string, context: QueryContext) => Promise<ToolResult>
): Promise<KeywordFallbackResult> {
  const toolsToCall = determineTools(userMessage).slice(0, AI_TOOL_CALL_CAP);
  const executedToolCalls: GeminiToolCall[] = toolsToCall.map((name) => ({
    name,
    args: {}
  }));

  let dataSanitized = true;
  const toolResults: ToolResult[] = [];

  for (const toolName of toolsToCall) {
    const result = await executeTool(toolName, context);
    if (result.sanitized === false) {
      dataSanitized = false;
    }
    toolResults.push(result);
  }

  const reply = generateFallbackResponse(userMessage, toolResults, context.currency);

  return {
    reply,
    toolsToCall,
    executedToolCalls,
    tokenCount: Math.min(
      requestTokenBudget,
      estimateTokens(userMessage) + estimateTokens(reply)
    ),
    dataSanitized
  };
}
