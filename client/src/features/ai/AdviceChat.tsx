/**
 * AdviceChat — container for the Thandi chat surface.
 *
 * Consent-first (spec UI-AI-002): while household AI consent is absent or
 * needs re-consent, the consent gate renders INSTEAD of the composer. The
 * chat panel (and its status/restore fetches) only mounts once consented.
 */
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAIConsent } from "@/hooks/use-settings";
import { formatRelativeReset } from "./relativeReset";
import { useThandiChat } from "./useThandiChat";
import { ChatComposer } from "./components/ChatComposer";
import { ConsentGate } from "./components/ConsentGate";
import { HistoryPanel } from "./components/HistoryPanel";
import { MessageList } from "./components/MessageList";
import { QuotaMeter, QUOTA_METER_THRESHOLD } from "./components/QuotaMeter";
import { SuggestedPrompts } from "./components/SuggestedPrompts";

export function AdviceChat() {
  const { data: consent, isLoading, error, refetch } = useAIConsent();

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading Thandi">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error !== null || consent === undefined) {
    return (
      <div role="alert" className="space-y-3 rounded-lg border p-4 text-sm">
        <p>Couldn't load Thandi's status right now.</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!consent.consentGiven || consent.needsReconsent) {
    return <ConsentGate consent={consent} />;
  }

  return <ThandiChatPanel />;
}

function ThandiChatPanel() {
  const chat = useThandiChat();

  const showEmptyState =
    chat.messages.length === 0 && !chat.isRestoring && !chat.isSending;
  const relativeReset =
    chat.quotaResetTime !== null
      ? formatRelativeReset(chat.quotaResetTime)
      : null;

  return (
    <div className="flex h-full gap-4">
      <HistoryPanel
        activeConversationId={chat.activeConversationId}
        onSelectConversation={chat.loadConversation}
        onActiveConversationDeleted={chat.newChat}
      />

      <div className="flex h-full min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          {chat.quotaRemaining !== null &&
            (chat.quotaRemaining < QUOTA_METER_THRESHOLD ? (
              <QuotaMeter
                remaining={chat.quotaRemaining}
                resetTime={chat.quotaResetTime}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {chat.quotaRemaining} questions left today
              </p>
            ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={chat.newChat}
            disabled={chat.isSending}
          >
            <MessageSquarePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            New chat
          </Button>
        </div>

        {chat.isDegraded && (
          <p className="text-xs text-muted-foreground">
            Thandi is running on a fallback right now — answers may be
            limited.
          </p>
        )}

        {chat.isQuotaExhausted && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm"
          >
            Daily limit reached (50 questions per household per day).
            {relativeReset !== null && ` Resets ${relativeReset}.`}
          </div>
        )}

        {chat.isRestoring && (
          <div className="space-y-3 py-2" aria-busy="true">
            <Skeleton className="h-12 w-2/3" />
            <Skeleton className="ml-auto h-12 w-1/2" />
          </div>
        )}
        <MessageList messages={chat.messages} isSending={chat.isSending} />

        {chat.sendError?.kind === "outage" && (
          <div className="flex justify-start">
            <div
              role="alert"
              className="max-w-[85%] rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm sm:max-w-[75%]"
            >
              <p>{chat.sendError.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={chat.retry}
              >
                Retry
              </Button>
            </div>
          </div>
        )}

        {showEmptyState && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ask a follow-up any time — recent messages in this conversation
              are used for context.
            </p>
            <SuggestedPrompts
              onSelect={chat.send}
              disabled={chat.isQuotaExhausted}
            />
          </div>
        )}

        <ChatComposer
          onSend={chat.send}
          disabled={chat.isQuotaExhausted}
          isSending={chat.isSending}
          restoredDraft={chat.restoredDraft}
          onDraftConsumed={chat.clearRestoredDraft}
          validationError={
            chat.sendError?.kind === "validation"
              ? chat.sendError.message
              : null
          }
        />
      </div>
    </div>
  );
}
