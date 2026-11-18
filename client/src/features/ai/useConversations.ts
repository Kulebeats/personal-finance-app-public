/**
 * Conversation-history server state (spec UI-AI-006b).
 *
 * The list is paged with limit/offset and the server tells us whether more
 * exist via `hasMore` (there is no cursor), so the next page param is simply
 * the number of rows already loaded.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchConversations } from "./api";

/** Matches the server's default page size (ai.validation.ts). */
export const CONVERSATIONS_PAGE_SIZE = 10;

export const conversationsListKey = ["aiConversations", "list"] as const;
export const conversationsLatestKey = ["aiConversations", "latest"] as const;

export function useConversationsList() {
  return useInfiniteQuery({
    queryKey: conversationsListKey,
    queryFn: ({ pageParam }) =>
      fetchConversations(CONVERSATIONS_PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore
        ? allPages.reduce((count, page) => count + page.conversations.length, 0)
        : undefined,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
