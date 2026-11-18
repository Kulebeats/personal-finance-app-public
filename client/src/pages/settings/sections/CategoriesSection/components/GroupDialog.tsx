import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GroupFormState } from "../types";
import { CategoryGroup } from "@shared/schema";

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formState: GroupFormState;
  setFormState: React.Dispatch<React.SetStateAction<GroupFormState>>;
  onSubmit: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  editingGroup: CategoryGroup | null;
}

export function GroupDialog({
  open,
  onOpenChange,
  formState,
  setFormState,
  onSubmit,
  onDelete,
  onRestore,
  editingGroup,
}: GroupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editingGroup ? "Edit Group" : "Add Group"}</DialogTitle>
          <DialogDescription>
            {editingGroup
              ? "Update the settings for this category group."
              : "Create a new group to organize your categories."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={formState.name}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  name: event.target.value,
                }))
              }
              placeholder="e.g. Housing & Utilities"
            />
          </div>

          {!editingGroup && (
            <div className="space-y-2">
              <Label htmlFor="group-type">Type</Label>
              <Select
                value={formState.type}
                onValueChange={(value) =>
                  setFormState((prev) => ({
                    ...prev,
                    type: value as GroupFormState["type"],
                  }))
                }
              >
                <SelectTrigger id="group-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expenses">Expenses</SelectItem>
                  <SelectItem value="transfers">Transfers</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="group-budget-mode">Budget mode</Label>
            <Select
              value={formState.budgetMode}
              onValueChange={(value) =>
                setFormState((prev) => ({
                  ...prev,
                  budgetMode: value as GroupFormState["budgetMode"],
                }))
              }
            >
              <SelectTrigger id="group-budget-mode">
                <SelectValue placeholder="Select budget mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="by_category">By category</SelectItem>
                <SelectItem value="by_group">By group</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {formState.budgetMode === "by_category"
                ? "Budget by individual categories within this group."
                : "Budget for the entire group as a whole."}
            </p>
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          {editingGroup ? (
            editingGroup.isArchived ? (
              <Button type="button" onClick={onRestore}>
                Restore
              </Button>
            ) : (
              <Button type="button" variant="destructive" onClick={onDelete}>
                Archive
              </Button>
            )
          ) : (
            <div></div>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onSubmit}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
