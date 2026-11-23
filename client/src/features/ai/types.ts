/**
 * Thandi AI assistant — client payload types.
 *
 * Field-for-field mirrors of the shipped server contract in
 * server/modules/ai/ai.types.ts (verified against
 * docs/ai-integration/specifications/ai-assistant-api-spec.md v3.0).
 * AI success responses are RAW JSON — no V7 envelope. Do not invent fields.
 */

export interface ChatRequest {
  message: string;
  /** Omit to start a new thread; resend the returned id to keep one thread. */
  conversationId?: string;
  /**
   * R17: idempotency key for ONE logical request (16-128 URL-safe chars).
   * Resend the same key on a retry so a completed request replays.
   */
  clientRequestKey?: string;
}

/** R17: which processor produced the reply (server `answerMode`). */
export type AnswerMode = "claude" | "gemini" | "local" | "unavailable";
export type ProviderId = "anthropic" | "gemini";

export interface ResponseProvenance {
  dataWindow: {
    start: string;
    end: string;
  };
  freshnessTs: string;
  tools: string[];
}

export interface ChatResponse {
  reply: string;
  /** Absent on a reply that belongs to no stored thread (R17 #255 r4). */
  conversationId?: string;
  toolsUsed: string[];
  tokenCount: number;
  remainingQueries: number;
  provenance?: ResponseProvenance;
  /** Additive (R17): absent on older deployments. */
  answerMode?: AnswerMode;
  providers?: {
    analysis: ProviderId | "local" | null;
    answer: ProviderId | "local" | null;
  };
}

export interface AIStatusResponse {
  /**
   * Always true when the server can respond at all: the keyword-matching
   * fallback genuinely answers when Gemini isn't configured, so this is not
   * a provider-outage signal. Use `degraded` for that (v1.1 Workstream E4).
   */
  available: boolean;
  /**
   * True when the real Gemini provider is not configured and requests are
   * being served by the keyword-matching fallback instead. Additive field —
   * absent on older server deployments, so treat as `false` when undefined.
   */
  degraded?: boolean;
  /** Additive (R17): real health from the server's attempt ledger. */
  state?: "unconfigured" | "operational" | "degraded" | "outage";
  quotaLimited?: boolean;
  providers?: Array<{
    provider: ProviderId;
    role: "primary" | "fallback";
    configured: boolean;
    model: string | null;
    health: "unconfigured" | "unverified" | "healthy" | "unhealthy";
    lastCheckedAt: string | null;
    lastFailureCategory: string | null;
    /** Why the provider cannot be used now: no key/model, no operator call cap, or cap reached. */
    unavailableReason?: "not_configured" | "no_cap" | "cap_reached" | null;
  }>;
  rateLimit: {
    remaining: number;
    resetTime: string;
    isLimited: boolean;
  };
}

export interface ConversationSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

export interface ConversationListResponse {
  conversations: ConversationSummary[];
  total: number;
  hasMore: boolean;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolsUsed?: string[];
}

export interface ConversationDetails {
  id: string;
  householdId: string;
  userId: string;
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

/** A message as rendered in the chat transcript (local UI shape). */
export interface ThandiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  toolsUsed?: string[];
  provenance?: ResponseProvenance;
  /** Assistant messages only: who produced this reply (R17). */
  answerMode?: AnswerMode;
}
