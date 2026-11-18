import React, { useRef, useEffect } from "react";
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
import { Switch } from "@/components/ui/switch";
import { CategoryFormState } from "../types";
import { Category, CategoryGroup } from "@shared/schema";

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formState: CategoryFormState;
  setFormState: React.Dispatch<React.SetStateAction<CategoryFormState>>;
  onSubmit: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  editingCategory: Category | null;
  groups: CategoryGroup[];
}

export function CategoryDialog({
  open,
  onOpenChange,
  formState,
  setFormState,
  onSubmit,
  onDelete,
  onRestore,
  editingCategory,
  groups,
}: CategoryDialogProps) {
  const triggerRef = useRef<HTMLElement | null>(null);

  // Store reference to the trigger element when dialog opens
  useEffect(() => {
    if (open && !triggerRef.current) {
      triggerRef.current = document.activeElement as HTMLElement;
    }
  }, [open]);

  // Return focus to trigger element when dialog closes
  useEffect(() => {
    if (!open && triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingCategory ? "Edit Category" : "Add Category"}
          </DialogTitle>
          <DialogDescription hidden>
            Create or update a category.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              value={formState.name}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  name: event.target.value,
                }))
              }
              placeholder="e.g. Groceries"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category-group">Group</Label>
            <Select
              value={formState.groupId}
              onValueChange={(value) =>
                setFormState((prev) => ({ ...prev, groupId: value }))
              }
            >
              <SelectTrigger id="category-group">
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                {groups
                  .filter((group) => !group.isArchived)
                  .map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="category-icon">Icon (Emoji/Text)</Label>
              <div className="flex gap-2">
                <div className="flex items-center justify-center w-10 h-10 border rounded bg-muted text-xl">
                  {formState.icon || formState.name.charAt(0)}
                </div>
                <Input
                  id="category-icon"
                  value={formState.icon}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      icon: event.target.value,
                    }))
                  }
                  placeholder="Emoji"
                  className="flex-1"
                  maxLength={2}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-color">Color</Label>
              <div className="flex gap-2">
                <div
                  className="w-10 h-10 rounded border shrink-0"
                  style={{ backgroundColor: formState.color }}
                  aria-hidden="true"
                />
                <Input
                  id="category-color"
                  type="color"
                  value={formState.color}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      color: event.target.value,
                    }))
                  }
                  aria-label="Select category color"
                  className="flex-1"
                />
              </div>
            </div>
          </div>

          {/* Advanced toggles */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="include-budget" className="cursor-pointer">
                Include in budget
              </Label>
              <Switch
                id="include-budget"
                checked={formState.includeInBudget}
                onCheckedChange={(value) =>
                  setFormState((prev) => ({
                    ...prev,
                    includeInBudget: value,
                  }))
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          {editingCategory ? (
            editingCategory.isArchived ? (
              <Button type="button" onClick={onRestore}>
                Restore
              </Button>
            ) : (
              <Button type="button" variant="destructive" onClick={onDelete}>
                Delete
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
