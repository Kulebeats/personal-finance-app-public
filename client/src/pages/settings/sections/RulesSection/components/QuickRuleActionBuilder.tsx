import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OwnerSelector } from "@/components/OwnerSelector";
import { TagsMultiSelect } from "@/components/tags";
import { ACTION_TYPES, toTagIds } from "../constants";

type EntityOption = { id: string; name: string };

type RuleAction = {
  type: string;
  // add_tags carries a list of tag ids; every other action a single string.
  value: string | string[];
};

type QuickRuleActionBuilderProps = {
  action: RuleAction;
  categories: EntityOption[];
  merchants: EntityOption[];
  goals: EntityOption[];
  onChange: (action: RuleAction) => void;
};

// Switching to or from add_tags changes the value's shape (id list vs string),
// so a stale value from the previous type must not leak across: a category id
// is not a tag id, so add_tags always starts empty.
function defaultValueFor(newType: string, previous: RuleAction): string | string[] {
  if (newType === "add_tags") return [];
  return Array.isArray(previous.value) ? "" : previous.value;
}

export function QuickRuleActionBuilder({
  action,
  categories,
  merchants,
  goals,
  onChange,
}: QuickRuleActionBuilderProps) {
  const currentActionType = action.type;
  const stringValue = typeof action.value === "string" ? action.value : "";

  return (
    <div>
      <Label className="text-xs text-muted-foreground uppercase">Then</Label>
      <div className="flex gap-2">
        <Select
          value={action.type}
          onValueChange={(type) =>
            onChange({ type, value: defaultValueFor(type, action) })
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_TYPES.map((at) => (
              <SelectItem key={at.value} value={at.value}>
                {at.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {currentActionType === "categorize" ? (
          <Select
            value={stringValue}
            onValueChange={(value) =>
              onChange({ ...action, value })
            }
          >
            <SelectTrigger className="flex-1">
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
        ) : currentActionType === "set_merchant" ? (
          <Select
            value={stringValue}
            onValueChange={(value) =>
              onChange({ ...action, value })
            }
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select merchant" />
            </SelectTrigger>
            <SelectContent>
              {merchants.map((merchant) => (
                <SelectItem key={merchant.id} value={merchant.id}>
                  {merchant.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : currentActionType === "set_owner" ? (
          <div className="flex-1">
            <OwnerSelector
              value={stringValue === "shared" ? null : stringValue}
              onChange={(value) =>
                onChange({
                  ...action,
                  value: value === null ? "shared" : value,
                })
              }
            />
          </div>
        ) : currentActionType === "link_goal" ? (
          <Select
            value={stringValue}
            onValueChange={(value) =>
              onChange({ ...action, value })
            }
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select goal" />
            </SelectTrigger>
            <SelectContent>
              {goals.map((goal) => (
                <SelectItem key={goal.id} value={goal.id}>
                  {goal.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : currentActionType === "add_tags" ? (
          <div className="flex-1">
            <TagsMultiSelect
              value={toTagIds(action.value)}
              onChange={(tagIds) => onChange({ ...action, value: tagIds })}
              placeholder="Select tags..."
            />
          </div>
        ) : currentActionType === "set_category_from_merchant" ? (
          <p className="flex-1 text-sm text-muted-foreground py-2">
            Uses the selected merchant's default category.
          </p>
        ) : currentActionType === "hide" ? (
          <p className="flex-1 text-sm text-muted-foreground py-2">
            Will hide transactions from reports and budgets
          </p>
        ) : currentActionType === "mark_reviewed" ? (
          <p className="flex-1 text-sm text-muted-foreground py-2">
            Will mark matching transactions as reviewed
          </p>
        ) : (
          <Input
            className="flex-1"
            placeholder={
              currentActionType === "add_merchant_alias"
                ? "Alias name..."
                : "Value..."
            }
            value={stringValue}
            onChange={(event) =>
              onChange({ ...action, value: event.target.value })
            }
          />
        )}
      </div>
    </div>
  );
}
