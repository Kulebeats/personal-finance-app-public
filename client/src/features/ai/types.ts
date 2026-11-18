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
}

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
  conversationId: string;
  toolsUsed: string[];
  tokenCount: number;
  remainingQueries: number;
  provenance?: ResponseProvenance;
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
}
