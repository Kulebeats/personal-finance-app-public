import type { Dispatch, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
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

import { AssignmentRow } from "../GoalHistoryList";
import type { GoalDetailData } from "./useGoalDetailData";

export interface GoalAssignmentsTabProps {
  goal: { type: string };
  goalId: string;
  formatCurrency: (value: number) => string;
  usesHoldings: boolean;
  assignments: GoalDetailData["assignments"];
  filteredAccounts: GoalDetailData["filteredAccounts"];
  assignmentAccountId: string;
  setAssignmentAccountId: Dispatch<SetStateAction<string>>;
  assignmentType: "full_balance" | "partial_balance";
  setAssignmentType: Dispatch<SetStateAction<"full_balance" | "partial_balance">>;
  partialAmount: string;
  setPartialAmount: Dispatch<SetStateAction<string>>;
  disableFullBalanceAssignment?: boolean;
  handleAssign: () => void;
  canAssign: boolean;
  isAssigning: boolean;
}

export function GoalAssignmentsTab({
  goal,
  goalId,
  formatCurrency,
  usesHoldings,
  assignments,
  filteredAccounts,
  assignmentAccountId,
  setAssignmentAccountId,
  assignmentType,
  setAssignmentType,
  partialAmount,
  setPartialAmount,
  disableFullBalanceAssignment,
  handleAssign,
  canAssign,
  isAssigning,
}: GoalAssignmentsTabProps) {
  if (goal.type === "pay_down") {
    return (
      <p className="text-sm text-muted-foreground">
        Pay down goals track a debt account and do not use assignments.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {usesHoldings ? (
        <p className="text-sm text-muted-foreground">
          Holdings-synced goals track linked investment accounts.
          Assignments are managed automatically.
        </p>
      ) : null}
      <div className="grid gap-3">
        {assignments.map((assignment) => (
          <AssignmentRow
            key={assignment.id}
            assignment={assignment}
            goalId={goalId}
            formatCurrency={formatCurrency}
            canRemove={!usesHoldings}
          />
        ))}
      </div>

      {!usesHoldings ? (
        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Add assignment</div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label>Account</Label>
              <Select
                value={assignmentAccountId}
                onValueChange={setAssignmentAccountId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {filteredAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select
                value={assignmentType}
                onValueChange={(value) =>
                  setAssignmentType(
                    value as "full_balance" | "partial_balance"
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="full_balance"
                    disabled={disableFullBalanceAssignment ?? undefined}
                  >
                    Full balance
                  </SelectItem>
                  <SelectItem value="partial_balance">Partial</SelectItem>
                </SelectContent>
              </Select>
              {disableFullBalanceAssignment ? (
                <p className="text-xs text-amber-600">
                  Full balance assignments are disabled when spending
                  reduces progress is enabled.
                </p>
              ) : null}
            </div>
            <div>
              <Label>Partial amount</Label>
              <Input
                type="number"
                inputMode="decimal"
                disabled={assignmentType !== "partial_balance"}
                value={partialAmount}
                onChange={(event) => setPartialAmount(event.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleAssign}
            disabled={!canAssign || isAssigning}
          >
            Assign
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
