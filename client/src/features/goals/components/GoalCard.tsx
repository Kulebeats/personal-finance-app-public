import { Card, CardContent } from "@/components/ui/card";
import { GoalStatusBadge } from "./GoalStatusBadge";
import { GoalProgressBar } from "./GoalProgressBar";
import { useFormatters } from "@/contexts/SettingsContext";
import type { Goal, GoalWithProgress } from "@/hooks/useGoals";
import {
  Target,
  Calendar,
  TrendingUp,
  TrendingDown,
  CreditCard,
  Wallet,
  Home,
  Car,
  GraduationCap,
  Heart,
  Plane,
  Gift,
  MoreHorizontal,
} from "lucide-react";
import { cn, parseMoney } from "@/lib/utils";
import { GoalProgressHidden, isGoalProgressHidden } from "./GoalProgressHidden";

const GOAL_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
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

interface GoalCardProps {
  goal: Goal | GoalWithProgress;
  onClick?: () => void;
  compact?: boolean;
}

export function GoalCard({ goal, onClick, compact = false }: GoalCardProps) {
  const { formatCurrency } = useFormatters();

  const currentAmount = parseMoney(goal.currentAmount);
  const targetAmount = parseMoney(goal.targetAmount);
  const isPayDown = goal.type === "pay_down";
  const originalBalance = goal.originalBalance
    ? parseMoney(goal.originalBalance)
    : 0;
  // For pay_down goals, targetAmount="0" but we want originalBalance for display
  const effectiveTarget = isPayDown ? originalBalance : targetAmount;

  const progress = isPayDown
    ? effectiveTarget > 0
      ? Math.round(
          ((effectiveTarget - currentAmount) / effectiveTarget) * 100
        )
      : 0
    : effectiveTarget > 0
      ? Math.round((currentAmount / effectiveTarget) * 100)
      : 0;

  const displayProgress = Math.min(100, Math.max(0, progress));
  const isProgressHidden = isGoalProgressHidden(goal);

  const IconComponent = GOAL_TYPE_ICONS[goal.goalType ?? "other"] ?? Target;

  const daysLeft = goal.targetDate
    ? Math.max(
        0,
        Math.ceil(
          (new Date(goal.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        )
      )
    : null;

  if (compact) {
    return (
      <div
        onClick={onClick}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && onClick) {
            e.preventDefault();
            onClick();
          }
        }}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors",
          onClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-full",
            !goal.color && "bg-primary"
          )}
          style={goal.color ? { backgroundColor: goal.color } : undefined}
        >
          <IconComponent className="w-5 h-5 text-white" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm truncate">{goal.name}</span>
            <GoalStatusBadge status={goal.status} size="sm" />
          </div>
          {isProgressHidden ? (
            <GoalProgressHidden className="mt-1" />
          ) : (
            <>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-muted-foreground">
                  {formatCurrency(isPayDown ? effectiveTarget - currentAmount : currentAmount)} /{" "}
                  {formatCurrency(effectiveTarget)}
                </span>
                <span className="text-xs font-medium">{displayProgress}%</span>
              </div>
              <GoalProgressBar
                current={isPayDown ? effectiveTarget - currentAmount : currentAmount}
                target={effectiveTarget}
                color={goal.color}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && onClick) {
          e.preventDefault();
          onClick();
        }
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn(
        "overflow-hidden transition-all hover:shadow-md",
        onClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <div
        className={cn("h-2", !goal.color && "bg-primary")}
        style={goal.color ? { backgroundColor: goal.color } : undefined}
      />
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex items-center justify-center w-10 h-10 rounded-full",
                !goal.color && "bg-primary"
              )}
              style={goal.color ? { backgroundColor: goal.color } : undefined}
            >
              <IconComponent className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">{goal.name}</h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isPayDown ? (
                  <TrendingDown className="w-3 h-3" aria-hidden="true" />
                ) : (
                  <TrendingUp className="w-3 h-3" aria-hidden="true" />
                )}
                <span>{isPayDown ? "Pay Down" : "Save Up"}</span>
              </div>
            </div>
          </div>
          <GoalStatusBadge status={goal.status} />
        </div>

        {isProgressHidden ? (
          <GoalProgressHidden />
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{displayProgress}%</span>
            </div>
            <GoalProgressBar
              current={isPayDown ? effectiveTarget - currentAmount : currentAmount}
              target={effectiveTarget}
              color={goal.color}
            />
          </div>
        )}

        <div className="flex items-center justify-between text-xs">
          <div>
            <span className="text-muted-foreground">
              {isPayDown ? "Remaining" : "Saved"}
            </span>
            <p className="font-semibold text-sm">
              {isProgressHidden ? "—" : formatCurrency(currentAmount)}
            </p>
          </div>
          <div className="text-right">
            <span className="text-muted-foreground">Target</span>
            <p className="font-semibold text-sm">{formatCurrency(effectiveTarget)}</p>
          </div>
        </div>

        {goal.targetDate && daysLeft !== null && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground pt-1 border-t">
            <Calendar className="w-3 h-3" aria-hidden="true" />
            <span>
              {daysLeft > 0
                ? `${daysLeft} days left`
                : daysLeft === 0
                ? "Due today"
                : "Overdue"}
            </span>
            <span className="text-muted-foreground/70">
              ({new Date(goal.targetDate).toLocaleDateString()})
            </span>
          </div>
        )}

        {goal.monthlyProjection && !isPayDown && (
          <div className="text-xs text-muted-foreground">
            Need{" "}
            <span className="font-medium text-foreground">
              {formatCurrency(parseMoney(goal.monthlyProjection))}
            </span>
            /month to stay on track
          </div>
        )}

        {isPayDown && goal.interestRate && (
          <div className="text-xs text-muted-foreground">
            APR: {goal.interestRate}%
            {goal.monthlyPayment && (
              <span>
                {" "}
                | Payment: {formatCurrency(parseMoney(goal.monthlyPayment))}/mo
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
