import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { useAddContribution } from "@/hooks/useGoals";
import type { Goal } from "../types";

interface GoalContributionFormProps {
  goal: Goal;
  onSuccess?: () => void;
}

export function GoalContributionForm({
  goal,
  onSuccess,
}: GoalContributionFormProps) {
  const [contributionAmount, setContributionAmount] = useState("");
  const [contributionDate, setContributionDate] = useState("");
  const [contributionNotes, setContributionNotes] = useState("");

  const addContribution = useAddContribution();

  const handleContribution = () => {
    if (!goal) return;

    addContribution.mutate(
      {
        id: goal.id,
        data: {
          amount: {
            amount: contributionAmount,
            currency: goal.currency || "ZMW",
          },
          date: contributionDate || undefined,
          notes: contributionNotes || undefined,
        },
      },
      {
        onSuccess: () => {
          setContributionAmount("");
          setContributionDate("");
          setContributionNotes("");
          onSuccess?.();
        },
      }
    );
  };

  return (
    <div className="space-y-4 pt-4 border-t">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <Label>Amount</Label>
          <Input
            type="number"
            value={contributionAmount}
            onChange={(e) => setContributionAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <Label>Date (Optional)</Label>
          <Input
            type="date"
            value={contributionDate}
            onChange={(e) => setContributionDate(e.target.value)}
          />
        </div>
        <div>
          <Label>Notes (Optional)</Label>
          <Input
            value={contributionNotes}
            onChange={(e) => setContributionNotes(e.target.value)}
            placeholder="Contribution details"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleContribution}
          disabled={!contributionAmount || addContribution.isPending}
        >
          Add Contribution
        </Button>
      </div>
    </div>
  );
}
