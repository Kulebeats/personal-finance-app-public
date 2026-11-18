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
import { ACTION_TYPES } from "../constants";

type EntityOption = { id: string; name: string };

type RuleAction = {
  type: string;
  value: string;
};

type QuickRuleActionBuilderProps = {
  action: RuleAction;
  categories: EntityOption[];
  merchants: EntityOption[];
  goals: EntityOption[];
  onChange: (action: RuleAction) => void;
};

export function QuickRuleActionBuilder({
  action,
  categories,
  merchants,
  goals,
  onChange,
}: QuickRuleActionBuilderProps) {
  const currentActionType = action.type;

  return (
    <div>
      <Label className="text-xs text-muted-foreground uppercase">Then</Label>
      <div className="flex gap-2">
        <Select
          value={action.type}
          onValueChange={(value) =>
            onChange({ ...action, type: value })
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
            value={action.value}
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
            value={action.value}
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
              value={action.value === "shared" ? null : action.value}
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
            value={action.value}
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
            value={action.value}
            onChange={(event) =>
              onChange({ ...action, value: event.target.value })
            }
          />
        )}
      </div>
    </div>
  );
}
