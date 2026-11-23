import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ArrowRight, Target } from "lucide-react";
import { useFormatters } from "@/contexts/SettingsContext";
import { useGoalsSummary } from "@/hooks/useGoals";
import { toMoneyNumber } from "@/lib/money";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { WidgetErrorState } from "./WidgetErrorState";

/**
 * Editorial-styled Goals Widget
 *
 * Design: Circular SVG gauges with elegant activity timeline
 * - Animated ring progress indicators
 * - Fraunces display font for percentages
 * - Sophisticated color palette
 * - Timeline with decorative dots
 */

const ACTIVITY_LABELS: Record<string, string> = {
  contribution_added: "Contribution",
  goal_created: "Created",
  goal_updated: "Updated",
  goal_completed: "Completed",
  goal_archived: "Archived",
  goal_unarchived: "Restored",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  transaction_linked: "Linked",
  transaction_unlinked: "Unlinked",
  account_assigned: "Assigned",
  account_unassigned: "Unassigned",
  balance_synced: "Synced",
  status_changed: "Status",
  milestone_reached: "Milestone",
};

function formatActivityDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Circular progress gauge component
 */
function CircularGauge({
  progress,
  size = 80,
  strokeWidth = 6,
  colorClass,
  label,
  sublabel,
  delay = 0,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  colorClass: string;
  label: string;
  sublabel: string;
  delay?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div
      className="flex flex-col items-center animate-count-up opacity-0"
      style={{ animationFillMode: "forwards", animationDelay: `${delay}s` }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          {/* Background ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={strokeWidth}
            className="opacity-50"
          />
          {/* Progress ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`hsl(var(${colorClass}))`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
            style={{ transitionDelay: `${delay + 0.3}s` }}
          />
        </svg>
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-lg font-semibold text-foreground">
            {Math.round(progress)}%
          </span>
        </div>
      </div>
      <span className="mt-2 font-body text-xs font-medium text-foreground">
        {label}
      </span>
      <span className="font-body text-[10px] text-muted-foreground">
        {sublabel}
      </span>
    </div>
  );
}

export default function GoalsWidget() {
  const { formatCurrency } = useFormatters();
  const { data: summary, isLoading, error, refetch } = useGoalsSummary();

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load goals"
        message="We couldn't fetch your goals summary."
        onRetry={() => refetch()}
        className="h-full"
      />
    );
  }

  const saveUp = summary?.saveUp;
  const payDown = summary?.payDown;
  const recentActivity = summary?.recentActivity?.slice(0, 4) ?? [];

  const payDownPaid = toMoneyNumber(payDown?.totalPaid ?? 0);
  const payDownTotal = payDownPaid + toMoneyNumber(payDown?.totalDebt ?? 0);
  const payDownProgress = payDownTotal > 0 ? Math.round((payDownPaid / payDownTotal) * 100) : 0;

  const totalGoals = (saveUp?.total ?? 0) + (payDown?.total ?? 0);

  return (
    <Card className="col-span-1 widget-editorial border-border/30 hover-lift flex flex-col h-full overflow-hidden">
      {/* Art Deco corner flourish */}
      <div className="widget-flourish" />

      <CardHeader className="pb-3 pt-5 px-5 relative z-10">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
            Goals
          </h3>
          <Link
            href="/goals"
            className="group flex items-center gap-1 font-body text-xs text-muted-foreground hover:text-foreground transition-colors max-md:min-h-11"
          >
            View all
            <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
        {/* Elegant separator */}
        <div className="mt-3 h-px bg-gradient-to-r from-[hsl(var(--widget-gold)/0.5)] via-[hsl(var(--border))] to-transparent" />
      </CardHeader>

      <CardContent className="flex-1 overflow-auto px-5 pb-5">
        {isLoading ? (
          <div className="space-y-4">
            <div className="flex justify-center gap-6">
              <div className="w-20 h-20 rounded-full bg-muted animate-pulse" />
              <div className="w-20 h-20 rounded-full bg-muted animate-pulse" />
            </div>
            <div className="h-4 w-32 bg-muted rounded animate-pulse mx-auto" />
          </div>
        ) : totalGoals === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center h-full">
            <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <Target className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <p className="font-body text-sm text-muted-foreground mb-1">
              No goals yet
            </p>
            <Link
              href="/goals"
              className="font-body text-sm text-[hsl(var(--widget-income))] hover:underline inline-flex items-center max-md:min-h-11"
            >
              Create your first goal
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Circular gauges
                Audit v2 P2: these were previously non-interactive. They
                summarize the Save Up / Pay Down goal categories rather than
                a single goal, so - unlike the activity items below, which do
                carry a goalId - they link to the Goals list rather than a
                `/goals/:id` detail. */}
            <div className="flex justify-center gap-8">
              {(saveUp?.total ?? 0) > 0 && (
                <Link
                  href="/goals"
                  aria-label="View Save Up goals"
                  className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <CircularGauge
                    progress={saveUp?.overallProgress ?? 0}
                    colorClass="--widget-income"
                    label="Save Up"
                    sublabel={`${saveUp?.total ?? 0} goals`}
                    delay={0}
                  />
                </Link>
              )}
              {(payDown?.total ?? 0) > 0 && (
                <Link
                  href="/goals"
                  aria-label="View Pay Down goals"
                  className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <CircularGauge
                    progress={payDownProgress}
                    colorClass="--widget-savings"
                    label="Pay Down"
                    sublabel={`${payDown?.total ?? 0} goals`}
                    delay={0.1}
                  />
                </Link>
              )}
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-3">
              {(saveUp?.total ?? 0) > 0 && (
                <div
                  className={cn(
                    "p-3 rounded-xl bg-[hsl(var(--widget-income-light))]",
                    "border border-[hsl(var(--widget-income)/0.15)]",
                    "animate-count-up opacity-0 stagger-2"
                  )}
                  style={{ animationFillMode: "forwards" }}
                >
                  <p className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1">
                    Saved
                  </p>
                  <p className="font-display text-base font-semibold text-[hsl(var(--widget-income))]">
                    {formatCurrency(toMoneyNumber(saveUp?.totalSaved ?? 0))}
                  </p>
                  <p className="font-body text-[10px] text-muted-foreground">
                    of {formatCurrency(toMoneyNumber(saveUp?.totalTarget ?? 0))}
                  </p>
                </div>
              )}
              {(payDown?.total ?? 0) > 0 && (
                <div
                  className={cn(
                    "p-3 rounded-xl bg-[hsl(var(--widget-savings-light))]",
                    "border border-[hsl(var(--widget-savings)/0.15)]",
                    "animate-count-up opacity-0 stagger-3"
                  )}
                  style={{ animationFillMode: "forwards" }}
                >
                  <p className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-1">
                    Paid
                  </p>
                  <p className="font-display text-base font-semibold text-[hsl(var(--widget-savings))]">
                    {formatCurrency(payDownPaid)}
                  </p>
                  <p className="font-body text-[10px] text-muted-foreground">
                    {formatCurrency(toMoneyNumber(payDown?.totalDebt ?? 0))} remaining
                  </p>
                </div>
              )}
            </div>

            {/* Status badges */}
            <div
              className="flex flex-wrap gap-2 animate-count-up opacity-0 stagger-4"
              style={{ animationFillMode: "forwards" }}
            >
              {(saveUp?.onTrack ?? 0) + (payDown?.onTrack ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 font-body text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {(saveUp?.onTrack ?? 0) + (payDown?.onTrack ?? 0)} on track
                </span>
              )}
              {(saveUp?.behind ?? 0) + (payDown?.behind ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-body text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {(saveUp?.behind ?? 0) + (payDown?.behind ?? 0)} behind
                </span>
              )}
              {(saveUp?.completed ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-body text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  {saveUp?.completed} completed
                </span>
              )}
            </div>

            {/* Activity timeline */}
            {recentActivity.length > 0 && (
              <div className="pt-4 border-t border-dashed border-[hsl(var(--widget-gold)/0.3)]">
                <p className="font-body text-[10px] uppercase tracking-[0.15em] text-muted-foreground mb-3">
                  Recent Activity
                </p>
                <div className="space-y-0">
                  {recentActivity.map((activity, idx) => (
                    // Audit v2 P2: activity rows previously had no way to
                    // reach the goal they describe - link each one to its
                    // /goals/:id detail.
                    <Link
                      key={idx}
                      href={`/goals/${activity.goalId}`}
                      className={cn(
                        "relative block pl-5 py-2 animate-count-up opacity-0 hover:bg-muted/30 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        `stagger-${idx + 1}`
                      )}
                      style={{ animationFillMode: "forwards" }}
                    >
                      {/* Timeline dot and line */}
                      <div className="absolute left-0 top-3 w-2 h-2 rounded-full bg-[hsl(var(--widget-gold))]" />
                      {idx < recentActivity.length - 1 && (
                        <div className="absolute left-[3px] top-5 w-0.5 h-full bg-gradient-to-b from-[hsl(var(--border))] to-transparent" />
                      )}

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-body text-xs font-medium text-foreground truncate max-w-[100px]">
                            {activity.goalName}
                          </span>
                          <span className="font-body text-[10px] text-muted-foreground">
                            {ACTIVITY_LABELS[activity.activityType] ??
                              activity.activityType}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {activity.amount && toMoneyNumber(activity.amount) > 0 && (
                            <span className="font-display text-xs font-medium text-[hsl(var(--widget-income))]">
                              +{formatCurrency(toMoneyNumber(activity.amount))}
                            </span>
                          )}
                          <span className="font-body text-[10px] text-muted-foreground/70">
                            {formatActivityDate(activity.createdAt)}
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
