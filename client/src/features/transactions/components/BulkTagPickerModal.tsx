import { useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useTags, useCreateTag } from "@/hooks/useTags";
import { Loader2, Plus } from "lucide-react";

interface BulkTagPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSubmit: (tagIds: string[]) => void;
  isLoading?: boolean;
}

export function BulkTagPickerModal({
  open,
  onOpenChange,
  selectedCount,
  onSubmit,
  isLoading = false,
}: BulkTagPickerModalProps) {
  const { data: tags = [] } = useTags();
  const createTagMutation = useCreateTag();
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [newTagName, setNewTagName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTags = tags.filter((tag) =>
    tag.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const toggleTag = (id: string) => {
    const next = new Set(selectedTags);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedTags(next);
  };

  const handleCreateTag = () => {
    if (!newTagName.trim()) return;
    createTagMutation.mutate(
      { name: newTagName.trim() },
      {
        onSuccess: (newTag) => {
          setSelectedTags((prev) => new Set(prev).add(newTag.id));
          setNewTagName("");
        },
      },
    );
  };

  const handleSubmit = () => {
    if (selectedTags.size > 0) {
      onSubmit(Array.from(selectedTags));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Add Tags</DialogTitle>
          <DialogDescription>
            Select tags to add to {selectedCount} selected transaction
            {selectedCount !== 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Input
            placeholder="Search tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className="border rounded-md max-h-[200px] overflow-y-auto p-2 space-y-2">
            {filteredTags.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                No tags found
              </p>
            )}
            {filteredTags.map((tag, index) => (
              <div
                key={tag.id ?? `${tag.name}-${index}`}
                className="flex items-center space-x-2"
              >
                <Checkbox
                  id={tag.id}
                  checked={selectedTags.has(tag.id)}
                  onCheckedChange={() => toggleTag(tag.id)}
                />
                <Label
                  htmlFor={tag.id}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer w-full py-1"
                >
                  {tag.name}
                </Label>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Create new tag..."
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateTag()}
              disabled={createTagMutation.isPending}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCreateTag}
              disabled={!newTagName.trim() || createTagMutation.isPending}
            >
              <Plus className="h-4 w-4" />
            </Button>
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
          <Button
            onClick={handleSubmit}
            disabled={selectedTags.size === 0 || isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
