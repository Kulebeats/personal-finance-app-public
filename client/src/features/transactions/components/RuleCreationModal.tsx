/**
 * Rule Creation Modal Component
 *
 * Modal for creating auto-categorization rules.
 */

import { useState, useMemo } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Tag, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCategories, type Category } from "@/hooks/useCategories";

// Rule data structure for the onSubmit callback
export interface RuleData {
  merchant: string;
  category: string;
  tags: string[];
  matchType?: "exact" | "contains";
  applyToExisting?: boolean;
}

interface RuleCreationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMerchant: string;
  initialCategory: string;
  availableTags?: string[];
  onSubmit?: (rule: RuleData) => void;
}

export function RuleCreationModal({
  open,
  onOpenChange,
  initialMerchant,
  initialCategory,
  availableTags = [],
  onSubmit,
}: RuleCreationModalProps) {
  const { data: categoriesData } = useCategories();
  const categories = categoriesData?.categories || [];

  const [isAmountExpanded, setIsAmountExpanded] = useState(false);
  const [isTagsExpanded, setIsTagsExpanded] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const groupedCategories = useMemo(() => {
    return categories.reduce(
      (acc, cat) => {
        const group = cat.groupName || "Other";
        if (!acc[group]) acc[group] = [];
        acc[group].push(cat);
        return acc;
      },
      {} as Record<string, Category[]>,
    );
  }, [categories]);

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSave = () => {
    onSubmit?.({
      merchant: initialMerchant,
      category: initialCategory,
      tags,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New rule</DialogTitle>
          <div className="flex gap-4 text-sm font-medium mt-2 border-b">
            <button className="pb-2 border-b-2 border-primary text-foreground px-1">
              Settings
            </button>
            <button className="pb-2 text-muted-foreground px-1">
              Preview changes
            </button>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-4">
          {/* IF criteria */}
          <div className="space-y-6">
            <h3 className="font-semibold text-sm">
              If transaction matches criteria...
            </h3>

            <div className="space-y-4">
              {/* Merchant Rule */}
              <div className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="font-medium">Merchants</Label>
                  <Switch defaultChecked />
                </div>
                <div className="space-y-2">
                  <Select defaultValue="exact">
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exact">Exactly matches</SelectItem>
                      <SelectItem value="contains">Contains</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    defaultValue={initialMerchant}
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              {/* Amount Rule */}
              <div
                className={cn(
                  "border rounded-lg p-4",
                  isAmountExpanded
                    ? "space-y-3"
                    : "flex items-center justify-between",
                )}
              >
                <Label
                  className={cn(
                    "font-medium",
                    !isAmountExpanded && "text-muted-foreground",
                  )}
                >
                  Amount
                </Label>
                <Switch
                  checked={isAmountExpanded}
                  onCheckedChange={setIsAmountExpanded}
                />
              </div>
            </div>
          </div>

          {/* THEN updates */}
          <div className="space-y-6">
            <h3 className="font-semibold text-sm">
              Then apply these updates...
            </h3>

            <div className="space-y-4">
              {/* Category Update */}
              <div className="border rounded-lg p-4 space-y-3 bg-muted/10">
                <div className="flex items-center justify-between">
                  <Label className="font-medium">Update category</Label>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center gap-2 p-2 bg-background border rounded-md">
                  <span className="text-sm">{initialCategory}</span>
                  <ChevronDown className="ml-auto w-4 h-4 text-muted-foreground" />
                </div>
              </div>

              {/* Tags Update */}
              <div
                className={cn(
                  "border rounded-lg p-4",
                  isTagsExpanded
                    ? "space-y-3"
                    : "flex items-center justify-between",
                )}
              >
                {isTagsExpanded ? (
                  <>
                    <div className="flex items-center justify-between">
                      <Label className="font-medium">Add tags</Label>
                      <Switch
                        checked={isTagsExpanded}
                        onCheckedChange={setIsTagsExpanded}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 p-2 border border-dashed rounded-md min-h-[40px]">
                      {tags.map((tag) => (
                        <div
                          key={tag}
                          className="bg-muted px-2 py-1 rounded text-xs font-medium flex items-center gap-1"
                        >
                          <Tag className="w-3 h-3" />
                          {tag}
                          <button onClick={() => handleRemoveTag(tag)}>
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <Input
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyDown={handleAddTag}
                        className="flex-1 min-w-[100px] h-7 border-0 shadow-none"
                        placeholder="Type tag..."
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <Label className="font-medium text-muted-foreground">
                      Add tags
                    </Label>
                    <Switch
                      checked={isTagsExpanded}
                      onCheckedChange={setIsTagsExpanded}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t pt-4">
          <div className="flex items-center gap-2 mr-auto">
            <Switch id="apply-existing" />
            <Label htmlFor="apply-existing" className="text-sm font-normal">
              Apply to existing transactions
            </Label>
          </div>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
