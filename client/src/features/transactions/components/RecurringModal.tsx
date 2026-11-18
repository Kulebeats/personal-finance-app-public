/**
 * Recurring Modal Component
 *
 * Modal for creating a recurring rule from a transaction.
 */

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import type { TransactionWithDetails } from "../types";

type RecurringFrequency =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "semi_annually"
  | "annually"
  | "yearly";

interface RecurringModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionWithDetails | null;
  onSubmit: (data: {
    transactionId: string;
    recurring: {
      frequency: RecurringFrequency;
      startDate: string;
      endDate?: string;
    };
  }) => Promise<void>;
  isLoading?: boolean;
}

export function RecurringModal({
  open,
  onOpenChange,
  transaction,
  onSubmit,
  isLoading = false,
}: RecurringModalProps) {
  const [frequency, setFrequency] = useState<RecurringFrequency | "">("");
  const [endDate, setEndDate] = useState("");

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setFrequency("");
      setEndDate("");
    }
  }, [open]);

  const handleSave = async () => {
    if (!transaction || !frequency) {
      toast.error("Please select a frequency");
      return;
    }

    await onSubmit({
      transactionId: transaction.id,
      recurring: {
        frequency,
        startDate: transaction.date,
        endDate: endDate || undefined,
      },
    });

    onOpenChange(false);
  };

  const displayName =
    transaction?.merchantName || transaction?.name || "this transaction";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as recurring</DialogTitle>
          <DialogDescription>
            Set the cadence for{" "}
            <span className="font-medium text-foreground">{displayName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Frequency</Label>
            <Select
              value={frequency}
              onValueChange={(val) => setFrequency(val as RecurringFrequency)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select frequency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="semi_annually">Semi-annually</SelectItem>
                <SelectItem value="annually">Annually</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>End date (optional)</Label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading || !frequency}>
            {isLoading ? "Saving..." : "Create recurring rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
