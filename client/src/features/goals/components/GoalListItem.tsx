import { ProtectedImage } from "@/components/session/ProtectedImage";
import { GoalStatusBadge } from "./GoalStatusBadge";
import { GoalProgressBar } from "./GoalProgressBar";
import { useFormatters } from "@/contexts/SettingsContext";
import type { Goal, GoalWithProgress } from "@/hooks/useGoals";
import {
  Target,
  CreditCard,
  Wallet,
  Home,
  Car,
  GraduationCap,
  Heart,
  Plane,
  Gift,
  MoreHorizontal,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn, parseMoney } from "@/lib/utils";
import { GoalProgressHidden, isGoalProgressHidden } from "./GoalProgressHidden";
import { Button } from "@/components/ui/button";

const GOAL_TYPE_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  vacation: Plane,
  emergency_fund: Wallet,
  down_payment: Home,
  wedding: Heart,
  vehicle: Car,
  home_improvement: Home,
  special_event: Gift,
  education: GraduationCap,
  credit_card: CreditCard,
  student_loan: GraduationCap,
  car_loan: Car,
  mortgage: Home,
  personal_loan: Wallet,
  medical_debt: Heart,
  other: Target,
};

interface GoalListItemProps {
  goal: Goal | GoalWithProgress;
  onClick?: () => void;
}

export function GoalListItem({ goal, onClick }: GoalListItemProps) {
  const { formatCurrency } = useFormatters();

  const currentAmount = parseMoney(goal.currentAmount);
  const targetAmount = parseMoney(goal.targetAmount);
  const isPayDown = goal.type === "pay_down";
  const originalBalance = goal.originalBalance
    ? parseMoney(goal.originalBalance)
    : 0;

  const progress = isPayDown
    ? goal.originalBalance
      ? Math.round(
          ((originalBalance - currentAmount) / originalBalance) * 100
        )
      : 0
    : Math.round((currentAmount / targetAmount) * 100);

  const displayProgress = Math.min(100, Math.max(0, progress));

  const IconComponent = GOAL_TYPE_ICONS[goal.goalType ?? "other"] ?? Target;

  // Resolve custom image or icon
  const hasCustomImage = !!goal.customImageUrl;

  // Calculate days left
  const daysLeft = goal.targetDate
    ? Math.max(
        0,
        Math.ceil(
          (new Date(goal.targetDate).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : null;

  const formattedDate = goal.targetDate
    ? new Date(goal.targetDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      role="button"
      tabIndex={0}
      className={cn(
        "group relative flex items-center gap-4 p-4 rounded-xl border bg-card hover:bg-accent/50 hover:shadow-sm transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      {/* Icon / Image Container */}
      <div className="shrink-0">
        <div
          className={cn(
            "flex items-center justify-center w-12 h-12 rounded-lg shadow-sm border border-border/50 overflow-hidden",
            hasCustomImage ? "bg-muted" : "bg-primary/10"
          )}
          style={
            !hasCustomImage && goal.color
              ? { backgroundColor: `${goal.color}20`, color: goal.color } // 20 hex = 12% opacity roughly
              : undefined
          }
        >
          {hasCustomImage ? (
            <ProtectedImage
              src={goal.customImageUrl ?? ""}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <IconComponent
              className={cn(
                "w-6 h-6",
                !goal.color && "text-primary",
                goal.color && "text-[var(--goal-item-color)]" // Use CSS variable
              )}
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {/* Main Info */}
      <div className="flex-1 min-w-0 grid gap-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-base text-foreground truncate">
            {goal.name}
          </h3>
          <GoalStatusBadge status={goal.status} />
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          {isPayDown ? (
            <span className="flex items-center gap-1">
              <TrendingDown className="w-3 h-3" aria-hidden="true" /> Pay Down
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3" aria-hidden="true" /> Save Up
            </span>
          )}

          {formattedDate && (
            <>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
              <span>Target: {formattedDate}</span>
            </>
          )}
        </div>
      </div>

      {/* Progress Section (Desktop: Wide, Mobile: Condensed) */}
      {isGoalProgressHidden(goal) ? (
        <GoalProgressHidden className="hidden sm:block w-1/3 max-w-[240px] px-4" />
      ) : (
      <div className="hidden sm:block w-1/3 max-w-[240px] px-4 space-y-2">
        <div className="flex justify-between text-xs font-medium">
          <span
            className={cn(
              displayProgress >= 100
                ? "text-emerald-600"
                : "text-muted-foreground"
            )}
          >
            {displayProgress}%
          </span>
        </div>
        <GoalProgressBar
          current={
            isPayDown
              ? parseMoney(goal.originalBalance || "0") - currentAmount
              : currentAmount
          }
          target={
            isPayDown ? parseMoney(goal.originalBalance || "0") : targetAmount
          }
          color={goal.color}
        />
      </div>
      )}

      {/* Amounts */}
      <div className="text-right shrink-0">
        <div className="font-bold text-lg text-foreground tracking-tight">
          {isGoalProgressHidden(goal) ? "—" : formatCurrency(currentAmount)}
        </div>
        <div className="text-xs text-muted-foreground font-medium">
          of {formatCurrency(targetAmount)}
        </div>
      </div>

      {/* Hover Action (Chevron) */}
      {/* <div className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground">
          <ChevronRight className="w-5 h-5" />
      </div> */}
    </div>
  );
}
