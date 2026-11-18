import { useAccounts } from "@/hooks/useAccounts";
import { useFormatters } from "@/contexts/SettingsContext";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useState, useEffect, useCallback } from "react";
import { ArrowDownRight } from "lucide-react";
import { parseMoney } from "@/lib/utils";
import type { GoalFormData } from "./StepTargets";

interface StepContributionProps {
  goals: GoalFormData[];
  data: {
    initialAmount: string;
    initialSourceAccountId?: string;
  };
  onChange: (data: {
    initialAmount: string;
    initialSourceAccountId?: string;
  }) => void;
}

export function StepContribution({
  goals,
  data,
  onChange,
}: StepContributionProps) {
  const { data: accounts } = useAccounts();
  const { formatCurrency } = useFormatters();
  const [selectedAccount, setSelectedAccount] = useState<string>(
    data.initialSourceAccountId ?? ""
  );
  const [amount, setAmount] = useState(data.initialAmount);

  // Filter for liquid accounts (checking, savings, etc)
  const availableAccounts =
    accounts?.filter((acc) =>
      ["checking", "savings", "cash"].includes(acc.type.toLowerCase())
    ) || [];

  const handleChange = useCallback(
    (newAmount: string, newAccount: string) => {
      onChange({
        initialAmount: newAmount,
        initialSourceAccountId: newAccount || undefined,
      });
    },
    [onChange]
  );

  useEffect(() => {
    handleChange(amount, selectedAccount);
  }, [amount, selectedAccount, handleChange]);

  return (
    <div className="grid lg:grid-cols-[1fr_350px] gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Left Column */}
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-bold tracking-tight">
            Add funds you have already saved
          </h2>
          <p className="text-sm text-muted-foreground">
            This will add the progress you've already made, and help us
            determine the monthly contribution needed to meet your targets for
            each goal.
          </p>
        </div>

        {/* Account dropdown */}
        <div className="space-y-2">
          <Select
            value={selectedAccount}
            onValueChange={(value) => setSelectedAccount(value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {availableAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  <div className="flex justify-between items-center w-full gap-4">
                    <span>{account.name}</span>
                    <span className="text-muted-foreground">
                      {formatCurrency(parseMoney(account.balance))}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Arrow graphic and "Get a head start" */}
        <div className="flex flex-col items-center py-8 text-center">
          <div className="w-20 h-20 relative mb-4">
            <ArrowDownRight
              className="w-16 h-16 text-muted-foreground/30 transform rotate-45"
              strokeWidth={1}
            />
          </div>
          <div className="font-semibold text-lg">Get a head start</div>
          <div className="text-sm text-muted-foreground">
            Choose an account from which you'd like to contribute funds.
          </div>
        </div>

        {/* Amount input (only shown when account selected) */}
        {selectedAccount && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <Label>Amount to contribute</Label>
            <div className="relative max-w-xs">
              <span className="absolute left-3 top-2.5 text-muted-foreground text-lg">
                $
              </span>
              <Input
                type="number"
                className="pl-8 text-lg h-12"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Right Column: Goals summary sidebar */}
      <div className="hidden lg:block space-y-4">
        <div className="font-medium">Goals ({goals.length})</div>
        <Card className="divide-y">
          {goals.map((goal) => (
            <div
              key={goal.id}
              className="flex items-center justify-between p-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden">
                  {goal.imageUrl ? (
                    <img
                      src={goal.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-500 font-medium">
                      {(goal.name || goal.templateId || "G")
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}
                </div>
                <div>
                  <div className="font-medium">{goal.name || "Untitled"}</div>
                  <div className="text-xs text-muted-foreground">
                    {goal.targetDate
                      ? new Date(goal.targetDate).toLocaleDateString(
                          undefined,
                          {
                            month: "short",
                            year: "numeric",
                          }
                        )
                      : "No target date"}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold">{formatCurrency(0)}</div>
                <div className="text-xs text-muted-foreground">
                  {goal.targetAmount
                    ? `of ${formatCurrency(parseMoney(goal.targetAmount))}`
                    : "No target amount"}
                </div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
