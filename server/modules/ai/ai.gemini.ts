/**
 * Gemini API Client
 *
 * Handles communication with Google's Gemini 2.0 Flash API.
 * - Function calling for tool execution
 * - Response generation from tool results
 * - Timeout and error handling
 *
 * @module ai/ai.gemini
 */

import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type Tool,
  type GenerateContentCandidate,
  type Content,
} from "@google/generative-ai";
import { logger } from "../../utils/logger";
import { AIErrorCode } from "./ai.types";

// ============================================================================
// CONFIGURATION
// ============================================================================

const GEMINI_MODEL = "gemini-2.0-flash";
const REQUEST_TIMEOUT_MS = 10000; // 10 second timeout per requirements
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const MIN_OUTPUT_TOKENS = 64;

export const AI_SYSTEM_PROMPT_VERSION = "v1.1.0";

// ============================================================================
// TOOL DEFINITIONS FOR GEMINI FUNCTION CALLING
// ============================================================================

/**
 * Tool definitions in Gemini function calling format.
 * These describe what each tool does so Gemini can decide when to call them.
 */
const TOOL_DEFINITIONS: FunctionDeclaration[] = [
  {
    name: "get_spending_by_category",
    description:
      "Get spending breakdown by category for a specified time period. Use this to answer questions about where money is being spent, expense patterns, or category-level spending analysis.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        period: {
          type: SchemaType.STRING,
          format: "enum",
          description:
            'Time period for analysis: "7d" (last 7 days), "30d" (last 30 days), "90d" (last 90 days), or "12m" (last 12 months)',
          enum: ["7d", "30d", "90d", "12m"],
        },
      },
      required: ["period"],
    },
  },
  {
    name: "get_budget_status",
    description:
      "Get current budget status showing how much is budgeted vs spent per category. Use this to answer questions about budget progress, remaining budget, or if the user is over/under budget.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        month: {
          type: SchemaType.STRING,
          description:
            "Month in YYYY-MM format. Defaults to current month if not specified.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_goals_status",
    description:
      "Get progress status for all savings goals. Use this to answer questions about goal progress, savings targets, or how close goals are to completion.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        includeCompleted: {
          type: SchemaType.BOOLEAN,
          description: "Whether to include completed goals. Defaults to false.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_upcoming_recurring",
    description:
      "Get upcoming recurring transactions (bills, subscriptions, regular expenses). Use this to answer questions about upcoming bills, scheduled payments, or recurring costs.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        days: {
          type: SchemaType.NUMBER,
          description: "Number of days to look ahead. Defaults to 30.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_recent_transactions",
    description:
      "Get the most recent transactions. Use this to answer questions about recent spending, latest purchases, or transaction history.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: {
          type: SchemaType.NUMBER,
          description:
            "Maximum number of transactions to return. Defaults to 20.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_account_balances",
    description:
      "Get current balance for all accounts. Use this to answer questions about account balances, total assets, or financial position.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        includeArchived: {
          type: SchemaType.BOOLEAN,
          description:
            "Whether to include archived/closed accounts. Defaults to false.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_merchant_spending",
    description:
      "Get spending aggregated by merchant. Use this to answer questions about spending at specific stores, top merchants, or where money goes by vendor.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        period: {
          type: SchemaType.STRING,
          format: "enum",
          description: 'Time period: "30d", "90d", or "12m"',
          enum: ["30d", "90d", "12m"],
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum merchants to return. Defaults to 20.",
        },
      },
      required: ["period"],
    },
  },
  {
    name: "get_category_trends",
    description:
      "Get spending trends over time for categories. Use this to answer questions about spending patterns over months, whether spending is increasing/decreasing, or historical category analysis.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        months: {
          type: SchemaType.NUMBER,
          description: "Number of months to analyze. Defaults to 6.",
        },
        categoryId: {
          type: SchemaType.STRING,
          description:
            "Optional specific category to analyze. If not provided, analyzes all categories.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_monthly_summary",
    description:
      "Get income vs expenses summary for a month. Use this to answer questions about monthly finances, savings rate, net income, or overall financial health for a month.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        month: {
          type: SchemaType.STRING,
          description: "Month in YYYY-MM format. Defaults to current month.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_transaction_search",
    description:
      "Search transactions by various filters. Use this to find specific transactions, search by merchant, category, date range, or amount.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        text: {
          type: SchemaType.STRING,
          description: "Text to search in transaction descriptions",
        },
        categoryId: {
          type: SchemaType.STRING,
          description: "Filter by category ID",
        },
        merchantId: {
          type: SchemaType.STRING,
          description: "Filter by merchant ID",
        },
        dateFrom: {
          type: SchemaType.STRING,
          description: "Start date in YYYY-MM-DD format",
        },
        dateTo: {
          type: SchemaType.STRING,
          description: "End date in YYYY-MM-DD format",
        },
        minAmount: {
          type: SchemaType.STRING,
          description: "Minimum transaction amount",
        },
        maxAmount: {
          type: SchemaType.STRING,
          description: "Maximum transaction amount",
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum results. Defaults to 20.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_goal_assignments",
    description:
      "Get which accounts are linked to savings goals. Use this to answer questions about goal funding sources or account-goal relationships.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_cash_flow",
    description:
      "Get projected cash flow for upcoming months. Use this to answer questions about future finances, projected balance, or cash flow forecasts.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        months: {
          type: SchemaType.NUMBER,
          description: "Number of months to project. Defaults to 3.",
        },
      },
      required: [],
    },
  },
];

