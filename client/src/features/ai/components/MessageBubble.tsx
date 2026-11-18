/**
 * MessageBubble — one transcript entry (spec UI-AI-003a, UI-AI-004c).
 *
 * Replies render as plain text with preserved line breaks — amounts arrive
 * embedded in the reply text already in household currency; there are no
 * structured amount fields in the chat payload. Never use
 * dangerouslySetInnerHTML here.
 *
 * E1 (v1.1 Workstream E): each bubble carries a muted relative timestamp,
 * revealed on hover OR focus. The bubble itself is a real tab stop
 * (tabIndex 0) so keyboard users can reach the reveal too — a pure
 * group-hover trick would leave them with nothing (WCAG 2.1 AA).
 */
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { ThandiMessage } from "../types";

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

interface MessageBubbleProps {
  message: ThandiMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const provenance = message.provenance;
  const showProvenance =
    !isUser && provenance !== undefined && provenance.tools.length > 0;

  const relativeTimestamp = formatRelativeTimestamp(message.timestamp);

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
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
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
