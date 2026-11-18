/**
 * Thandi AI assistant — API layer.
 *
 * All calls go through the shared apiCall helper (CSRF attach + self-heal).
 * AI success responses are RAW JSON payloads, not the V7 envelope, so no
 * unwrapping happens here (api-spec v3.0 §1).
 */
import { apiCall } from "@/lib/api";
import type {
  AIStatusResponse,
  ChatRequest,
  ChatResponse,
  ConversationDetails,
  ConversationListResponse,
} from "./types";

export function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  return apiCall<ChatResponse>("/ai/chat", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function fetchAIStatus(): Promise<AIStatusResponse> {
  return apiCall<AIStatusResponse>("/ai/status");
}

export function fetchConversations(
  limit: number,
  offset: number,
): Promise<ConversationListResponse> {
  return apiCall<ConversationListResponse>(
    `/ai/conversations?limit=${limit}&offset=${offset}`,
  );
}

export function fetchConversation(id: string): Promise<ConversationDetails> {
  return apiCall<ConversationDetails>(`/ai/conversations/${id}`);
}

/**
 * Delete a conversation and its messages (api-spec §7.3).
 *
 * The server answers 204 with an EMPTY body; apiCall's 204-aware branch
 * resolves to undefined rather than choking on response.json(). A 404 means
 * it was already deleted (the service throws NotFoundError when nothing
 * matched, so ids are never probed across tenants) — callers treat that as
 * "already gone", not a hard failure.
 */
export function deleteConversation(id: string): Promise<void> {
  return apiCall<void>(`/ai/conversations/${id}`, { method: "DELETE" });
}

/**
 * Latest-thread restore (spec UI-AI-006a): list the most recent conversation,
 * then load its messages. Returns null when the user has no history yet.
 */
export async function fetchLatestConversation(): Promise<ConversationDetails | null> {
  const list = await fetchConversations(1, 0);
  const latest = list.conversations[0];
  if (!latest) return null;
  return fetchConversation(latest.id);
}
