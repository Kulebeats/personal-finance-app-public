/**
 * TagModal Component
 *
 * Modal for creating or editing a tag with color picker and name input.
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
import { Loader2 } from "lucide-react";
import { TagColorPicker, TAG_COLORS } from "./TagColorPicker";
import { useCreateTag, useUpdateTag } from "@/hooks";
import type { Tag } from "@/lib/api";

interface TagModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tag?: Tag | null; // If provided, edit mode; otherwise create mode
}

export function TagModal({ open, onOpenChange, tag }: TagModalProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(TAG_COLORS[0]);

  const createTag = useCreateTag();
  const updateTag = useUpdateTag();

  const isEditing = !!tag;
  const isLoading = createTag.isPending || updateTag.isPending;

  // Reset form when modal opens or tag changes
  useEffect(() => {
    if (open) {
      if (tag) {
        setName(tag.name);
        setColor(tag.color || TAG_COLORS[0]);
      } else {
        setName("");
        setColor(TAG_COLORS[0]);
      }
    }
  }, [open, tag]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) return;

    try {
      if (isEditing && tag) {
        await updateTag.mutateAsync({
          id: tag.id,
          data: { name: name.trim(), color },
        });
      } else {
        await createTag.mutateAsync({
          name: name.trim(),
          color,
        });
      }
      onOpenChange(false);
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit tag" : "New tag"}</DialogTitle>
          <DialogDescription>
            Set the tag name and color used when organizing transactions.
          </DialogDescription>
        </DialogHeader>

        {/* CODE-009: ARIA live region for loading/error states */}
        <div role="status" aria-live="polite" className="sr-only">
          {isLoading ? "Saving tag..." : ""}
          {createTag.isError ? "Error creating tag" : ""}
          {updateTag.isError ? "Error updating tag" : ""}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tagName">Color & Name</Label>
              <div className="flex items-center gap-3">
                {/* CODE-007: Make decorative color preview not focusable */}
                <span
                  className="h-8 w-8 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <Input
                  id="tagName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name your tag..."
                  maxLength={50}
                  autoFocus
                />
              </div>
            </div>

            <div className="pt-2">
              <TagColorPicker value={color} onChange={setColor} />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || isLoading}
            >
              {/* CODE-008: Add sr-only label to loading spinner */}
              {isLoading && (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  <span className="sr-only">Saving...</span>
                </>
              )}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
