import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAddContribution, type Goal } from "@/hooks/useGoals";

interface GoalContributionModalProps {
  goal: Goal;
  open: boolean;
  onClose: () => void;
}

export function GoalContributionModal({
  goal,
  open,
  onClose,
}: GoalContributionModalProps) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

  const addContribution = useAddContribution();

  const handleSubmit = () => {
    if (!amount) return;

    addContribution.mutate(
      {
        id: goal.id,
        data: {
          amount: { amount, currency: goal.currency || "ZMW" },
          date: date || undefined,
          notes: notes || undefined,
        },
      },
      {
        onSuccess: () => {
          setAmount("");
          setDate("");
          setNotes("");
          onClose();
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Contribution to {goal.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Optional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!amount || addContribution.isPending}
          >
            {addContribution.isPending ? "Adding..." : "Add Contribution"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
