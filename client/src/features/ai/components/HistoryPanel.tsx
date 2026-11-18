/**
 * HistoryPanel — browse, open, and delete past Thandi threads
 * (spec UI-AI-006b; v1.1 implementation plan §2).
 *
 * Layout follows the SettingsLayout precedent: a rail on ≥lg viewports and the
 * same list inside a Sheet below that. Every conversation the server returns is
 * already household+user scoped (ai.conversation.repository.ts), so there is no
 * client-side visibility filtering to do here.
 */
import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { deleteConversation, fetchConversation } from "../api";
import {
  conversationsLatestKey,
  conversationsListKey,
  useConversationsList,
} from "../useConversations";
import { ConversationList } from "./ConversationList";
import type { ConversationDetails, ConversationSummary } from "../types";

interface HistoryPanelProps {
  /** Highlights the thread currently on screen. */
  activeConversationId?: string;
  onSelectConversation: (details: ConversationDetails) => void;
  /** Called when the active thread is deleted, so the chat can reset. */
  onActiveConversationDeleted: () => void;
}

interface ApiCallError extends Error {
  status?: number;
}

export function HistoryPanel({
  activeConversationId,
  onSelectConversation,
  onActiveConversationDeleted,
}: HistoryPanelProps) {
  const queryClient = useQueryClient();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ConversationSummary | null>(
    null,
  );
  const list = useConversationsList();

  const selectMutation = useMutation({
    mutationFn: (id: string) => fetchConversation(id),
    onSuccess: (details) => {
      onSelectConversation(details);
      setIsSheetOpen(false);
    },
    onError: () => {
      toast.error("Couldn't open that conversation.");
    },
  });

  /**
   * Shared end state for "the thread is gone": both a 204 and a 404 (someone
   * else already deleted it) leave the user where they want to be.
   */
  const settleDeleted = useCallback(
    (id: string) => {
      if (id === activeConversationId) onActiveConversationDeleted();
      void queryClient.invalidateQueries({ queryKey: conversationsListKey });
      void queryClient.invalidateQueries({ queryKey: conversationsLatestKey });
      toast.success("Conversation deleted");
    },
    [activeConversationId, onActiveConversationDeleted, queryClient],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: (_result, id) => settleDeleted(id),
    onError: (error: ApiCallError, id) => {
      if (error.status === 404) {
        settleDeleted(id);
        return;
      }
      toast.error("Couldn't delete that conversation.");
    },
    onSettled: () => setPendingDelete(null),
  });

  const conversations = list.data?.pages.flatMap((page) => page.conversations);

  const listBody = (
    <ConversationList
      conversations={conversations}
      isLoading={list.isLoading}
      isError={list.isError}
      onRetry={() => void list.refetch()}
      hasNextPage={list.hasNextPage}
      isFetchingNextPage={list.isFetchingNextPage}
      onLoadMore={() => void list.fetchNextPage()}
      activeConversationId={activeConversationId}
      loadingId={selectMutation.isPending ? selectMutation.variables : undefined}
      onSelect={(id) => selectMutation.mutate(id)}
      onRequestDelete={setPendingDelete}
    />
  );

  return (
    <>
      <aside className="hidden w-72 shrink-0 flex-col border-r pr-3 lg:flex">
        {listBody}
      </aside>

      <div className="lg:hidden">
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild>
            <Button type="button" variant="outline" size="sm">
              <History className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Show conversation history</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Conversation history</SheetTitle>
              <SheetDescription>
                Pick a past conversation to pick up where you left off.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4">{listBody}</div>
          </SheetContent>
        </Sheet>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{pendingDelete?.preview}&rdquo; will be permanently deleted,
              along with its messages. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Keep the dialog mounted until the request settles.
                event.preventDefault();
                if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
              }}
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