export const GEMINI_TOOL_NAMES = TOOL_DEFINITIONS.map((tool) => tool.name);

export const AI_SYSTEM_PROMPT_TEMPLATE = `You are Thandiso, a helpful AI assistant for personal finance. You help users understand their financial data including spending, budgets, goals, and transactions.

GUIDELINES:
1. Only use the available tools to get financial data - never make up numbers
2. Be concise but helpful in your responses
3. When showing money amounts, use the household's currency
4. If data is empty or unavailable, say so clearly
5. Never give specific financial advice - just present the data
6. Add "Note: This is not financial advice" when discussing significant financial decisions
7. Respect user privacy - don't ask for sensitive information

AVAILABLE TOOLS:
- get_spending_by_category: Spending breakdown by category
- get_budget_status: Budget progress per category
- get_goals_status: Savings goal progress
- get_upcoming_recurring: Upcoming bills and subscriptions
- get_recent_transactions: Recent transaction history
- get_account_balances: Account balance summary
- get_merchant_spending: Spending by merchant
- get_category_trends: Spending trends over time
- get_monthly_summary: Monthly income vs expenses
- get_transaction_search: Search transactions by filters
- get_goal_assignments: Goal-account relationships
- get_cash_flow: Cash flow projections`;

// ============================================================================
// TYPES
// ============================================================================

export interface GeminiToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiResponse {
  toolCalls: GeminiToolCall[];
  textResponse?: string;
  tokenCount: number;
}

/**
 * A prior conversation turn replayed as model context (OPEN-3).
 * `user` = the household member, `model` = a previous assistant reply.
 */
export interface GeminiPriorTurn {
  role: "user" | "model";
  text: string;
}

export interface GeminiCallOptions {
  tokenBudget?: number;
  maxOutputTokens?: number;
  /**
   * Prior turns, OLDEST FIRST, already capped, injection-re-scanned and
   * budget-trimmed by `ai.guardrails.selectHistoryTurns`. This client does not
   * re-trim them; it only places them ahead of the current message.
   */
  priorTurns?: GeminiPriorTurn[];
}

export interface GeminiError {
  code: AIErrorCode;
  message: string;
  retryable: boolean;
}

// ============================================================================
// GEMINI CLIENT CLASS
// ============================================================================

