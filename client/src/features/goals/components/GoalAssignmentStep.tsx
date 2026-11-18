/**
 * Account Assignment Step for Goal Creation Wizard
 */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseMoney } from "@/lib/utils";

// Minimal Account interface for this component
interface AccountInfo {
  id: string;
  name: string;
  balance: string | null;
}

export type AssignmentDraft = {
  accountId: string;
  assignmentType: "none" | "full_balance" | "partial_balance";
  partialAmount: string;
};

interface AvailableFund {
  accountId: string;
  availableAmount: string;
}

interface GoalAssignmentStepProps {
  accounts: AccountInfo[];
  assignments: Record<string, AssignmentDraft>;
  onAssignmentChange: (accountId: string, changes: Partial<AssignmentDraft>) => void;
  availableFunds: AvailableFund[];
  totalAssigned: number;
  remainingAmount: number;
  monthsRemaining: number | null;
  monthlyNeeded: number | null;
  spendingReducesProgress: boolean;
  formatCurrency: (amount: number) => string;
}

function parseAmount(value?: string | null): number {
  return parseMoney(value);
}

export function GoalAssignmentStep({
  accounts,
  assignments,
  onAssignmentChange,
  availableFunds,
  totalAssigned,
  remainingAmount,
  monthsRemaining,
  monthlyNeeded,
  spendingReducesProgress,
  formatCurrency,
}: GoalAssignmentStepProps) {
  const availableFundsByAccount = useMemo(() => {
    const map = new Map<string, AvailableFund>();
    availableFunds.forEach((row) => map.set(row.accountId, row));
    return map;
  }, [availableFunds]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Assigned balance</p>
            <p className="text-xs text-muted-foreground">
              Based on selected accounts
            </p>
          </div>
          <div className="text-sm font-semibold">
            {formatCurrency(totalAssigned)}
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Remaining to target</span>
            <span>{formatCurrency(remainingAmount)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Months remaining</span>
            <span>{monthsRemaining ?? "--"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Monthly needed</span>
            <span>
              {monthlyNeeded !== null ? formatCurrency(monthlyNeeded) : "--"}
            </span>
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        {accounts.map((account) => {
          const assignment =
            assignments[account.id] ??
            ({
              accountId: account.id,
              assignmentType: "none",
              partialAmount: "",
            } as AssignmentDraft);
          const available = availableFundsByAccount.get(account.id);
          const disableFullBalance = spendingReducesProgress;

          return (
            <Card key={account.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{account.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Balance: {formatCurrency(parseAmount(account.balance))}
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  Available:{" "}
                  {available
                    ? formatCurrency(parseAmount(available.availableAmount))
                    : "--"}
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Assignment</Label>
                <Select
                  value={assignment.assignmentType}
                  onValueChange={(val) =>
                    onAssignmentChange(account.id, {
                      assignmentType: val as AssignmentDraft["assignmentType"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem
                      value="full_balance"
                      disabled={disableFullBalance}
                    >
                      Full balance (auto)
                    </SelectItem>
                    <SelectItem value="partial_balance">
                      Partial balance
                    </SelectItem>
                  </SelectContent>
                </Select>
                {disableFullBalance &&
                assignment.assignmentType === "full_balance" ? (
                  <p className="text-xs text-amber-600">
                    Full balance is disabled when spending reduces progress.
                  </p>
                ) : null}
              </div>

              {assignment.assignmentType === "partial_balance" ? (
                <div className="grid gap-2">
                  <Label>Partial amount</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={assignment.partialAmount}
                    onChange={(event) =>
                      onAssignmentChange(account.id, {
                        partialAmount: event.target.value,
                      })
                    }
                  />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
