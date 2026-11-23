/**
 * NEW-29: a contribution that would take a goal past its target needs an
 * explicit confirmation. The server enforces it (409 without
 * `confirmOverfund: true`); this control only lets the member give it.
 */
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { moneyValueToDecimal, parseMoneyString } from "@/lib/money";

interface OverfundGoal {
  id: string;
  type?: string;
  currentAmount?: string | number | null;
  targetAmount?: string | number | null;
  progressAvailability?: "available" | "unavailable";
}

/**
 * Display hint only: whether `amount` would take the goal past its target,
 * in exact decimal: 0.10 + 0.20 is 0.30, not past it (#245, Astra round 4).
 */
export function wouldOverfund(goal: OverfundGoal, amount: string): boolean {
  const target = moneyValueToDecimal(goal.targetAmount);
  return target.gt(0) && moneyValueToDecimal(goal.currentAmount).plus(parseMoneyString(amount)).gt(target);
}

/**
 * Whether the server will ask for `confirmOverfund` on money moved into this
 * goal: always when its progress is hidden from you (the server cannot say
 * whether it is at its target without revealing it), otherwise when the amount
 * takes it past the target. A debt goal has no target to overfund.
 */
export function needsOverfundConfirm(goal: OverfundGoal | undefined, amount: string): boolean {
  if (!goal || goal.type === "pay_down") return false;
  return goal.progressAvailability === "unavailable" || wouldOverfund(goal, amount);
}

interface OverfundConfirmProps {
  goal: OverfundGoal;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function OverfundConfirm({ goal, checked, onCheckedChange }: OverfundConfirmProps) {
  const id = `confirm-overfund-${goal.id}`;
  const label = goal.progressAvailability === "unavailable"
    ? "This goal includes sources you can't see, so it may already be past its target. Record it anyway."
    : "This takes the goal past its target. Record it anyway.";
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}
