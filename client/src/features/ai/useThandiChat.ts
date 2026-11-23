/**
 * useThandiChat — owns the Thandi chat send flow, conversation threading,
 * quota tracking, error mapping, and latest-thread restore.
 *
 * Contract notes (api-spec v3.0):
 * - Non-streaming: one POST /api/ai/chat returns the full reply.
 * - The returned conversationId must be resent to keep one server thread.
 * - Prior turns of that thread are replayed to the model server-side (PR #136),
 *   so follow-up questions using pronouns resolve.
 * - A 429 DOES carry RateLimit-Reset and Retry-After (PR #124/#127/#135), but
 *   apiCall does not surface headers and both are delta-seconds rather than the
 *   ISO instant this UI renders — so reset time still comes from /api/ai/status.
 * - Guardrail refusals are 200s with a refusal reply — rendered normally.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAIStatus,
  fetchLatestConversation,
  sendChatMessage,
} from "./api";
import type { ConversationDetails, ThandiMessage } from "./types";

export type SendErrorKind = "validation" | "quota" | "outage";

export interface SendError {
  kind: SendErrorKind;
  message: string;
}

interface ApiCallError extends Error {
  status?: number;
  code?: string;
  fields?: Array<{ field: string; message: string; code?: string }>;
  /** Delta-seconds from the 429's Retry-After / RateLimit-Reset (see lib/api). */
  retryAfterSeconds?: number;
}

export interface UseThandiChatResult {
  messages: ThandiMessage[];
  isSending: boolean;
  /** True while the latest persisted thread is being restored on mount. */
  isRestoring: boolean;
  /** Server id of the thread on screen; undefined for an unsent fresh chat. */
  activeConversationId: string | undefined;
  quotaRemaining: number | null;
  quotaResetTime: string | null;
  isQuotaExhausted: boolean;
  /** True when the real AI provider isn't configured (fallback answers are still shown). */
  isDegraded: boolean;
  sendError: SendError | null;
  /** Text to put back in the composer after a rejected send. */
  restoredDraft: string | null;
  send: (text: string) => void;
  retry: () => void;
  newChat: () => void;
  /** Replace the transcript with a thread picked from the history rail. */
  loadConversation: (details: ConversationDetails) => void;
  clearRestoredDraft: () => void;
}

let messageSeq = 0;
/**
 * R17: one idempotency key per logical message. A retry of the same failed
 * message reuses it, so a request that completed server-side replays instead
 * of being answered (and charged) twice.
 */
function newRequestKey(): string {
  return crypto.randomUUID();
}

interface FailedSend {
  text: string;
  requestKey: string;
}

function nextMessageId(): string {
  messageSeq += 1;
  return `thandi-local-${messageSeq}`;
}

const OUTAGE_MESSAGE = "Thandi couldn't answer that right now.";

/**
 * Map a persisted thread to transcript bubbles. Ids are namespaced by
 * conversation so swapping threads can never collide on a React key.
 */
function toTranscript(details: ConversationDetails): ThandiMessage[] {
  return details.messages.map((message, index) => ({
    id: `thandi-${details.id}-${index}`,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    toolsUsed: message.toolsUsed,
  }));
}

