/**
 * MessageBubble — one transcript entry (spec UI-AI-003a, UI-AI-004c).
 *
 * Thandi's replies render their formatting (bold, lists, tables) through
 * ThandiMarkdown, which never inserts HTML; the user's own words stay plain
 * text with preserved line breaks. Amounts arrive embedded in the reply text
 * already in household currency. Never use dangerouslySetInnerHTML here.
 * Each reply can be copied.
 *
 * E1 (v1.1 Workstream E): each bubble carries a muted relative timestamp,
 * revealed on hover OR focus. The bubble itself is a real tab stop
 * (tabIndex 0) so keyboard users can reach the reveal too — a pure
 * group-hover trick would leave them with nothing (WCAG 2.1 AA).
 */
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnswerMode, ThandiMessage } from "../types";
import { ThandiMarkdown } from "./ThandiMarkdown";

const COPY_CONFIRM_MS = 2000;

/** R17: one Thandi chat, labelled by the processor that actually answered. */
const ANSWER_MODE_LABELS: Partial<Record<AnswerMode, string>> = {
  claude: "Answered using Claude",
  gemini: "Answered using Gemini — backup provider",
  local: "Limited local summary",
};

/** Humanized names for the 12 shipped analytics tools (ai.gemini.ts). */
const TOOL_LABELS: Record<string, string> = {
  get_spending_by_category: "spending by category",
  get_budget_status: "budget status",
  get_goals_status: "savings goals",
  get_upcoming_recurring: "upcoming recurring payments",
  get_recent_transactions: "recent transactions",
  get_account_balances: "account balances",
  get_merchant_spending: "merchant spending",
  get_category_trends: "category trends",
  get_monthly_summary: "monthly summary",
  get_transaction_search: "transaction search",
  get_goal_assignments: "goal assignments",
  get_cash_flow: "cash flow",
};

function humanizeTool(toolId: string): string {
  return TOOL_LABELS[toolId] ?? toolId.replace(/^get_/, "").replace(/_/g, " ");
}

/** Guards against an unparseable timestamp so one bad row can't break a bubble. */
function formatRelativeTimestamp(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatDistanceToNow(parsed, { addSuffix: true });
}

type CopyState = "idle" | "copied" | "failed";

const COPY_LABELS: Record<CopyState, string> = {
  idle: "Copy answer",
  copied: "Copied",
  failed: "Copy failed - try again",
};

function CopyAnswerButton({ content }: { content: string }) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state !== "copied") return undefined;
    const timer = window.setTimeout(() => setState("idle"), COPY_CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  const Icon = state === "copied" ? Check : Copy;
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={COPY_LABELS[state]}
      title={COPY_LABELS[state]}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors",
        "hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

interface MessageBubbleProps {
  message: ThandiMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const provenance = message.provenance;
  const showProvenance =
    !isUser && provenance !== undefined && provenance.tools.length > 0;

  const relativeTimestamp = formatRelativeTimestamp(message.timestamp);
  const answerLabel =
    !isUser && message.answerMode ? ANSWER_MODE_LABELS[message.answerMode] : undefined;

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        tabIndex={0}
        className={cn(
          "group max-w-[85%] rounded-lg px-4 py-2.5 text-sm sm:max-w-[75%]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        <span className="sr-only">{isUser ? "You:" : "Thandi:"}</span>
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <ThandiMarkdown content={message.content} />
        )}
        {!isUser && (
          <div className="mt-1.5 flex items-center gap-2">
            {answerLabel !== undefined && (
              <p className="text-xs font-medium text-muted-foreground">{answerLabel}</p>
            )}
            <CopyAnswerButton content={message.content} />
          </div>
        )}
        {showProvenance && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Based on: {provenance.tools.map(humanizeTool).join(", ")} ·{" "}
            {provenance.dataWindow.start} – {provenance.dataWindow.end}
          </p>
        )}
        {relativeTimestamp !== null && (
          <time
            dateTime={message.timestamp}
            className={cn(
              "mt-1 block text-[11px] text-muted-foreground opacity-0 transition-opacity",
              "group-hover:opacity-100 group-focus-within:opacity-100",
            )}
          >
            {relativeTimestamp}
          </time>
        )}
      </div>
    </div>
  );
}
