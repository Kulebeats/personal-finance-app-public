/**
 * Canonical Thandi tool definitions and system prompt (R17.1, AI-01).
 *
 * One provider-neutral source: the tool schemas are plain JSON Schema, and each
 * adapter derives its own declaration shape from them (Claude `input_schema`,
 * Gemini `FunctionDeclaration`). Both providers therefore see the same
 * allow-list and the same argument contract; the application still validates
 * every proposed call with the Zod schemas in `ai.validation.ts` before any
 * query runs. A provider's tool call is a proposal, never an authorisation.
 *
 * @module ai/ai.tool-definitions
 */

import { redactOutboundText } from "./ai.outbound-redaction";

export type JsonSchemaPrimitive = "string" | "number" | "boolean";

export interface JsonSchemaProperty {
  type: JsonSchemaPrimitive;
  description: string;
  enum?: readonly string[];
}

export interface CanonicalToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Readonly<Record<string, JsonSchemaProperty>>;
    required: readonly string[];
  };
}

function tool(
  name: string,
  description: string,
  properties: Record<string, JsonSchemaProperty> = {},
  required: string[] = [],
): CanonicalToolDefinition {
  return { name, description, inputSchema: { type: "object", properties, required } };
}

export const AI_TOOL_DEFINITIONS: readonly CanonicalToolDefinition[] = [
  tool(
    "get_spending_by_category",
    "Get spending breakdown by category for a specified time period. Use this to answer questions about where money is being spent, expense patterns, or category-level spending analysis.",
    {
      period: {
        type: "string",
        description:
          'Time period for analysis: "7d" (last 7 days), "30d" (last 30 days), "90d" (last 90 days), or "12m" (last 12 months)',
        enum: ["7d", "30d", "90d", "12m"],
      },
    },
    ["period"],
  ),
  tool(
    "get_budget_status",
    "Get current budget status showing how much is budgeted vs spent per category. Use this to answer questions about budget progress, remaining budget, or if the user is over/under budget.",
    { month: { type: "string", description: "Month in YYYY-MM format. Defaults to current month if not specified." } },
  ),
  tool(
    "get_goals_status",
    "Get progress status for all savings goals. Use this to answer questions about goal progress, savings targets, or how close goals are to completion.",
    { includeCompleted: { type: "boolean", description: "Whether to include completed goals. Defaults to false." } },
  ),
  tool(
    "get_upcoming_recurring",
    "Get upcoming recurring transactions (bills, subscriptions, regular expenses). Use this to answer questions about upcoming bills, scheduled payments, or recurring costs.",
    { days: { type: "number", description: "Number of days to look ahead. Defaults to 30." } },
  ),
  tool(
    "get_recent_transactions",
    "Get the most recent transactions. Use this to answer questions about recent spending, latest purchases, or transaction history.",
    { limit: { type: "number", description: "Maximum number of transactions to return. Defaults to 20." } },
  ),
  tool(
    "get_account_balances",
    "Get current balance for all accounts. Use this to answer questions about account balances, total assets, or financial position.",
    { includeArchived: { type: "boolean", description: "Whether to include archived/closed accounts. Defaults to false." } },
  ),
  tool(
    "get_merchant_spending",
    "Get spending aggregated by merchant. Use this to answer questions about spending at specific stores, top merchants, or where money goes by vendor.",
    {
      period: { type: "string", description: 'Time period: "30d", "90d", or "12m"', enum: ["30d", "90d", "12m"] },
      limit: { type: "number", description: "Maximum merchants to return. Defaults to 20." },
    },
    ["period"],
  ),
  tool(
    "get_category_trends",
    "Get spending trends over time for categories. Use this to answer questions about spending patterns over months, whether spending is increasing/decreasing, or historical category analysis.",
    {
      months: { type: "number", description: "Number of months to analyze. Defaults to 6." },
      categoryId: {
        type: "string",
        description: "Optional specific category to analyze. If not provided, analyzes all categories.",
      },
    },
  ),
  tool(
    "get_monthly_summary",
    "Get income vs expenses summary for a month. Use this to answer questions about monthly finances, savings rate, net income, or overall financial health for a month.",
    { month: { type: "string", description: "Month in YYYY-MM format. Defaults to current month." } },
  ),
  tool(
    "get_transaction_search",
    "Search transactions by various filters. Use this to find specific transactions, search by merchant, category, date range, or amount.",
    {
      text: { type: "string", description: "Text to search in transaction descriptions" },
      categoryId: { type: "string", description: "Filter by category ID" },
      merchantId: { type: "string", description: "Filter by merchant ID" },
      dateFrom: { type: "string", description: "Start date in YYYY-MM-DD format" },
      dateTo: { type: "string", description: "End date in YYYY-MM-DD format" },
      minAmount: { type: "string", description: "Minimum transaction amount" },
      maxAmount: { type: "string", description: "Maximum transaction amount" },
      limit: { type: "number", description: "Maximum results. Defaults to 20." },
    },
  ),
  tool(
    "get_goal_assignments",
    "Get which accounts are linked to savings goals. Use this to answer questions about goal funding sources or account-goal relationships.",
  ),
  tool(
    "get_cash_flow",
    "Forecast monthly cash flow and balances in the household currency. Null amounts are unavailable.",
    { months: { type: "number", description: "Number of months to project. Defaults to 3." } },
  ),
];

