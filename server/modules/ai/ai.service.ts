/**
 * AI Service
 *
 * FIX AI-ARCH-001: Service layer for AI logic (not in controller)
 * FIX AI-AUDIT-001: Comprehensive audit logging for all AI queries
 * FIX AI-DATA-001: Data sanitization before sending to external API
 *
 * Core orchestrator for AI assistant functionality.
 * - Manages Gemini API interactions for tool selection and response generation
 * - Executes tool calls via analytics service
 * - Logs all queries to audit trail
 * - Sanitizes data before external API calls
 *
 * @module ai/ai.service
 */

import { randomUUID } from 'crypto';
import { db } from '../../db';
import { households } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { businessAuditService } from '../../services/BusinessAuditService';
import { AIConversationService } from './ai.conversation.service';
import { InternalError } from '../../core/errors';
import { logger } from '../../utils/logger';
import { AIAnalyticsService } from './ai.analytics.service';
import { geminiClient, type GeminiToolCall } from './ai.gemini';
import { aiCache } from './ai.cache';
import { aiTracking } from './ai.tracking';
import {
  AI_TOOL_CALL_CAP,
  detectPromptInjection,
  deriveDataWindowFromToolCalls,
  enforceToolAllowlist,
  estimateTokens,
  getContextMaxMessages,
  getRequestTokenBudget,
  hardenUserMessage,
  selectHistoryTurns,
  type HistorySelection
} from './ai.guardrails';
import { sanitizeToolResult } from './ai.sanitizer';
import { isProviderFailure, runKeywordFallback } from './ai.fallback';
import {
  validateToolArgs,
  spendingByCategoryArgsSchema,
  recentTransactionsArgsSchema,
  upcomingRecurringArgsSchema,
  merchantSpendingArgsSchema,
  categoryTrendsArgsSchema,
  monthlySummaryArgsSchema,
  transactionSearchArgsSchema,
  cashFlowArgsSchema
} from './ai.validation';
import {
  AIErrorCode,
  type ChatResponse,
  type QueryContext,
  type ResponseProvenance,
  type ToolResult
} from './ai.types';

const BLOCKED_PROMPT_REPLY =
  'I can only help with household finance questions and cannot process instruction-override requests.';
const TOKEN_BUDGET_REPLY =
  'I could not complete that request within the token budget. Please shorten the question or narrow the time range.';

/**
 * AI Service Class (FIX AI-ARCH-001)
 * Encapsulates all AI logic in a dedicated service layer.
 */
export class AIService {
  private analyticsService: AIAnalyticsService;
  private auditService: typeof businessAuditService;
  private conversationService: AIConversationService;

  constructor() {
    this.analyticsService = new AIAnalyticsService();
    this.auditService = businessAuditService;
    this.conversationService = new AIConversationService();
  }

