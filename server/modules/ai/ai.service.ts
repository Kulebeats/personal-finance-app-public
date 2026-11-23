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

import { db } from '../../db';
import { households } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { businessAuditService } from '../../services/BusinessAuditService';
import { AIConversationService } from './ai.conversation.service';
import type { ExchangePersistedHook } from './ai.conversation.repository';
import { persistAndSettle, queryAuditWriter, writeFailureAudit, type ExchangeSettlementControls, type PersistResult } from './ai.exchange-settlement';
import { OutboundRefusedError } from './ai.consent-policy';
import { BLOCKED_PROMPT_REPLY } from './ai.non-answers';
import { HttpError, InternalError } from '../../core/errors';
import { logger } from '../../utils/logger';
import { AIAnalyticsService } from './ai.analytics.service';
import { capGatedAdapters } from './ai.provider-caps';
import { ProviderOrchestrator, type AttemptClaim, type AttemptTicket, type ChatRunOutcome, type StageAttemptRecord } from './ai.provider-orchestrator';
import type { ProviderToolCall } from './ai.provider.types';
import { buildSystemPrompt } from './ai.tool-definitions';
import { renderLocalSummary } from './ai.local-templates';
import { redactOutbound, redactionAuditCounts } from './ai.outbound-redaction';
import { buildProviderAuditDetails } from './ai.provenance';
import { aiCache } from './ai.cache';
import { aiTracking } from './ai.tracking';
import {
  detectPromptInjection,
  deriveDataWindowFromToolCalls,
  estimateTokens,
  getContextMaxMessages,
  getRequestTokenBudget,
  hardenUserMessage,
  selectHistoryTurns,
  type HistorySelection
} from './ai.guardrails';
import { sanitizeToolResult } from './ai.sanitizer';
import { DisplayNames, nameAssistantMessages } from './ai.display-reply';
import { runKeywordFallback } from './ai.fallback';
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
  type ConversationDetails,
  type QueryContext,
  type ResponseProvenance,
  type ToolResult
} from './ai.types';
import type { HouseholdContext } from '../../core/authz/implicit-household-context';

const EMPTY_HISTORY: HistorySelection = { turns: [], historyTokens: 0, dropped: [] };

/**
 * AI Service Class (FIX AI-ARCH-001)
 * Encapsulates all AI logic in a dedicated service layer.
 */
/**
 * R17 (17c/17d): per-request admission controls from the durable ledger. The
 * hooks recheck consent/membership and claim each attempt before dispatch,
 * then settle it; `externalProvidersAllowed` false keeps the request local.
 */
export interface ChatAdmissionControls extends ExchangeSettlementControls {
  requestId: string;
  /** Paid calls this logical request already made on earlier attempts (B1). */
  priorPaidCalls: number;
  consentVersion: string | null;
  externalProvidersAllowed: boolean;
  externalBlockedReason: 'consent_outdated' | null;
  beforeAttempt: (attempt: AttemptClaim) => Promise<AttemptTicket | void>;
  afterAttempt: (record: StageAttemptRecord) => Promise<void>;
  /** Consent read once more after the claim, right before the adapter call (Astra #255 r4). */
  beforeDispatch: (attempt: AttemptClaim) => Promise<void>;
}

/** A reply's thread id, left out when there is none (Astra #255 r4). */
function threadOf(id: string): { conversationId?: string } {
  return id ? { conversationId: id } : {};
}

export class AIService {
  private analyticsService: AIAnalyticsService;
  private auditService: typeof businessAuditService;
  private conversationService: AIConversationService;
  private orchestrator: ProviderOrchestrator;

  constructor() {
    this.analyticsService = new AIAnalyticsService();
    this.auditService = businessAuditService;
    this.conversationService = new AIConversationService();
    this.orchestrator = new ProviderOrchestrator({
      // Paid providers fail closed without an operator call cap.
      adapters: capGatedAdapters()
    });
  }

