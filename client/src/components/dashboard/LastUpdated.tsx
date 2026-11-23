import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface LastUpdatedProps {
  /** Timestamp of when data was last fetched */
  timestamp: Date | number | undefined;
  /** Optional refresh handler */
  onRefresh?: () => void;
  /** Whether refresh is in progress */
  isRefreshing?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Displays a "Last updated" timestamp with optional refresh button.
 * Shows relative time (e.g., "2 min ago") for recent updates.
 */
export function LastUpdated({
  timestamp,
  onRefresh,
  isRefreshing = false,
  className,
}: LastUpdatedProps) {
  if (!timestamp) return null;

  const date = typeof timestamp === "number" ? new Date(timestamp) : timestamp;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  let timeText: string;
  if (diffMinutes < 1) {
    timeText = "Just now";
  } else if (diffMinutes < 60) {
    timeText = `${diffMinutes} min ago`;
  } else if (diffHours < 24) {
    timeText = `${diffHours}h ago`;
  } else {
    timeText = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground",
        className
      )}
    >
      <span>Updated {timeText}</span>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-0.5 rounded hover:bg-muted transition-colors disabled:opacity-50 max-md:inline-flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center"
          aria-label="Refresh data"
          type="button"
        >
          <RefreshCw
            className={cn("h-3 w-3", isRefreshing && "animate-spin")}
          />
        </button>
      )}
    </div>
  );
}

export default LastUpdated;