  /**
   * Process user query with AI assistant.
   *
   * FIX AI-AUDIT-001: Logs all queries to audit trail
   * FIX AI-DATA-001: Sanitizes data before sending to external API
   */
  async processQuery(params: {
    userId: string;
    householdId: string;
    message: string;
    conversationId?: string;
    ipAddress?: string;
  }): Promise<ChatResponse> {
    const { userId, householdId, message, ipAddress } = params;
    // SCP-338: The conversation id is now a persisted UUID, not an ephemeral
    // per-request string. It is resolved when the exchange is written to the
    // store (existing thread reused, or a new one created), so the client can
    // pass it back on the next request and history accumulates across requests.
    let conversationId = params.conversationId ?? '';
    const startTime = Date.now();
    let cacheHit = false;
    const requestTokenBudget = getRequestTokenBudget();
    const hardenedMessage = hardenUserMessage(message);

    // Track query sent
    aiTracking.trackQuerySent({
      householdId,
      userId,
      messageLength: hardenedMessage.value.length,
      hasSessionContext: !!params.conversationId
    });

    try {
      const injectionAssessment = detectPromptInjection(hardenedMessage.value);
      if (injectionAssessment.blocked) {
        aiTracking.trackPromptInjectionBlocked({
          householdId,
          userId,
          ruleId: injectionAssessment.ruleId || 'unknown_rule',
          messageLength: hardenedMessage.value.length
        });

        // SCP-338: Persist the blocked exchange too, so the conversation thread
        // is an honest record of what was asked and how the assistant replied.
        conversationId = await this.persistExchange({
          householdId,
          userId,
          conversationId: params.conversationId,
          userMessage: hardenedMessage.value,
          assistantReply: BLOCKED_PROMPT_REPLY,
          toolsUsed: []
        });

        await this.auditService.log({
          householdId,
          userId,
          action: 'CREATE',
          entityType: 'ai_query',
          entityId: conversationId,
          details: {
            query: hardenedMessage.value.substring(0, 200),
            blocked: true,
            blocked_reason: injectionAssessment.ruleId,
            execution_time_ms: Date.now() - startTime
          },
          ipAddress
        });

        return {
          reply: BLOCKED_PROMPT_REPLY,
          conversationId,
          toolsUsed: [],
          tokenCount: Math.min(
            requestTokenBudget,
            estimateTokens(hardenedMessage.value)
          ),
          remainingQueries: 0,
          provenance: this.buildProvenance([])
        };
      }

      // Get household currency
      const currency = await this.getHouseholdCurrency(householdId);

      // Create query context
      const context: QueryContext = {
        userId,
        householdId,
        currency,
        ipAddress
      };

      let toolsToCall: string[] = [];
      let executedToolCalls: GeminiToolCall[] = [];
      let reply: string;
      // SCP-313: Track the REAL sanitization outcome. True only if every tool
      // that executed routed its data through the sanitizer. Used for an honest
      // `data_sanitized` audit value instead of a hardcoded `true`.
      let dataSanitized = true;
      // OPEN-3: what prior context (if any) was actually replayed to the
      // provider. Recorded in the audit row for DPA visibility.
      let historySelection: HistorySelection = {
        turns: [],
        historyTokens: 0,
        dropped: []
      };
      let tokenCount = Math.min(
        requestTokenBudget,
        estimateTokens(hardenedMessage.value)
      );
      // Provenance of the REPLY: true only when the provider actually produced
      // it. Previously this was read off `geminiClient.isAvailable()` at audit
      // time — the CONFIGURATION state — which attested a keyword-generated
      // reply as provider-generated whenever a key happened to be set.
      let usedGemini = false;
      // Separate from the above on purpose: a failed call still TRANSMITTED the
      // message to the processor, so DPA visibility needs both facts. Flipping
      // only `used_gemini` would swap one inaccuracy for another.
      let providerAttempted = false;
      let providerErrorCode: string | undefined;

      // Use Gemini if available, otherwise fall back to keyword matching
      if (geminiClient.isAvailable()) {
        providerAttempted = true;
        try {
          // OPEN-3: replay prior turns so follow-ups ("what about last month?")
          // resolve. Fail-closed: unowned/absent conversation ids yield none.
          historySelection = await this.loadHistoryForContext({
            householdId,
            userId,
            conversationId: params.conversationId,
            currentMessage: hardenedMessage.value,
            tokenBudget: requestTokenBudget
          });

          const geminiAnalysis = await geminiClient.analyzeQuery(
            hardenedMessage.value,
            {
              tokenBudget: requestTokenBudget,
              priorTurns: historySelection.turns
            }
          );
          tokenCount = Math.min(requestTokenBudget, geminiAnalysis.tokenCount);

          const toolSelection = enforceToolAllowlist(
            geminiAnalysis.toolCalls,
            AI_TOOL_CALL_CAP
          );
          executedToolCalls = toolSelection.allowedCalls;
          toolsToCall = executedToolCalls.map(tc => tc.name);

          if (toolSelection.blockedCalls.length > 0 || toolSelection.droppedByCap.length > 0) {
            const ruleId = toolSelection.blockedCalls.length > 0
              ? 'tool_allowlist_violation'
              : 'tool_cap_enforced';

            aiTracking.trackPromptInjectionBlocked({
              householdId,
              userId,
              ruleId,
              messageLength: hardenedMessage.value.length
            });

            logger.warn('AI tool selection guardrails applied', {
              householdId,
              userId,
              blockedTools: toolSelection.blockedCalls.map(call => call.name),
              droppedByCap: toolSelection.droppedByCap.map(call => call.name)
            });
          }

          // Execute tools with args from Gemini. Only sanitized data is ever
          // collected into toolResults (which feed the external Gemini prompt).
          const toolResults: Array<{ name: string; result: unknown }> = [];
          for (const toolCall of executedToolCalls) {
            const result = await this.executeToolWithArgs(toolCall.name, toolCall.args, context);
            // Any executed tool whose data was not sanitized makes the overall
            // attestation false, even if its data is then withheld.
            if (result.sanitized === false) {
              dataSanitized = false;
            }
            if (result.success && result.data && result.sanitized) {
              toolResults.push({ name: toolCall.name, result: result.data });
            }
          }

          const remainingBudget = Math.max(0, requestTokenBudget - tokenCount);

          // Generate response from tool results using Gemini
          if (toolResults.length > 0 && remainingBudget > 0) {
            const geminiResponse = await geminiClient.generateResponse(
              hardenedMessage.value,
              toolResults,
              currency,
              {
                tokenBudget: remainingBudget,
                maxOutputTokens: remainingBudget
              }
            );
            reply = geminiResponse.response;
            tokenCount = Math.min(
              requestTokenBudget,
              tokenCount + geminiResponse.tokenCount
            );
          } else if (toolResults.length > 0 && remainingBudget === 0) {
            reply = TOKEN_BUDGET_REPLY;
          } else if (geminiAnalysis.textResponse) {
            // Use direct text response if no tools were called
            reply = geminiAnalysis.textResponse;
          } else {
            reply = "I couldn't find the data needed to answer your question. Please try rephrasing or ask about spending, budgets, goals, or transactions.";
          }
          usedGemini = true;
        } catch (error) {
          // Only a PROVIDER failure degrades. Anything else (our own bugs,
          // validation, DB errors) must still surface — swallowing those would
          // turn a real defect into a silently worse answer.
          if (!isProviderFailure(error)) {
            throw error;
          }

          providerErrorCode = (error as { code?: string }).code;

          logger.warn('AI provider failed - degrading to keyword fallback', {
            householdId,
            userId,
            providerError: providerErrorCode,
            message: error instanceof Error ? error.message : 'Unknown error'
          });

          // Nothing the provider produced is usable now; recompute from
          // scratch so the audit row describes the reply we actually return.
          historySelection = { turns: [], historyTokens: 0, dropped: [] };
          const fallback = await runKeywordFallback(
            hardenedMessage.value,
            context,
            requestTokenBudget,
            (toolName, ctx) => this.executeTool(toolName, ctx)
          );
          toolsToCall = fallback.toolsToCall;
          executedToolCalls = fallback.executedToolCalls;
          reply = fallback.reply;
          tokenCount = fallback.tokenCount;
          dataSanitized = fallback.dataSanitized;
        }
      } else {
        // No provider configured: keyword fallback is the only path.
        const fallback = await runKeywordFallback(
          hardenedMessage.value,
          context,
          requestTokenBudget,
          (toolName, ctx) => this.executeTool(toolName, ctx)
        );
        toolsToCall = fallback.toolsToCall;
        executedToolCalls = fallback.executedToolCalls;
        reply = fallback.reply;
        tokenCount = fallback.tokenCount;
        dataSanitized = fallback.dataSanitized;
      }

      const provenance = this.buildProvenance(executedToolCalls);

      // SCP-338: Persist the user message + assistant reply BEFORE auditing so
      // the audit row references the real, stable conversation id. This is what
      // makes history survive across requests: the returned id is reused when
      // the client sends it back on the next chat call.
      conversationId = await this.persistExchange({
        householdId,
        userId,
        conversationId: params.conversationId,
        userMessage: hardenedMessage.value,
        assistantReply: reply,
        toolsUsed: toolsToCall
      });

      // FIX AI-AUDIT-001: Log to audit trail
      await this.auditService.log({
        householdId,
        userId,
        action: 'CREATE',
        entityType: 'ai_query',
        entityId: conversationId,
        details: {
          query: hardenedMessage.value.substring(0, 200), // Truncate for audit log
          tools_used: toolsToCall,
          response_summary: reply.substring(0, 200),
          token_count: tokenCount,
          token_budget: requestTokenBudget,
          prompt_hardened: hardenedMessage.wasModified,
          // OPEN-3 / Rule 9: exactly how much prior context left the household
          // boundary on this request, post-trim.
          context_messages: historySelection.turns.length,
          context_tokens: historySelection.historyTokens,
          context_dropped_injection: historySelection.dropped.filter(
            drop => drop.reason === 'injection'
          ).length,
          context_dropped_budget: historySelection.dropped.filter(
            drop => drop.reason === 'budget'
          ).length,
          provenance,
          execution_time_ms: Date.now() - startTime,
          data_sanitized: dataSanitized,
          // Provenance of THIS reply, not whether a key is configured.
          used_gemini: usedGemini,
          // A failed attempt still transmitted the message to the processor,
          // so DPA review can see egress happened even when the answer did not
          // come from the provider.
          provider_attempted: providerAttempted,
          provider_error: providerErrorCode
        },
        ipAddress
      });

      const latencyMs = Date.now() - startTime;

      logger.info('AI query processed', {
        householdId,
        userId,
        conversationId,
        toolsUsed: toolsToCall,
        tokenCount,
        executionTime: latencyMs,
        usedGemini,
        providerError: providerErrorCode
      });

      // Track query success
      aiTracking.trackQuerySuccess({
        householdId,
        userId,
        toolsUsed: toolsToCall,
        tokenCount,
        latencyMs,
        cacheHit,
        usedGemini
      });

      return {
        reply,
        conversationId,
        toolsUsed: toolsToCall,
        tokenCount,
        remainingQueries: 0, // Will be set by controller from rate limit headers
        provenance
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorCode = (error as { code?: string }).code || 'UNKNOWN_ERROR';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Log error
      logger.error('AI query failed', {
        error,
        householdId,
        userId,
        message: hardenedMessage.value.substring(0, 100)
      });

      // Track query failure
      aiTracking.trackQueryFailed({
        householdId,
        userId,
        errorCode,
        errorMessage,
        latencyMs
      });

      // FIX AI-AUDIT-001: Log failure to audit trail. `entityId` is a uuid
      // column; if the request failed before a conversation was persisted, fall
      // back to a fresh uuid so the audit row is still written (SCP-338).
      await this.auditService.log({
        householdId,
        userId,
        action: 'CREATE',
        entityType: 'ai_query',
        entityId: conversationId || randomUUID(),
        details: {
          query: hardenedMessage.value.substring(0, 200),
          error: errorMessage,
          execution_time_ms: latencyMs,
          success: false
        },
        ipAddress
      });

      throw new InternalError('Failed to process AI query');
    }
  }

  /**
   * Execute a specific tool (fallback mode without Gemini args).
   * FIX AI-DATA-001: Sanitizes data before returning.
   */
  private async executeTool(
    toolName: string,
    context: QueryContext
  ): Promise<ToolResult> {
    // Use default args for fallback mode
    return this.executeToolWithArgs(toolName, {}, context);
  }

  /**
   * Execute a tool with specific arguments from Gemini.
   * FIX AI-DATA-001: Sanitizes data before returning.
   * Uses caching for cacheable tools.
   */
  private async executeToolWithArgs(
    toolName: string,
    args: Record<string, unknown>,
    context: QueryContext
  ): Promise<ToolResult> {
    try {
      // SCP-314: Gemini is untrusted. Validate its tool args with the tool's
      // Zod schema BEFORE they reach any SQL filter (ILIKE / gte / lte / eq) or
      // the cache key. On failure, reject cleanly with a model-visible error and
      // run no query - never cast raw model args into a filter.
      const validation = validateToolArgs(toolName, args);
      if (!validation.ok) {
        logger.warn('AI tool args rejected by validation', {
          toolName,
          householdId: context.householdId,
          reason: validation.error
        });

        return {
          success: false,
          error: validation.error
        };
      }

      const validatedArgs = validation.args;

      // Check cache first for cacheable tools (L1 in-process + L2 Redis).
      // Cache stores ALREADY-SANITIZED data, so a cache hit is safe to forward.
      // Key off the VALIDATED args so cache identity matches what is queried.
      if (aiCache.isCacheable(toolName)) {
        const cacheKey = aiCache.generateKey(context.householdId, toolName, validatedArgs);
        const cachedResult = await aiCache.getAsync<unknown>(cacheKey);

        if (cachedResult !== null) {
          logger.debug('Tool result from cache', {
            toolName,
            householdId: context.householdId
          });

          return {
            success: true,
            data: cachedResult,
            sanitized: true
          };
        }
      }

      // Fetch the RAW result from the analytics layer using ONLY validated args.
      // This still contains internal identifiers and raw names and MUST NOT be
      // forwarded as-is (the sanitizer below handles egress; SCP-313).
      const rawData = await this.fetchToolData(toolName, validatedArgs, context);
      if (rawData === undefined) {
        return {
          success: false,
          error: `Unknown tool: ${toolName}`
        };
      }

      // SCP-313: Route EVERY tool's result through the central sanitizer before
      // it can reach the external Gemini prompt. Fail closed if no sanitizer
      // branch exists for the tool.
      const sanitizedOutput = sanitizeToolResult(toolName, rawData, context.currency);

      if (!sanitizedOutput.sanitized) {
        logger.error('AI tool result has no sanitizer - data withheld', {
          toolName,
          householdId: context.householdId
        });

        return {
          success: false,
          error: `No sanitizer registered for tool: ${toolName}`,
          sanitized: false
        };
      }

      const data = sanitizedOutput.data;

      // Cache the SANITIZED result for cacheable tools (writes L1 + L2 Redis).
      if (aiCache.isCacheable(toolName)) {
        const cacheKey = aiCache.generateKey(context.householdId, toolName, validatedArgs);
        await aiCache.setAsync(cacheKey, data);
      }

      logger.debug('Tool executed', {
        toolName,
        householdId: context.householdId,
        sanitized: sanitizedOutput.sanitized,
        args: validatedArgs,
        cached: aiCache.isCacheable(toolName)
      });

      return {
        success: true,
        data,
        sanitized: sanitizedOutput.sanitized
      };
    } catch (error) {
      logger.error('Tool execution failed', {
        toolName,
        error,
        context,
        args
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed'
      };
    }
  }

  /**
   * Fetch the RAW (unsanitized) result for a tool from the analytics layer.
   *
   * SCP-314: `args` arrives ALREADY validated by `validateToolArgs` in
   * `executeToolWithArgs`. Each branch re-parses with the tool's own Zod schema
   * to obtain fully typed, defaulted values WITHOUT casting raw model input into
   * a query filter. The re-parse cannot fail here (same schema already passed),
   * but it is what gives each value its narrow type at zero risk.
   *
   * This method ONLY queries data; it never forwards anything externally. Its
   * output is always passed through the central sanitizer by the caller before
   * it can reach the Gemini prompt (SCP-313). Returns `undefined` for an
   * unknown tool so the caller can surface a clear error.
   */
  private async fetchToolData(
    toolName: string,
    args: Record<string, unknown>,
    context: QueryContext
  ): Promise<unknown> {
    switch (toolName) {
      case 'get_spending_by_category': {
        const { period } = spendingByCategoryArgsSchema.parse(args);
        return this.analyticsService.getSpendingByCategory(context, period);
      }

      case 'get_goals_status':
        return this.analyticsService.getGoalsStatus(context);

      case 'get_recent_transactions': {
        const { limit } = recentTransactionsArgsSchema.parse(args);
        return this.analyticsService.getRecentTransactions(context, limit);
      }

      case 'get_upcoming_recurring': {
        const { days } = upcomingRecurringArgsSchema.parse(args);
        return this.analyticsService.getUpcomingRecurring(context, days);
      }

      case 'get_budget_status':
        return this.analyticsService.getBudgetStatus(context);

      case 'get_account_balances':
        return this.analyticsService.getAccountBalances(context);

      case 'get_merchant_spending': {
        const { period, limit } = merchantSpendingArgsSchema.parse(args);
        return this.analyticsService.getMerchantSpending(context, period, limit);
      }

      case 'get_category_trends': {
        const { months, categoryId } = categoryTrendsArgsSchema.parse(args);
        return this.analyticsService.getCategoryTrends(context, months, categoryId);
      }

      case 'get_monthly_summary': {
        const { month } = monthlySummaryArgsSchema.parse(args);
        return this.analyticsService.getMonthlySummary(context, month);
      }

      case 'get_transaction_search': {
        const search = transactionSearchArgsSchema.parse(args);
        return this.analyticsService.searchTransactions(context, {
          text: search.text,
          categoryId: search.categoryId,
          merchantId: search.merchantId,
          dateFrom: search.dateFrom,
          dateTo: search.dateTo,
          minAmount: search.minAmount,
          maxAmount: search.maxAmount,
          limit: search.limit
        });
      }

      case 'get_goal_assignments':
        return this.analyticsService.getGoalAssignments(context);

      case 'get_cash_flow': {
        const { months: cashFlowMonths } = cashFlowArgsSchema.parse(args);
        return this.analyticsService.getCashFlow(context, cashFlowMonths);
      }

      default:
        return undefined;
    }
  }

  private buildProvenance(toolCalls: GeminiToolCall[]): ResponseProvenance {
    return {
      dataWindow: deriveDataWindowFromToolCalls(toolCalls),
      freshnessTs: new Date().toISOString(),
      tools: Array.from(new Set(toolCalls.map((toolCall) => toolCall.name)))
    };
  }

  /**
   * Get household currency for Money formatting
   */
  private async getHouseholdCurrency(householdId: string): Promise<string> {
    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
      columns: {
        currency: true
      }
    });

    return household?.currency || 'ZMW';
  }