export function useThandiChat(): UseThandiChatResult {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ThandiMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<SendError | null>(null);
  const [restoredDraft, setRestoredDraft] = useState<string | null>(null);
  const [quotaOverride, setQuotaOverride] = useState<number | null>(null);
  // Reset instant derived from the 429 itself, preferred over the status query
  // so the countdown renders without waiting on a refetch.
  const [quotaResetOverride, setQuotaResetOverride] = useState<string | null>(
    null,
  );
  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(undefined);

  // The ref is what doSend reads (no stale closure); the state mirrors it so
  // the history rail can highlight the active thread. Always set both.
  const conversationIdRef = useRef<string | undefined>(undefined);
  const sendingRef = useRef(false);
  const interactedRef = useRef(false);
  const lastFailedRef = useRef<FailedSend | null>(null);

  const setConversationId = useCallback((id: string | undefined): void => {
    conversationIdRef.current = id;
    setActiveConversationId(id);
  }, []);

  const statusQuery = useQuery({
    queryKey: ["aiStatus"],
    queryFn: fetchAIStatus,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const restoreQuery = useQuery({
    queryKey: ["aiConversations", "latest"],
    queryFn: fetchLatestConversation,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  // Apply the restored thread once, and only if the user hasn't interacted.
  const restored = restoreQuery.data;
  useEffect(() => {
    if (!restored || interactedRef.current) return;
    setConversationId(restored.id);
    setMessages(toTranscript(restored));
  }, [restored, setConversationId]);

  const doSend = useCallback(
    async (text: string, reuseExistingBubble: boolean, requestKey: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendingRef.current) return;
      sendingRef.current = true;
      interactedRef.current = true;
      setIsSending(true);
      setSendError(null);
      setRestoredDraft(null);

      const userMessageId = nextMessageId();
      if (!reuseExistingBubble) {
        setMessages((previous) => [
          ...previous,
          {
            id: userMessageId,
            role: "user",
            content: trimmed,
            timestamp: new Date().toISOString(),
          },
        ]);
      }

      // Remove the optimistic user bubble (fresh send) or the already-present
      // failed bubble (retry) when the message was not accepted by the server.
      const removeUserBubble = (): void => {
        setMessages((previous) => {
          if (!reuseExistingBubble) {
            return previous.filter((message) => message.id !== userMessageId);
          }
          const last = previous[previous.length - 1];
          return last?.role === "user" ? previous.slice(0, -1) : previous;
        });
      };

      try {
        const response = await sendChatMessage({
          message: trimmed,
          conversationId: conversationIdRef.current,
          clientRequestKey: requestKey,
        });
        // No usable id (missing or empty): keep the current thread (R17 #255 r4).
        if (response.conversationId) setConversationId(response.conversationId);
        setQuotaOverride(response.remainingQueries);
        lastFailedRef.current = null;
        setMessages((previous) => [
          ...previous,
          {
            id: nextMessageId(),
            role: "assistant",
            content: response.reply,
            timestamp: new Date().toISOString(),
            toolsUsed: response.toolsUsed,
            provenance: response.provenance,
            answerMode: response.answerMode,
          },
        ]);
      } catch (error) {
        const apiError = error as ApiCallError;
        if (apiError.status === 429) {
          removeUserBubble();
          setRestoredDraft(trimmed);
          setQuotaOverride(0);
          setSendError({ kind: "quota", message: apiError.message });
          // Prefer the delta the 429 itself carried: converting it here renders
          // the countdown immediately, with no extra round-trip.
          const retryAfter = apiError.retryAfterSeconds;
          if (typeof retryAfter === "number") {
            setQuotaResetOverride(
              new Date(Date.now() + retryAfter * 1000).toISOString(),
            );
          } else {
            // No header — a pre-#124 deployment, or a 429 raised somewhere that
            // doesn't set one. Fall back to the status query for the instant.
            void queryClient.invalidateQueries({ queryKey: ["aiStatus"] });
          }
        } else if (apiError.status === 403 && apiError.code === "FORBIDDEN") {
          // Consent revoked mid-session: fall back to the consent gate.
          removeUserBubble();
          setRestoredDraft(trimmed);
          void queryClient.invalidateQueries({ queryKey: ["aiConsent"] });
        } else if (apiError.status === 400) {
          removeUserBubble();
          setRestoredDraft(trimmed);
          setSendError({
            kind: "validation",
            message: apiError.fields?.[0]?.message ?? apiError.message,
          });
        } else if (apiError.status === 401) {
          // Session expiry is handled app-wide; keep the transcript as-is.
          removeUserBubble();
          setRestoredDraft(trimmed);
        } else {
          // Provider outage / network failure: the user message stays in the
          // transcript and can be retried (spec state 5.6).
          lastFailedRef.current = { text: trimmed, requestKey };
          setSendError({ kind: "outage", message: OUTAGE_MESSAGE });
        }
      } finally {
        sendingRef.current = false;
        setIsSending(false);
      }
    },
    [queryClient, setConversationId],
  );

  const send = useCallback(
    (text: string) => {
      void doSend(text, false, newRequestKey());
    },
    [doSend],
  );

  const retry = useCallback(() => {
    const failed = lastFailedRef.current;
    if (!failed) return;
    void doSend(failed.text, true, failed.requestKey);
  }, [doSend]);

  const newChat = useCallback(() => {
    interactedRef.current = true;
    lastFailedRef.current = null;
    setConversationId(undefined);
    setMessages([]);
    setSendError(null);
    setRestoredDraft(null);
  }, [setConversationId]);

  // Selecting from the history rail counts as an interaction, so the pending
  // mount-restore (UI-AI-006a) can never clobber the chosen thread.
  const loadConversation = useCallback(
    (details: ConversationDetails) => {
      interactedRef.current = true;
      lastFailedRef.current = null;
      setConversationId(details.id);
      setMessages(toTranscript(details));
      setSendError(null);
      setRestoredDraft(null);
    },
    [setConversationId],
  );

  const clearRestoredDraft = useCallback(() => {
    setRestoredDraft(null);
  }, []);

  const quotaRemaining =
    quotaOverride ?? statusQuery.data?.rateLimit.remaining ?? null;

  return {
    messages,
    isSending,
    isRestoring: restoreQuery.isLoading,
    activeConversationId,
    quotaRemaining,
    // The 429-derived instant wins: it is fresher than the cached status query
    // and needs no round-trip. Falls back to status when the 429 carried no
    // Retry-After, or before any 429 has happened.
    quotaResetTime:
      quotaResetOverride ?? statusQuery.data?.rateLimit.resetTime ?? null,
    isQuotaExhausted: quotaRemaining === 0,
    isDegraded: statusQuery.data?.degraded ?? false,
    sendError,
    restoredDraft,
    send,
    retry,
    newChat,
    loadConversation,
    clearRestoredDraft,
  };
}
