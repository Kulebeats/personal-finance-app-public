/**
 * ConversationList — the history rail's list body.
 *
 * Extracted from HistoryPanel.tsx to keep both files inside the 300 LOC limit
 * (CLAUDE.md Rule 2). Rendered both in the desktop rail and inside the mobile
 * Sheet, so it stays presentational: all state lives in HistoryPanel.
 */
import { formatDistanceToNow } from "date-fns";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ConversationSummary } from "../types";

interface ConversationListProps {
  conversations: ConversationSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  activeConversationId?: string;
  loadingId?: string;
  onSelect: (id: string) => void;
  onRequestDelete: (conversation: ConversationSummary) => void;
}

export function ConversationList({
  conversations,
  isLoading,
  isError,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  activeConversationId,
  loadingId,
  onSelect,
  onRequestDelete,
}: ConversationListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading history">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="space-y-3 rounded-lg border p-3 text-sm">
        <p>Couldn&apos;t load your conversations.</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <nav aria-label="Conversation history" className="flex flex-col gap-2">
      {conversations !== undefined && conversations.length === 0 ? (
        <p className="px-1 py-4 text-sm text-muted-foreground">
          No conversations yet. Ask Thandi a question to start one.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {conversations?.map((conversation) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.id === activeConversationId}
              isLoading={conversation.id === loadingId}
              onSelect={onSelect}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </ul>
      )}

      {hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onLoadMore}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </nav>
  );
}

interface ConversationItemProps {
  conversation: ConversationSummary;
  isActive: boolean;
  isLoading: boolean;
  onSelect: (id: string) => void;
  onRequestDelete: (conversation: ConversationSummary) => void;
}

function ConversationItem({
  conversation,
  isActive,
  isLoading,
  onSelect,
  onRequestDelete,
}: ConversationItemProps) {
  const { id, preview, messageCount, updatedAt } = conversation;

  return (
    <li className="flex items-start gap-1">
      <button
        type="button"
        onClick={() => onSelect(id)}
        aria-current={isActive ? "true" : undefined}
        className={`flex-1 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isActive ? "bg-muted font-medium" : ""
        }`}
      >
        <span className="line-clamp-2 break-words">{preview}</span>{" "}
        {/* The space above is load-bearing: without it the accessible name
            runs the preview into the meta ("Conversation 1about 2 hours ago"). */}
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {isLoading && (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          )}
          {formatRelativeUpdatedAt(updatedAt)} ·{" "}
          {`${messageCount} ${messageCount === 1 ? "message" : "messages"}`}
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mt-1 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        aria-label={`Delete conversation: ${preview}`}
        onClick={() => onRequestDelete(conversation)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}

/** Guards against an unparseable timestamp so one bad row can't blank the rail. */
function formatRelativeUpdatedAt(updatedAt: string): string {
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return "recently";
  return formatDistanceToNow(parsed, { addSuffix: true });
}
