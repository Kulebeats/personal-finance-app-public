import React from "react";
import { Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "@/components/ui/select";
import { TagsMultiSelect } from "@/components/tags";
import { RuleAction, SplitConfig } from "../types";
import { ACTION_TYPES, removedActionLabel, toTagIds } from "../constants";

interface ActionCardProps {
  action: RuleAction;
  onUpdate: (updates: Partial<RuleAction>) => void;
  onRemove: () => void;
  categories: Array<{ id: string; name: string }>;
  merchants: Array<{ id: string; name: string }>;
  goals: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
}

export function ActionCard({
  action,
  onUpdate,
  onRemove,
  categories,
  merchants,
  goals,
  members,
}: ActionCardProps) {
  const actionType = ACTION_TYPES.find((a) => a.value === action.type);

  // Helper to update splits
  const updateSplit = (index: number, updates: Partial<SplitConfig>) => {
    if (!action.splitConfig) return;
    const newSplits = [...action.splitConfig];
    newSplits[index] = { ...newSplits[index], ...updates };
    onUpdate({ splitConfig: newSplits });
  };

  const addSplit = () => {
    onUpdate({
      splitConfig: [
        ...(action.splitConfig || []),
        { categoryId: "", percentage: 0 },
      ],
    });
  };

  const removeSplit = (index: number) => {
    if (!action.splitConfig) return;
    const newSplits = action.splitConfig.filter((_, i) => i !== index);
    onUpdate({ splitConfig: newSplits });
  };

  return (
    <div
      className={cn(
        "border rounded-lg p-3 space-y-3 transition-opacity",
        !action.enabled && "opacity-50",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{actionType?.icon}</span>
          <span className="font-medium text-sm">{actionType?.label ?? removedActionLabel(action.type)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={action.enabled}
            onCheckedChange={(enabled) => onUpdate({ enabled })}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onRemove}
            aria-label="Remove action"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {action.enabled && (
        <div className="flex gap-2 flex-col">
          {action.type === "split_transaction" ? (
            <div className="space-y-3 pt-2">
              <div className="space-y-2">
                {action.splitConfig?.map((split, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <Select
                      value={split.categoryId}
                      onValueChange={(v) => updateSplit(i, { categoryId: v })}
                    >
                      <SelectTrigger className="flex-1 h-8 text-xs">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="relative w-24">
                      <Input
                        type="number"
                        placeholder="%"
                        className="h-8 text-xs pr-6"
                        value={split.percentage}
                        onChange={(e) =>
                          updateSplit(i, {
                            percentage: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                      <span className="absolute right-2 top-2 text-xs text-muted-foreground">
                        %
                      </span>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => removeSplit(i)}
                      disabled={action.splitConfig!.length <= 2}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center text-xs text-muted-foreground">
                <span>
                  Total:{" "}
                  {action.splitConfig?.reduce(
                    (sum, s) => sum + (s.percentage || 0),
                    0,
                  )}
                  %
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={addSplit}
                >
                  <Plus className="w-3 h-3 mr-1" /> Add split
                </Button>
              </div>
            </div>
          ) : action.type === "rename_merchant" ? (
            <Input
              placeholder="New merchant name..."
              className="h-8 text-xs"
              value={action.value as string}
              onChange={(e) => onUpdate({ value: e.target.value })}
            />
          ) : action.type === "categorize" ? (
            <Select
              value={action.value as string}
              onValueChange={(value) => onUpdate({ value })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : action.type === "link_goal" ? (
            <Select
              value={action.value as string}
              onValueChange={(value) => onUpdate({ value })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select goal" />
              </SelectTrigger>
              <SelectContent>
                {goals.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : action.type === "set_owner" ? (
            <Select
              value={action.value as string}
              onValueChange={(value) => onUpdate({ value })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select member" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shared">Shared (No Owner)</SelectItem>
                {members.length > 0 && <SelectSeparator />}
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : action.type === "add_tags" ? (
            <TagsMultiSelect
              value={toTagIds(action.value)}
              onChange={(tagIds) => onUpdate({ value: tagIds })}
              placeholder="Select tags..."
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
