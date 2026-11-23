import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import type { Goal } from "@/hooks/useGoals";

type TransferMode = "goal-to-goal" | "account-to-goal";

type GoalTransferFormProps = {
  mode: TransferMode;
  onModeChange: (value: TransferMode) => void;
  goals: Goal[];
  accounts: Array<{ id: string; name: string; type: string }>;
  availableTargets: Goal[];
  fromId: string;
  onFromChange: (value: string) => void;
  toGoalId: string;
  onToGoalChange: (value: string) => void;
  amount: string;
  /** Why the typed amount cannot be sent; shown under the field. */
  amountError?: string;
  onAmountChange: (value: string) => void;
  date: Date;
  onDateChange: (value: Date) => void;
  reason: string;
  onReasonChange: (value: string) => void;
  isBudget: boolean;
  onBudgetChange: (value: boolean) => void;
  budgetCategory?: { id: string; name: string } | null;
};

export function GoalTransferForm({
  mode,
  onModeChange,
  goals,
  accounts,
  availableTargets,
  fromId,
  onFromChange,
  toGoalId,
  onToGoalChange,
  amount,
  amountError,
  onAmountChange,
  date,
  onDateChange,
  reason,
  onReasonChange,
  isBudget,
  onBudgetChange,
  budgetCategory,
}: GoalTransferFormProps) {
  return (
    <Tabs value={mode} onValueChange={(value) => onModeChange(value as TransferMode)} className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="goal-to-goal">Between Goals</TabsTrigger>
        <TabsTrigger value="account-to-goal">From Account</TabsTrigger>
      </TabsList>

      <div className="grid gap-4 py-4">
        {mode === "goal-to-goal" ? (
          <div className="grid gap-2">
            <Label>From goal</Label>
            <Select value={fromId} onValueChange={onFromChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select source goal" />
              </SelectTrigger>
              <SelectContent>
                {goals.map((goal) => (
                  <SelectItem key={goal.id} value={goal.id}>
                    {goal.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label>From account</Label>
            <Select value={fromId} onValueChange={onFromChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select source account" />
              </SelectTrigger>
              <SelectContent>
                {accounts
                  .filter((account) =>
                    ["checking", "savings", "cash"].includes(
                      account.type.toLowerCase()
                    )
                  )
                  .map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} ({format(new Date(), "MMM")})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid gap-2">
          <Label>To goal</Label>
          <Select value={toGoalId} onValueChange={onToGoalChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select destination goal" />
            </SelectTrigger>
            <SelectContent>
              {availableTargets.map((goal) => (
                <SelectItem key={goal.id} value={goal.id}>
                  {goal.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="transfer-amount">Amount</Label>
            <Input
              id="transfer-amount"
              type="number"
              value={amount}
              onChange={(event) => onAmountChange(event.target.value)}
              placeholder="0.00"
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? "transfer-amount-error" : undefined}
            />
            {amountError ? (
              <p id="transfer-amount-error" role="alert" className="text-sm text-destructive">
                {amountError}
              </p>
            ) : null}
          </div>
          {mode === "account-to-goal" ? (
            <div className="grid gap-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(selected) => selected && onDateChange(selected)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          ) : null}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="transfer-reason">Reason (optional)</Label>
          <Input
            id="transfer-reason"
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            placeholder="e.g. Monthly contribution"
          />
        </div>

        {mode === "account-to-goal" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between border rounded-lg p-3">
              <div className="space-y-0.5">
                <Label className="text-base">Track as Budget</Label>
                <div className="text-xs text-muted-foreground">
                  Include this in your monthly budget
                </div>
              </div>
              <Switch checked={isBudget} onCheckedChange={onBudgetChange} />
            </div>
            {isBudget ? (
              budgetCategory ? (
                <p className="text-xs text-muted-foreground">
                  Budget category: {budgetCategory.name}
                </p>
              ) : (
                <p className="text-xs text-amber-600">
                  Add a savings or investment category to track this in your budget.
                </p>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </Tabs>
  );
}
