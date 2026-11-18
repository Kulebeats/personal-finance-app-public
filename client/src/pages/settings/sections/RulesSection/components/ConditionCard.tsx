import React from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/select";
import { RuleCondition } from "@/hooks/use-settings";
import { CONDITION_TYPES, OPERATORS } from "../constants";
import { ALL_OPERATORS } from "@/features/settings/constants/ruleConditions";

interface ConditionCardProps {
  condition: RuleCondition;
  onUpdate: (updates: Partial<RuleCondition>) => void;
  onRemove: () => void;
  categories: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
}

// Type guard for operator validation
const isValidOperator = (value: string): value is RuleCondition["operator"] => {
  return ALL_OPERATORS.includes(value as RuleCondition["operator"]);
};

export function ConditionCard({
  condition,
  onUpdate,
  onRemove,
  categories,
  accounts,
}: ConditionCardProps) {
  const conditionType = CONDITION_TYPES.find((c) => c.value === condition.type);
  const operators = OPERATORS[condition.type as keyof typeof OPERATORS] || [];

  return (
    <div
      className={cn(
        "border rounded-lg p-3 space-y-3 transition-opacity",
        !condition.enabled && "opacity-50",
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span aria-hidden="true">{conditionType?.icon}</span>
          <h4 className="font-medium text-sm">{conditionType?.label} Condition</h4>
          {!condition.enabled && (
            <Badge variant="secondary" className="text-xs">
              Disabled
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={condition.enabled}
            onCheckedChange={(enabled) => onUpdate({ enabled })}
            aria-label={`Enable ${conditionType?.label} condition`}
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onRemove}
            aria-label={`Remove ${conditionType?.label} condition`}
          >
            <Trash2 className="w-3 h-3" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {condition.enabled && (
        <div className="flex gap-2 flex-wrap">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`operator-${condition.type}`} className="sr-only">
              Operator for {conditionType?.label}
            </Label>
            <Select
              value={condition.operator}
              onValueChange={(value) => {
                // Type-safe: SelectItem values come from operators array which are valid
                if (isValidOperator(value)) {
                  onUpdate({ operator: value });
                }
              }}
            >
              <SelectTrigger id={`operator-${condition.type}`} className="w-36 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {operators.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {condition.type === "category" ? (
            <div className="flex flex-col gap-1 flex-1">
              <Label htmlFor={`value-category`} className="sr-only">
                Select category value
              </Label>
              <Select
                value={String(condition.value || "")}
                onValueChange={(value) => onUpdate({ value })}
              >
                <SelectTrigger id="value-category" className="flex-1 h-8 text-xs">
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
            </div>
          ) : condition.type === "account" ? (
            <div className="flex flex-col gap-1 flex-1">
              <Label htmlFor={`value-account`} className="sr-only">
                Select account value
              </Label>
              <Select
                value={String(condition.value || "")}
                onValueChange={(value) => onUpdate({ value })}
              >
                <SelectTrigger id="value-account" className="flex-1 h-8 text-xs">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : condition.type === "transaction_type" ? (
            <div className="flex flex-col gap-1 flex-1">
              <Label htmlFor={`value-txn-type`} className="sr-only">
                Select transaction type
              </Label>
              <Select
                value={String(condition.value || "")}
                onValueChange={(value) => onUpdate({ value })}
              >
                <SelectTrigger id="value-txn-type" className="flex-1 h-8 text-xs">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : condition.type === "amount" ? (
            <div className="flex gap-2 flex-1 items-center">
              <Label htmlFor={`value-amount-min`} className="sr-only">
                Amount value
              </Label>
              <Input
                id="value-amount-min"
                type="number"
                placeholder="Amount"
                className="h-8 text-xs"
                value={condition.value}
                onChange={(e) => onUpdate({ value: e.target.value })}
                aria-label="Minimum amount"
              />
              {condition.operator === "range" && (
                <>
                  <span className="self-center text-xs text-muted-foreground" aria-hidden="true">
                    to
                  </span>
                  <Label htmlFor={`value-amount-max`} className="sr-only">
                    Maximum amount
                  </Label>
                  <Input
                    id="value-amount-max"
                    type="number"
                    placeholder="Max"
                    className="h-8 text-xs"
                    value={condition.value2 || ""}
                    onChange={(e) => onUpdate({ value2: e.target.value })}
                    aria-label="Maximum amount"
                  />
                </>
              )}
            </div>
          ) : (
            <>
              <Label htmlFor={`value-${condition.type}`} className="sr-only">
                Value for {conditionType?.label}
              </Label>
              <Input
                id={`value-${condition.type}`}
                placeholder="Enter value..."
                className="flex-1 h-8 text-xs"
                value={condition.value}
                onChange={(e) => onUpdate({ value: e.target.value })}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