export class GeminiClient {
  private client: GoogleGenerativeAI | null = null;
  private model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]> | null =
    null;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize the Gemini client with API key.
   */
  private initialize(): void {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      logger.warn("GEMINI_API_KEY not set - AI features will be disabled");
      return;
    }

    try {
      this.client = new GoogleGenerativeAI(apiKey);
      this.model = this.client.getGenerativeModel({
        model: GEMINI_MODEL,
        generationConfig: {
          maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          temperature: 0.2, // Low temperature for more deterministic responses
        },
        tools: [
          {
            functionDeclarations: TOOL_DEFINITIONS,
          },
        ] as Tool[],
      });

      logger.info("Gemini client initialized", { model: GEMINI_MODEL });
    } catch (error) {
      logger.error("Failed to initialize Gemini client", { error });
    }
  }

  /**
   * Check if the client is available.
   */
  isAvailable(): boolean {
    return this.model !== null;
  }

  /**
   * Analyze user query and determine which tools to call.
   * Returns tool calls that should be executed.
   */
  async analyzeQuery(
    userMessage: string,
    options: GeminiCallOptions = {},
  ): Promise<GeminiResponse> {
    if (!this.model) {
      throw this.createError(
        AIErrorCode.EXTERNAL_API_ERROR,
        "Gemini client not initialized",
        false,
      );
    }

    const startTime = Date.now();

    try {
      const systemPrompt = this.buildSystemPrompt();
      const tokenBudget = this.resolveTokenBudget(options.tokenBudget);
      const priorTurns = options.priorTurns ?? [];
      // The current message and system prompt are checked against the budget
      // WITHOUT history: history has already been trimmed to fit inside the
      // remainder, and it must never be able to starve the current message.
      const estimatedPromptTokens =
        this.estimateTokens(systemPrompt) + this.estimateTokens(userMessage);

      if (estimatedPromptTokens >= tokenBudget) {
        logger.warn("Gemini analyze skipped due to token budget", {
          tokenBudget,
          estimatedPromptTokens,
        });

        return {
          toolCalls: [],
          textResponse:
            "I need a shorter question to stay within the request budget.",
          tokenCount: tokenBudget,
        };
      }

      // Start chat with system context, then any prior conversation turns
      // (OPEN-3) so follow-up questions like "what about last month?" resolve.
      const chat = this.model.startChat({
        history: this.buildContents(systemPrompt, priorTurns),
      });

      // Send user message with timeout
      const response = await this.withTimeout(
        chat.sendMessage(userMessage),
        REQUEST_TIMEOUT_MS,
      );

      const result = response.response;
      const candidate = result.candidates?.[0];

      if (!candidate) {
        throw this.createError(
          AIErrorCode.EXTERNAL_API_ERROR,
          "No response from Gemini",
          true,
        );
      }

      const { toolCalls, textResponse } = this.processCandidate(candidate);

      // Estimate token count
      const estimatedTokenCount =
        this.estimateTokens(userMessage) +
        this.estimateTokens(textResponse || "") +
        toolCalls.length * 50; // Approximate tokens for tool calls
      const tokenCount = Math.min(estimatedTokenCount, tokenBudget);

      logger.debug("Gemini query analyzed", {
        toolCalls: toolCalls.map((tc) => tc.name),
        hasTextResponse: !!textResponse,
        tokenCount,
        latencyMs: Date.now() - startTime,
      });

      return {
        toolCalls,
        textResponse,
        tokenCount,
      };
    } catch (error) {
      this.handleError(error, startTime);
      throw error; // reachable only if handleError re-throws, which it usually does
    }
  }

  /**
   * Process the Gemini response candidate to extract tool calls and text.
   */
  private processCandidate(candidate: GenerateContentCandidate): {
    toolCalls: GeminiToolCall[];
    textResponse?: string;
  } {
    // Extract function calls
    const toolCalls: GeminiToolCall[] = [];
    let textResponse: string | undefined;

    for (const part of candidate.content.parts) {
      if ("functionCall" in part && part.functionCall) {
        toolCalls.push({
          name: part.functionCall.name,
          args: part.functionCall.args as Record<string, unknown>,
        });
      } else if ("text" in part && part.text) {
        textResponse = part.text;
      }
    }
    return { toolCalls, textResponse };
  }

  private handleError(error: unknown, startTime: number): void {
    const latency = Date.now() - startTime;
    logger.error("Gemini query failed", { error, latencyMs: latency });

    if (error instanceof Error && "code" in error) {
      throw error; // Re-throw our own errors
    }

    // Handle timeout
    if (error instanceof Error && error.message.includes("timeout")) {
      throw this.createError(
        AIErrorCode.EXTERNAL_API_ERROR,
        "Request timed out",
        true,
      );
    }

    // Handle rate limiting
    if (error instanceof Error && error.message.includes("429")) {
      throw this.createError(
        AIErrorCode.RATE_LIMIT_EXCEEDED,
        "Gemini API rate limit exceeded",
        true,
      );
    }

    throw this.createError(
      AIErrorCode.EXTERNAL_API_ERROR,
      error instanceof Error ? error.message : "Unknown error",
      true,
    );
  }

  /**
   * Generate a natural language response from tool results.
   */
  async generateResponse(
    userMessage: string,
    toolResults: Array<{ name: string; result: unknown }>,
    currency: string,
    options: GeminiCallOptions = {},
  ): Promise<{ response: string; tokenCount: number }> {
    if (!this.model) {
      throw this.createError(
        AIErrorCode.EXTERNAL_API_ERROR,
        "Gemini client not initialized",
        false,
      );
    }

    const startTime = Date.now();

    try {
      const systemPrompt = this.buildSystemPrompt();
      const tokenBudget = this.resolveTokenBudget(options.tokenBudget);

      // Format tool results for the model
      const toolResultsText = toolResults
        .map(
          (tr) =>
            `Tool: ${tr.name}\nResult: ${JSON.stringify(tr.result, null, 2)}`,
        )
        .join("\n\n");

      const fullPrompt = `${systemPrompt}

User question: ${userMessage}

Tool results:
${toolResultsText}

Based on the tool results above, provide a helpful, accurate answer to the user's question. Use the currency ${currency} when displaying amounts. Be concise but complete.`;

      const promptTokens = this.estimateTokens(fullPrompt);
      if (promptTokens >= tokenBudget) {
        return {
          response:
            "I need a shorter question or narrower date range to stay within the response budget.",
          tokenCount: tokenBudget,
        };
      }

      const remainingBudget = tokenBudget - promptTokens;
      const requestedMaxOutputTokens = options.maxOutputTokens ?? remainingBudget;
      const maxOutputTokens = Math.max(
        MIN_OUTPUT_TOKENS,
        Math.min(DEFAULT_MAX_OUTPUT_TOKENS, requestedMaxOutputTokens, remainingBudget),
      );

      // Generate response with timeout
      const response = await this.withTimeout(
        this.model.generateContent({
          contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
          generationConfig: {
            maxOutputTokens,
            temperature: 0.2,
          },
        }),
        REQUEST_TIMEOUT_MS,
      );

      const result = response.response;
      const text = result.text();

      const estimatedTokenCount = promptTokens + this.estimateTokens(text);
      const tokenCount = Math.min(estimatedTokenCount, tokenBudget);

      logger.debug("Gemini response generated", {
        responseLength: text.length,
        tokenCount,
        latencyMs: Date.now() - startTime,
      });

      return {
        response: text,
        tokenCount,
      };
    } catch (error) {
      logger.error("Gemini response generation failed", { error });

      if (error instanceof Error && "code" in error) {
        throw error;
      }

      throw this.createError(
        AIErrorCode.EXTERNAL_API_ERROR,
        error instanceof Error ? error.message : "Unknown error",
        true,
      );
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Build the provider `contents` array: the system-prompt priming pair,
   * followed by prior conversation turns in oldest-first order (OPEN-3).
   *
   * Prior turns arrive already capped, injection-re-scanned and budget-trimmed
   * (see `ai.guardrails.selectHistoryTurns`); this is purely assembly. Exposed
   * (internal) so tests can assert the exact shape that leaves the household
   * boundary.
   */
  buildContents(
    systemPrompt: string,
    priorTurns: GeminiPriorTurn[] = [],
  ): Content[] {
    const contents: Content[] = [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      {
        role: "model",
        parts: [
          {
            text: "Understood. I will help answer financial questions using the available tools and follow all guidelines.",
          },
        ],
      },
    ];

    for (const turn of priorTurns) {
      contents.push({ role: turn.role, parts: [{ text: turn.text }] });
    }

    return contents;
  }

  /**
   * Token cost of the system prompt. The service reserves this alongside the
   * current message before deciding how much history can fit in the budget.
   */
  estimateSystemPromptTokens(): number {
    return this.estimateTokens(this.buildSystemPrompt());
  }

  /**
   * Build system prompt with guidelines.
   */
  private buildSystemPrompt(): string {
    return `Prompt version: ${AI_SYSTEM_PROMPT_VERSION}\n${AI_SYSTEM_PROMPT_TEMPLATE}`;
  }

  /**
   * Wrap a promise with a timeout.
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Estimate token count from text.
   * Rough approximation: ~4 characters per token.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private resolveTokenBudget(tokenBudget?: number): number {
    if (!tokenBudget || tokenBudget <= 0) {
      return 2000;
    }

    return tokenBudget;
  }

  /**
   * Create a structured error.
   */
  private createError(
    code: AIErrorCode,
    message: string,
    retryable: boolean,
  ): GeminiError & Error {
    const error = new Error(message) as GeminiError & Error;
    error.code = code;
    error.retryable = retryable;
    return error;
  }
}

// Export singleton instance
export const geminiClient = new GeminiClient();