  /**
   * Process user query with AI assistant.
   *
   * FIX AI-AUDIT-001: Logs all queries to audit trail
   * FIX AI-DATA-001: Sanitizes data before sending to external API
   */
  async processQuery(params: Pick<QueryContext, 'userId' | 'householdId' | 'actor' | 'ipAddress'> & {
    message: string;
    conversationId?: string;
    admission?: ChatAdmissionControls;
    /** Aborted when the client disconnects (P2-2). */
    signal?: AbortSignal;
  }): Promise<ChatResponse> {
    const { userId, householdId, message, ipAddress, admission } = params;
    const externalAllowed = admission?.externalProvidersAllowed ?? true;
    const ledgerAudit = admission
      ? {
          logical_request_id: admission.requestId,
          consent_version: admission.consentVersion,
          external_blocked_reason: admission.externalBlockedReason ?? undefined
        }
      : {};
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

        const blockedResponse = (id: string): ChatResponse => ({
          reply: BLOCKED_PROMPT_REPLY,
          ...threadOf(id),
          toolsUsed: [],
          tokenCount: Math.min(requestTokenBudget, estimateTokens(hardenedMessage.value)),
          remainingQueries: 0,
          provenance: this.buildProvenance([]),
          answerMode: 'unavailable',
          providers: { analysis: null, answer: null }
        });
        // SCP-338: Persist the blocked exchange too, so the conversation thread
        // is an honest record of what was asked and how the assistant replied.
        conversationId = await persistAndSettle({
          persist: (onPersisted) => this.persistExchange({
            householdId,
            userId,
            conversationId: params.conversationId,
            userMessage: hardenedMessage.value,
            assistantReply: BLOCKED_PROMPT_REPLY,
            toolsUsed: [],
            onPersisted
          }),
          shouldPersist: true,
          suppliedConversationId: params.conversationId,
          admission,
          cancelled: false,
          respond: blockedResponse,
          audit: queryAuditWriter(this.auditService, { householdId, userId, ipAddress }, {
            query: hardenedMessage.value.substring(0, 200),
            blocked: true,
            blocked_reason: injectionAssessment.ruleId,
            execution_time_ms: Date.now() - startTime,
            ...ledgerAudit
          })
        });

        return blockedResponse(conversationId);
      }

      // Get household currency
      const currency = await this.getHouseholdCurrency(householdId);

      // Create query context
      const context: QueryContext = {
        userId,
        householdId,
        actor: params.actor,
        currency,
        ipAddress
      };

      // OPEN-3: replay prior turns only when an external provider may run;
      // the local mode never sends anything out. Fail-closed on foreign ids.
      const historySelection: HistorySelection = externalAllowed && this.orchestrator.hasConfiguredProvider()
        ? await this.loadHistoryForContext({
            householdId,
            userId,
            conversationId: params.conversationId,
            currentMessage: hardenedMessage.value,
            tokenBudget: requestTokenBudget
          })
        : EMPTY_HISTORY;

      // P1-1: identifiers the user typed (now and in replayed turns) become
      // placeholders before any provider adapter sees them. Stored answers
      // already hold labels, never account names (#301 review).
      const outbound = redactOutbound(hardenedMessage.value, historySelection.turns);
      // The labels this request sends out, to name the accounts in the reply.
      const displayNames = new DisplayNames();

      // R17: Claude first, Gemini on an eligible failure, then the labelled
      // local mode. Application errors propagate out of `run` unchanged.
      const outcome = await this.orchestrator.run({
        message: outbound.message,
        priorTurns: outbound.priorTurns,
        tokenBudget: requestTokenBudget,
        currency,
        signal: params.signal,
        executeTool: (call) => this.executeToolWithArgs(call.name, call.args, context, displayNames),
        runLocal: (local) =>
          runKeywordFallback(
            hardenedMessage.value,
            context,
            requestTokenBudget,
            (toolName, ctx) => this.executeToolWithArgs(toolName, {}, ctx, displayNames),
            local.providerAttempted
          ),
        renderLocal: (data, local) => renderLocalSummary(data, currency, local.providerAttempted),
        externalProvidersAllowed: externalAllowed,
        priorPaidCalls: admission?.priorPaidCalls,
        beforeAttempt: admission?.beforeAttempt,
        afterAttempt: admission?.afterAttempt,
        beforeDispatch: admission?.beforeDispatch
      });
      // P2-2: a client that went away gets nothing persisted on its behalf.
      const cancelled = outcome.cancelled || params.signal?.aborted === true;
      this.trackToolGuardrails(outcome, householdId, userId, hardenedMessage.value.length);

