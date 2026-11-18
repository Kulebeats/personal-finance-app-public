/**
 * Transaction Date Header Component
 *
 * Sticky date header for grouped transaction lists.
 */

import { format, isToday, isYesterday, parseISO } from "date-fns";

interface TransactionDateHeaderProps {
  date: string;
}

function formatDateHeader(dateStr: string): string {
  const date = parseISO(dateStr);

  if (isToday(date)) {
    return "Today";
  }
  if (isYesterday(date)) {
    return "Yesterday";
  }
  return format(date, "EEEE, MMMM d, yyyy");
}

export function TransactionDateHeader({
  date,
}: Readonly<TransactionDateHeaderProps>) {
  return (
    <div className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm px-4 py-2 border-b border-border/50">
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {formatDateHeader(date)}
      </span>
    </div>
  );
}
