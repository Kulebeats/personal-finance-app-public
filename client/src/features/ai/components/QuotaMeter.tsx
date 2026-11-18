/**
 * QuotaMeter — subtle low-quota progress meter (v1.1 Workstream E2).
 *
 * AdviceChat renders this only once `remaining` drops below
 * QUOTA_METER_THRESHOLD; above that the existing plain-text indicator is
 * unchanged, so this component only needs to handle the "getting low" band.
 *
 * A11y: exposed as a labelled `progressbar` (aria-valuenow/min/max plus an
 * aria-label) rather than a bare colored div, so assistive tech gets the
 * same "N left" information sighted users see.
 */
import { cn } from "@/lib/utils";
import { formatRelativeReset } from "../relativeReset";

/** Mirrors RATE_LIMIT_MAX in server/modules/ai/ai.middleware.ts. */
const DAILY_QUOTA_LIMIT = 50;

/** Below this many remaining questions, AdviceChat swaps in this meter. */
export const QUOTA_METER_THRESHOLD = 10;

interface QuotaMeterProps {
  remaining: number;
  resetTime: string | null;
}

export function QuotaMeter({ remaining, resetTime }: QuotaMeterProps) {
  const relativeReset = resetTime !== null ? formatRelativeReset(resetTime) : null;
  const label = `${remaining} question${remaining === 1 ? "" : "s"} left today`;
  const percent = Math.min(
    100,
    Math.max(0, (remaining / DAILY_QUOTA_LIMIT) * 100),
  );

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div
        role="progressbar"
        aria-valuenow={remaining}
        aria-valuemin={0}
        aria-valuemax={DAILY_QUOTA_LIMIT}
        aria-valuetext={label}
        aria-label="Daily AI questions remaining"
        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            remaining === 0 ? "bg-destructive" : "bg-amber-500",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span>
        {label}
        {relativeReset !== null && ` · resets ${relativeReset}`}
      </span>
    </div>
  );
}