export const AI_TOOL_NAMES: readonly string[] = AI_TOOL_DEFINITIONS.map((definition) => definition.name);

export const AI_SYSTEM_PROMPT_VERSION = "v1.4.3";

export const AI_SYSTEM_PROMPT_TEMPLATE = `You are Thandi, Capital's friendly assistant for spending, budgets, goals, accounts, bills and cash flow.

HOW TO ANSWER:
1. Be warm and conversational. Lead with the answer, then add useful detail.
2. Use a few sentences or a short list, **bold** for key figures, "- " bullets, and a small table for comparisons. No headings.
3. Only use the available tools to get financial data and never make up numbers. If data is empty or unavailable, say so and suggest what to look at.
4. Use the household currency unless a result gives an amount its own currency, such as an account's "currency". Never add amounts in different currencies.
5. Refer to each account by its exact label, such as checking_1.
6. You can read data only. For setup requests, help plan from the user's data and say where in the app to act (Goals, Budget, Transactions, Accounts or Recurring).
7. When helpful, end with one short suggestion.
8. Present the data without specific financial advice. Add "Note: This is not financial advice" for significant financial decisions.
9. Respect user privacy. Never ask for sensitive information.

AVAILABLE TOOLS:
${AI_TOOL_DEFINITIONS.map((definition) => `- ${definition.name}`).join("\n")}`;

/** The full system prompt both adapters send, version-stamped for audit. */
export function buildSystemPrompt(): string {
  return `Prompt version: ${AI_SYSTEM_PROMPT_VERSION}\n${AI_SYSTEM_PROMPT_TEMPLATE}`;
}

// Free-text labels can contain identifiers even after tool data is minimized.
// Work on individual values so money, dates, and codes keep their exact form.
const TOOL_LABEL_FIELDS = new Set(["name", "category", "categoryName", "description", "goalName", "accountName"]);

function redactToolLabel(field: string, value: unknown): unknown {
  return typeof value === "string" && TOOL_LABEL_FIELDS.has(field) ? redactOutboundText(value).text : value;
}

/** Both providers render tool results here, including results from older caches. */
export function buildAnswerPrompt(
  userMessage: string,
  toolResults: ReadonlyArray<{ name: string; result: unknown }>,
  currency: string,
): string {
  const toolResultsText = toolResults
    .map((entry) => `Tool: ${entry.name}\nResult: ${JSON.stringify(entry.result, redactToolLabel, 2)}`)
    .join("\n\n");

  return `User question: ${userMessage}

Tool results:
${toolResultsText}

Answer from the tool results. Be brief and conversational, and lead with the answer. Display amounts in ${currency} unless the result specifies their currency. Report null financial values as unavailable and omit rankings marked unavailable.`;
}