  /**
   * SCP-338: Persist a user message + assistant reply to the conversation store
   * and return the stable conversation id to reuse on the next request.
   * Delegates to AIConversationService (which scopes the write to the caller and
   * never lets a store error break the chat response).
   */
  private persistExchange(params: {
    householdId: string;
    userId: string;
    conversationId?: string;
    userMessage: string;
    assistantReply: string;
    toolsUsed: string[];
  }): Promise<string> {
    return this.conversationService.recordExchange(params);
  }

  /**
   * OPEN-3: load prior turns to replay as model context.
   *
   * Security posture (this is the only path that widens what leaves the
   * household boundary, so it is deliberately fail-closed):
   *
   * - No `conversationId` supplied → no history. A caller cannot get context
   *   they did not explicitly thread.
   * - `aiConversationService.get` is scoped to (household, user) and throws
   *   NotFoundError for an absent OR cross-tenant id, so a foreign
   *   conversation id yields ZERO history rather than another household's
   *   messages.
   * - Any load failure degrades to no history; it never fails the request and
   *   never falls back to an unscoped read.
   *
   * Consent is enforced upstream (`requireAIConsent` middleware) — a revoked
   * household never reaches `processQuery` at all, so no history is loaded or
   * sent.
   */
  private async loadHistoryForContext(params: {
    householdId: string;
    userId: string;
    conversationId?: string;
    currentMessage: string;
    tokenBudget: number;
  }): Promise<HistorySelection> {
    const empty: HistorySelection = {
      turns: [],
      historyTokens: 0,
      dropped: []
    };

    const { householdId, userId, conversationId } = params;
    if (!conversationId) {
      return empty;
    }

    const maxMessages = getContextMaxMessages();
    if (maxMessages <= 0) {
      return empty;
    }

    let messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    try {
      const conversation = await this.conversationService.get({
        householdId,
        userId,
        conversationId
      });
      messages = conversation.messages.map(message => ({
        role: message.role,
        content: message.content
      }));
    } catch (error) {
      // NotFoundError covers "does not exist" AND "belongs to someone else".
      // Either way: no context, request proceeds single-turn.
      logger.warn('AI context history unavailable; proceeding without it', {
        householdId,
        userId,
        conversationId,
        error
      });
      return empty;
    }

    // The current message + system prompt are reserved FIRST and are never
    // trimmable, which is what guarantees the current message always survives.
    const reservedTokens =
      estimateTokens(params.currentMessage) +
      geminiClient.estimateSystemPromptTokens();

    const selection = selectHistoryTurns({
      messages,
      reservedTokens,
      tokenBudget: params.tokenBudget,
      maxMessages
    });

    if (selection.dropped.length > 0) {
      const injectionDrops = selection.dropped.filter(
        drop => drop.reason === 'injection'
      );

      if (injectionDrops.length > 0) {
        logger.warn('AI history messages dropped by injection re-scan', {
          householdId,
          userId,
          conversationId,
          droppedCount: injectionDrops.length,
          ruleIds: injectionDrops.map(drop => drop.ruleId ?? 'unknown_rule')
        });

        for (const drop of injectionDrops) {
          aiTracking.trackPromptInjectionBlocked({
            householdId,
            userId,
            ruleId: `history_replay:${drop.ruleId ?? 'unknown_rule'}`,
            messageLength: 0
          });
        }
      }

      const budgetDrops = selection.dropped.length - injectionDrops.length;
      if (budgetDrops > 0) {
        logger.debug('AI history messages trimmed for token budget', {
          householdId,
          userId,
          conversationId,
          droppedCount: budgetDrops,
          historyTokens: selection.historyTokens
        });
      }
    }

    return selection;
  }
}
