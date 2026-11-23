/**
 * Rule Creation Modal Component
 *
 * Modal for creating auto-categorization rules.
 */

import { useState, useMemo, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { cn } from "@/lib/utils";
import { useCategories, type Category } from "@/hooks/useCategories";
import { useTags } from "@/hooks/useTags";
import { RuleTagSelector } from "./RuleTagSelector";

// Rule data structure for the onSubmit callback
export interface RuleData {
  merchant: string;
  categoryId: string | null;
  tagIds: string[];
  matchType?: "exact" | "contains";
  applyToExisting?: boolean;
}

interface RuleCreationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMerchant: string;
  initialCategory: string;
  initialCategoryId: string | null;
  onSubmit?: (rule: RuleData) => void | Promise<void>;
}

export function RuleCreationModal({
  open,
  onOpenChange,
  initialMerchant,
  initialCategory,
  initialCategoryId,
  onSubmit,
}: RuleCreationModalProps) {
  const { data: categoriesData } = useCategories();
  const categories = categoriesData?.categories || [];
  const { data: availableTags = [] } = useTags();

  const [isAmountExpanded, setIsAmountExpanded] = useState(false);
  const [isTagsExpanded, setIsTagsExpanded] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState("");
  const [categoryId, setCategoryId] = useState(initialCategoryId || "");
  const [merchant, setMerchant] = useState(initialMerchant);
  const [matchType, setMatchType] = useState<"exact" | "contains">("exact");
  const [applyToExisting, setApplyToExisting] = useState(false);
  const pendingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMerchant(initialMerchant);
    setCategoryId(initialCategoryId || "");
    setTagIds([]);
    setTagInput("");
    setTagError("");
    setIsTagsExpanded(false);
    setIsAmountExpanded(false);
    setMatchType("exact");
    setApplyToExisting(false);
  }, [open, initialMerchant, initialCategoryId]);

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

  const handleAddTag = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !tagInput.trim()) return;
    event.preventDefault();
    const matches = availableTags.filter((tag) => tag.name.toLowerCase() === tagInput.trim().toLowerCase());
    if (matches.length !== 1) {
      setTagError(matches.length === 0
        ? "Select an existing tag. Create new tags in Settings first."
        : "Multiple tags have that name. Choose a distinct tag in Settings first.");
      return;
    }
    const [match] = matches;
    setTagIds((ids) => ids.includes(match.id) ? ids : [...ids, match.id]);
    setTagInput("");
    setTagError("");
  };

  const hasPendingTag = !!tagInput.trim() || !!tagError;

  const handleSave = async () => {
    if (pendingRef.current || !onSubmit || !merchant.trim() || (!categoryId && tagIds.length === 0) || hasPendingTag) return;
    pendingRef.current = true;
    setIsSubmitting(true);
    try {
      await onSubmit({
        merchant: merchant.trim(),
        categoryId: categoryId || null,
        tagIds,
        matchType,
        applyToExisting,
      });
    } catch {
      // The caller reports the save error; retain this draft for an explicit retry.
    } finally {
      pendingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!pendingRef.current) onOpenChange(nextOpen);
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New rule</DialogTitle>
          <DialogDescription>
            Choose the merchant condition and category or existing tags for this rule.
          </DialogDescription>
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
                  <Switch defaultChecked disabled={isSubmitting} />
                </div>
                <div className="space-y-2">
                  <Select value={matchType} onValueChange={(value) => setMatchType(value as "exact" | "contains")} disabled={isSubmitting}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exact">Exactly matches</SelectItem>
                      <SelectItem value="contains">Contains</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={merchant}
                    onChange={(event) => setMerchant(event.target.value)}
                    disabled={isSubmitting}
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
                    disabled={isSubmitting}
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
                <Label htmlFor="rule-category" className="font-medium">Update category</Label>
                <Select value={categoryId || "none"} onValueChange={(value) => setCategoryId(value === "none" ? "" : value)} disabled={isSubmitting}>
                  <SelectTrigger id="rule-category" className="text-sm">
                    <span>{categoryId
                      ? categories.find((category) => category.id === categoryId)?.name || initialCategory || "Category"
                      : "Uncategorized"}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Uncategorized</SelectItem>
                    {Object.entries(groupedCategories).map(([group, groupCategories]) => (
                      <SelectGroup key={group}>
                        <SelectLabel>{group}</SelectLabel>
                        {groupCategories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Tags Update */}
              <RuleTagSelector
                availableTags={availableTags}
                tagIds={tagIds}
                input={tagInput}
                error={tagError}
                expanded={isTagsExpanded}
                disabled={isSubmitting}
                onExpandedChange={(checked) => {
                  setIsTagsExpanded(checked);
                  if (!checked) {
                    setTagIds([]);
                    setTagInput("");
                    setTagError("");
                  }
                }}
                onInputChange={(value) => { setTagInput(value); setTagError(""); }}
                onInputKeyDown={handleAddTag}
                onRemoveTag={(id) => setTagIds((ids) => ids.filter((tagId) => tagId !== id))}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="border-t pt-4">
          <div className="flex items-center gap-2 mr-auto">
            <Switch id="apply-existing" checked={applyToExisting} onCheckedChange={setApplyToExisting} disabled={isSubmitting} />
            <Label htmlFor="apply-existing" className="text-sm font-normal">
              Apply to existing transactions
            </Label>
          </div>
          <Button onClick={handleSave} disabled={isSubmitting || !onSubmit || !merchant.trim() || (!categoryId && tagIds.length === 0) || hasPendingTag}>
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
