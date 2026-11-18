import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { useCategories } from "@/hooks/useCategories";
import { Loader2 } from "lucide-react";

interface BulkCategoryPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSubmit: (categoryId: string) => void;
  isLoading?: boolean;
}

export function BulkCategoryPickerModal({
  open,
  onOpenChange,
  selectedCount,
  onSubmit,
  isLoading = false,
}: BulkCategoryPickerModalProps) {
  const { data: categoriesData } = useCategories();
  const categories = categoriesData?.categories ?? [];
  const [categoryId, setCategoryId] = useState<string>("");

  // Group categories by group type
  const groupedCategories = useMemo(() => {
    const groups: Record<string, typeof categories> = {};
    for (const cat of categories) {
      const group = cat.groupType || "Other";
      groups[group] = groups[group] ?? [];
      groups[group].push(cat);
    }
    return groups;
  }, [categories]);

  const handleSubmit = () => {
    if (categoryId) {
      onSubmit(categoryId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Categorize</DialogTitle>
          <DialogDescription>
            Select a category to apply to {selectedCount} selected transaction
            {selectedCount !== 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {Object.entries(groupedCategories).map(([group, cats]) => (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {cats.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!categoryId || isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply Category
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
