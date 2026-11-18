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
import {
  CONDITION_TYPES,
  MERCHANT_CATEGORIES,
  OPERATORS,
} from "../constants";

type EntityOption = { id: string; name: string };

type RuleCondition = {
  type: string;
  operator: string;
  value: string;
  value2?: string;
};

type QuickRuleConditionBuilderProps = {
  condition: RuleCondition;
  categories: EntityOption[];
  accounts: EntityOption[];
  onChange: (condition: RuleCondition) => void;
};

export function QuickRuleConditionBuilder({
  condition,
  categories,
  accounts,
  onChange,
}: QuickRuleConditionBuilderProps) {
  const conditionType = condition.type;
  const operatorType = condition.operator;

  return (
    <div>
      <Label className="text-xs text-muted-foreground uppercase">When</Label>
      <div className="flex gap-2 flex-wrap">
        <Select
          value={condition.type}
          onValueChange={(value) =>
            onChange({
              ...condition,
              type: value,
              value: "",
              value2: "",
            })
          }
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONDITION_TYPES.map((ct) => (
              <SelectItem key={ct.value} value={ct.value}>
                {ct.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={condition.operator}
          onValueChange={(value) =>
            onChange({
              ...condition,
              operator: value,
              value2: value === "range" ? condition.value2 : "",
            })
          }
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(OPERATORS[conditionType as keyof typeof OPERATORS] || []).map(
              (op) => (
                <SelectItem key={op.value} value={op.value}>
                  {op.label}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>

        {conditionType === "merchant_category" ? (
          <>
            <Select
              value={condition.value}
              onValueChange={(value) =>
                onChange({
                  ...condition,
                  value,
                  value2: value === "Other" ? condition.value2 : "",
                })
              }
            >
              <SelectTrigger className="flex-1 min-w-[180px]">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {MERCHANT_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {condition.value === "Other" && (
              <Input
                className="flex-1 min-w-[150px]"
                placeholder="Please specify..."
                value={condition.value2 || ""}
                onChange={(event) =>
                  onChange({ ...condition, value2: event.target.value })
                }
              />
            )}
          </>
        ) : conditionType === "category" ? (
          <Select
            value={condition.value}
            onValueChange={(value) =>
              onChange({ ...condition, value })
            }
          >
            <SelectTrigger className="flex-1 min-w-[180px]">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : conditionType === "transaction_type" ? (
          <Select
            value={condition.value}
            onValueChange={(value) =>
              onChange({ ...condition, value })
            }
          >
            <SelectTrigger className="flex-1 min-w-[180px]">
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="expense">Expense</SelectItem>
              <SelectItem value="transfer">Transfer</SelectItem>
            </SelectContent>
          </Select>
        ) : conditionType === "account" ? (
          <Select
            value={condition.value}
            onValueChange={(value) =>
              onChange({ ...condition, value })
            }
          >
            <SelectTrigger className="flex-1 min-w-[180px]">
              <SelectValue placeholder="Select account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : conditionType === "amount" && operatorType === "range" ? (
          <div className="flex flex-1 min-w-[180px] gap-2">
            <Input
              className="flex-1"
              placeholder="Min"
              value={condition.value}
              onChange={(event) =>
                onChange({ ...condition, value: event.target.value })
              }
            />
            <Input
              className="flex-1"
              placeholder="Max"
              value={condition.value2 || ""}
              onChange={(event) =>
                onChange({ ...condition, value2: event.target.value })
              }
            />
          </div>
        ) : (
          <Input
            className="flex-1 min-w-[150px]"
            placeholder="Value..."
            value={condition.value}
            onChange={(event) =>
              onChange({ ...condition, value: event.target.value })
            }
          />
        )}
      </div>
    </div>
  );
}