      const executedToolCalls = outcome.executedToolCalls;
      const toolsToCall = executedToolCalls.map((call) => call.name);
      // The asker sees their own account names. The stored message and the
      // audit keep the provider's labelled text, so a replayed turn never
      // carries a raw name out.
      const reply = displayNames.restore(outcome.reply);
      const tokenCount = outcome.tokenCount;
      const dataSanitized = outcome.dataSanitized;
      // History counts as transmitted only when a provider call was dispatched.
      const sentHistory = outcome.transmissionAttempted ? historySelection : EMPTY_HISTORY;
      // used_gemini stays for historical rows: true only for a Gemini answer.
      const usedGemini = outcome.mode === 'gemini';

      const provenance = this.buildProvenance(executedToolCalls);
      const respond = (id: string): ChatResponse => ({
        reply,
        ...threadOf(id),
        toolsUsed: toolsToCall,
        tokenCount,
        remainingQueries: 0, // Will be set by controller from rate limit headers
        provenance,
        answerMode: outcome.mode,
        providers: { analysis: outcome.analysisProvider, answer: outcome.answerProvider }
      });

      // FIX AI-AUDIT-001: the query's audit row.
      const audit = queryAuditWriter(this.auditService, { householdId, userId, ipAddress }, {
        query: hardenedMessage.value.substring(0, 200), // Truncate for audit log
        tools_used: toolsToCall,
        response_summary: outcome.reply.substring(0, 200),
        token_count: tokenCount,
        token_budget: requestTokenBudget,
        prompt_hardened: hardenedMessage.wasModified,
        // OPEN-3 / Rule 9: exactly how much prior context left the household
        // boundary on this request, post-trim.
        context_messages: sentHistory.turns.length,
        context_tokens: sentHistory.historyTokens,
        context_dropped_injection: sentHistory.dropped.filter(
          drop => drop.reason === 'injection'
        ).length,
        context_dropped_budget: sentHistory.dropped.filter(
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
        provider_attempted: outcome.transmissionAttempted,
        provider_error: outcome.failureCategory ?? undefined,
        ...buildProviderAuditDetails(outcome),
        ...ledgerAudit,
        cancelled,
        outbound_redacted: outbound.redacted,
        ...(outbound.redacted ? { outbound_redactions: redactionAuditCounts(outbound.counts) } : {})
      });

      // SCP-338: the user message + assistant reply are persisted so history
      // survives across requests (the returned id is reused on the next call).
      // An "unavailable" outcome is not an answer and is never persisted.
      // R17 (Astra #255 r3): the exchange, its ledger settlement and the audit
      // row commit together; an unpersisted outcome settles with its audit.
      conversationId = await persistAndSettle({
        persist: (onPersisted) => this.persistExchange({
          householdId,
          userId,
          conversationId: params.conversationId,
          userMessage: hardenedMessage.value,
          assistantReply: outcome.reply,
          toolsUsed: toolsToCall,
          onPersisted
        }),
        shouldPersist: outcome.mode !== 'unavailable' && !cancelled,
        suppliedConversationId: params.conversationId,
        admission,
        cancelled,
        respond,
        audit
      });

      const latencyMs = Date.now() - startTime;

      logger.info('AI query processed', {
        householdId,
        userId,
        conversationId,
        toolsUsed: toolsToCall,
        tokenCount,
        executionTime: latencyMs,
        answerMode: outcome.mode,
        providerError: outcome.failureCategory
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

      return respond(conversationId);
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorCode = error instanceof HttpError ? error.code : 'UNKNOWN_ERROR';
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error('AI query failed', { householdId, userId, errorCode });

      // Track query failure
      aiTracking.trackQueryFailed({
        householdId,
        userId,
        errorCode,
        errorMessage: 'AI query failed',
        latencyMs
      });

      // FIX AI-AUDIT-001: Log failure to audit trail. A request that failed
      // before a conversation was persisted names no entity (N6: no invented id).
      const failureDetails = {
        query: hardenedMessage.value.substring(0, 200),
        error: errorMessage,
        execution_time_ms: latencyMs,
        success: false,
        ...ledgerAudit
      };
      try {
        await writeFailureAudit(this.auditService, { householdId, userId, ipAddress }, failureDetails, conversationId,
          error instanceof OutboundRefusedError ? error.auditFlag : undefined);
      } catch {
        // Preserve the original caller outcome if the best-effort failure audit cannot commit.
        logger.error('Failed to write AI failure audit', { householdId, userId });
      }

      // A deliberate client-facing outcome (e.g. consent changed mid-request,
      // an attempt already claimed) keeps its status; only faults become 500.
      if (error instanceof HttpError && error.statusCode < 500) throw error;
      throw new InternalError('Failed to process AI query');
    }
  }

  private trackToolGuardrails(
    outcome: ChatRunOutcome,
    householdId: string,
    userId: string,
    messageLength: number
  ): void {
    if (outcome.blockedTools.length === 0 && outcome.droppedTools.length === 0) return;
    aiTracking.trackPromptInjectionBlocked({
      householdId,
      userId,
      ruleId: outcome.blockedTools.length > 0 ? 'tool_allowlist_violation' : 'tool_cap_enforced',
      messageLength
    });
    logger.warn('AI tool selection guardrails applied', {
      householdId,
      userId,
      blockedTools: outcome.blockedTools,
      droppedByCap: outcome.droppedTools
    });
  }

  /**
   * Execute a tool with specific arguments from Gemini.
   * FIX AI-DATA-001: Sanitizes data before returning.
   * Uses caching for cacheable tools.
   */
  private async executeToolWithArgs(
    toolName: string,
    args: Record<string, unknown>,
    context: QueryContext,
    displayNames?: DisplayNames
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
      // Cache stores minimized results. The provider prompt also redacts label identifiers.
      // Key off the VALIDATED args so cache identity matches what is queried.
      if (aiCache.isCacheable(toolName)) {
        const cacheKey = aiCache.generateKey(context, toolName, validatedArgs);
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

      // SCP-313: The central sanitizer minimizes the result for local use and
      // the provider prompt. Fail closed if the tool has no sanitizer.
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
      displayNames?.record(toolName, rawData);

      // Cache the SANITIZED result for cacheable tools (writes L1 + L2 Redis).
      if (aiCache.isCacheable(toolName)) {
        const cacheKey = aiCache.generateKey(context, toolName, validatedArgs);
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

  private buildProvenance(toolCalls: ProviderToolCall[]): ResponseProvenance {
    return {
      dataWindow: deriveDataWindowFromToolCalls(toolCalls),
      freshnessTs: new Date().toISOString(),
      tools: Array.from(new Set(toolCalls.map((toolCall) => toolCall.name)))
    };
  }

  /**
   * A stored conversation as the viewer sees it: the labels in Thandi's
   * replies become the viewer's own visible account names, read now. If they
   * cannot be read, the labels are shown rather than failing the history.
   */
  async nameStoredConversation(actor: HouseholdContext, details: ConversationDetails): Promise<ConversationDetails> {
    if (!details.messages.some((message) => message.role === 'assistant')) return details;
    try {
      const { userId, householdId } = actor;
      const context: QueryContext = { userId, householdId, actor, currency: await this.getHouseholdCurrency(householdId) };
      const names = new DisplayNames();
      names.record('get_account_balances', await this.analyticsService.getAccountBalances(context));
      names.record('get_goal_assignments', await this.analyticsService.getGoalAssignments(context));
      return { ...details, messages: nameAssistantMessages(details.messages, names) };
    } catch (error) {
      logger.error('AI history: account names could not be read; showing labels', { error, householdId: actor.householdId });
      return details;
    }
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
    onPersisted?: ExchangePersistedHook;
  }): Promise<PersistResult> {
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
      estimateTokens(params.currentMessage) + estimateTokens(buildSystemPrompt());

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
