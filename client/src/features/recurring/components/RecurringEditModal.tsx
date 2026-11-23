/**
 * RecurringEditModal Component
 *
 * Modal for editing recurring transaction details.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RecurringEditForm } from "../types";

interface RecurringEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: RecurringEditForm;
  onFormChange: (updates: Partial<RecurringEditForm>) => void;
  onSave: () => void;
  isSaving: boolean;
  /** Legacy DTO compatibility only; verifiedCurrency controls the denomination display. */
  currency?: string;
  verifiedCurrency?: "ZMW" | null;
}

export function RecurringEditModal({
  isOpen,
  onClose,
  form,
  onFormChange,
  onSave,
  isSaving,
  verifiedCurrency,
}: RecurringEditModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Recurring Transaction</DialogTitle>
          <DialogDescription>
            Update the details for this recurring transaction.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="edit-recurring-name">Name</Label>
            <Input
              id="edit-recurring-name"
              value={form.name}
              onChange={(e) => onFormChange({ name: e.target.value })}
            />
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="edit-recurring-amount">Amount</Label>
            <div className="flex items-center gap-2">
              {(form.confirmDenomination || verifiedCurrency) ? (
                <span className="text-sm text-muted-foreground font-medium">
                  ZMW
                </span>
              ) : <span className="text-sm text-muted-foreground">Currency unconfirmed</span>}
              <Input
                id="edit-recurring-amount"
                type="number"
                step="0.01"
                value={form.amount}
                disabled={!form.confirmDenomination && !verifiedCurrency}
                onChange={(e) => onFormChange({ amount: e.target.value })}
                className="flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-start gap-2" htmlFor="confirm-recurring-denomination">
              <input id="confirm-recurring-denomination" type="checkbox" checked={form.confirmDenomination ?? false}
                onChange={event => onFormChange({ confirmDenomination: event.target.checked, amount: "" })} />
              <span>Confirm a newly entered amount in ZMW</span>
            </label>
            <p className="text-xs text-muted-foreground">Older rules may have an unknown currency. Select this and enter the intended ZMW amount to enable processing. This does not convert the old amount.</p>
            {form.confirmDenomination && !form.expectedDefinition && <p className="text-xs text-muted-foreground">Reload recurring rules before confirming this amount.</p>}
          </div>

          {/* Frequency */}
          <div className="space-y-2">
            <Label htmlFor="edit-recurring-frequency">Frequency</Label>
            <Select
              value={form.frequency}
              onValueChange={(val) =>
                onFormChange({
                  frequency: val as RecurringEditForm["frequency"],
                })
              }
            >
              <SelectTrigger id="edit-recurring-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="semi_annually">Semi-annually</SelectItem>
                <SelectItem value="annually">Annually</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Next Due Date */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-recurring-next-due">Next Due Date</Label>
              <Input
                id="edit-recurring-next-due"
                type="date"
                value={form.nextDueDate ? form.nextDueDate.split("T")[0] : ""}
                onChange={(e) => onFormChange({ nextDueDate: e.target.value })}
              />
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label htmlFor="edit-recurring-end-date">End Date</Label>
              <Input
                id="edit-recurring-end-date"
                type="date"
                value={form.endDate ? form.endDate.split("T")[0] : ""}
                onChange={(e) => onFormChange({ endDate: e.target.value })}
              />
            </div>
          </div>

          {/* Reminders */}
          <div className="space-y-4 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="edit-recurring-reminder-email">Email Reminders</Label>
                <div className="text-xs text-muted-foreground">
                  Receive email notifications for this bill
                </div>
              </div>
              <Switch
                id="edit-recurring-reminder-email"
                checked={form.reminderEmail}
                onCheckedChange={(checked) =>
                  onFormChange({ reminderEmail: checked })
                }
              />
            </div>

            {form.reminderEmail && (
              <div className="space-y-2">
                <Label htmlFor="reminder-days">Days Before</Label>
                <Input
                  id="reminder-days"
                  type="number"
                  min="1"
                  max="30"
                  value={form.reminderDays || 1}
                  onChange={(e) =>
                    onFormChange({ reminderDays: Number(e.target.value) })
                  }
                  className="w-24"
                />
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="edit-recurring-notes">Notes</Label>
            <Textarea
              id="edit-recurring-notes"
              value={form.notes || ""}
              onChange={(e) => onFormChange({ notes: e.target.value })}
              className="min-h-[80px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={isSaving || (form.confirmDenomination === true && (!form.amount || !form.expectedDefinition))}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
