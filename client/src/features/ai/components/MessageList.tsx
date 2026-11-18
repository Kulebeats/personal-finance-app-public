/**
 * MessageList — the chat transcript (spec UI-AI-003a, UI-AI-007a/f).
 *
 * role="log" + aria-live="polite" announces each complete (non-streamed)
 * reply once; aria-busy marks the in-flight window. The typing indicator is
 * aria-hidden — the busy state conveys it — and its animation respects
 * prefers-reduced-motion.
 */
import { useEffect, useRef } from "react";
import type { ThandiMessage } from "../types";
import { MessageBubble } from "./MessageBubble";

interface MessageListProps {
  messages: ThandiMessage[];
  isSending: boolean;
}

export function MessageList({ messages, isSending }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    bottomRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, isSending]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-busy={isSending}
      aria-label="Conversation with Thandi"
      className="flex min-h-[16rem] flex-1 flex-col gap-3 overflow-y-auto py-2"
    >
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {isSending && (
        <div className="flex justify-start" data-testid="thandi-typing" aria-hidden="true">
          <div className="rounded-lg bg-muted px-4 py-3">
            <span className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms] motion-reduce:animate-none" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms] motion-reduce:animate-none" />
            </span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
