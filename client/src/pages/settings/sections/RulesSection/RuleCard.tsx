import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Play,
  Edit2,
  Trash2,
  ChevronRight,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

import type { Rule, RuleCondition, RuleAction } from "@/hooks/use-settings";

interface RuleCardProps {
  rule: Rule;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  isDeleting?: boolean;
  isTesting?: boolean;
  goalNamesById?: Map<string, string>;
}

const CONDITION_LABELS: Record<string, string> = {
  original_statement: "Statement",
  merchant_name: "Merchant",
  amount: "Amount",
  category: "Category",
  account: "Account",
  transaction_type: "Type",
  description: "Description",
};

const OPERATOR_LABELS: Record<string, string> = {
  contains: "contains",
  equals: "=",
  starts_with: "starts with",
  ends_with: "ends with",
  not_contains: "doesn't contain",
  greater_than: ">",
  less_than: "<",
  range: "between",
  regex: "matches",
};

const ACTION_LABELS: Record<string, string> = {
  rename_merchant: "Rename",
  categorize: "Categorize",
  add_tags: "Add tags",
  set_merchant: "Set merchant",
  hide: "Hide",
  mark_reviewed: "Mark reviewed",
  set_owner: "Set owner",
  link_goal: "Link goal",
  set_category_from_merchant: "Auto-categorize",
};

function ConditionPill({ condition }: { condition: RuleCondition }) {
  if (condition.enabled === false) return null;

  const typeLabel = CONDITION_LABELS[condition.type] || condition.type;
  const operatorLabel =
    OPERATOR_LABELS[condition.operator] || condition.operator;

  // Truncate value if too long
  const stringValue = String(condition.value || "");
  const displayValue =
    stringValue.length > 15 ? stringValue.slice(0, 12) + "..." : stringValue;

  return (
    <Badge
      variant="outline"
      className="text-xs font-normal bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
    >
      {typeLabel} {operatorLabel} "{displayValue}"
    </Badge>
  );
}

function ActionPill({
  action,
  goalNamesById,
}: {
  action: RuleAction;
  goalNamesById?: Map<string, string>;
}) {
  if (action.enabled === false) return null;

  const typeLabel = ACTION_LABELS[action.type] || action.type;

  // Some actions don't need a value display
  const noValueTypes = ["hide", "mark_reviewed", "set_category_from_merchant"];
  let displayValue: string | null = null;
  if (!noValueTypes.includes(action.type)) {
    if (action.type === "link_goal" && typeof action.value === "string") {
      displayValue = goalNamesById?.get(action.value) ?? action.value;
    } else if (typeof action.value === "string") {
      displayValue =
        action.value.length > 15
          ? action.value.slice(0, 12) + "..."
          : action.value;
    } else if (Array.isArray(action.value)) {
      displayValue = `${action.value.length} items`;
    }
  }

  return (
    <Badge
      variant="outline"
      className="text-xs font-normal bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
    >
      {typeLabel}
      {displayValue ? `: ${displayValue}` : ""}
    </Badge>
  );
}

export function RuleCard({
  rule,
  onToggle,
  onEdit,
  onDelete,
  onTest,
  onMoveUp,
  onMoveDown,
  isFirst = false,
  isLast = false,
  goalNamesById,
  isDeleting = false,
  isTesting = false,
}: RuleCardProps) {
  const conditions = (rule.conditions as RuleCondition[]).filter(
    (c) => c.enabled !== false,
  );
  const actions = (rule.actions as RuleAction[]).filter(
    (a) => a.enabled !== false,
  );

  return (
    <div
      className={cn(
        "border rounded-lg p-4 transition-all hover:shadow-sm",
        !rule.enabled && "opacity-60",
      )}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={rule.enabled}
            onCheckedChange={onToggle}
            aria-label={`Toggle rule ${rule.name}`}
          />
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-sm">{rule.name}</h4>
              {!rule.enabled && (
                <Badge variant="secondary" className="text-xs">
                  Disabled
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {rule.matchCount || 0} transactions matched
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <div className="flex flex-col mr-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-20"
              onClick={onMoveUp}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" && onMoveUp && !isFirst) {
                  e.preventDefault();
                  onMoveUp();
                }
              }}
              disabled={isFirst}
              title="Move up (Arrow Up)"
              aria-label="Move rule up"
            >
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-20"
              onClick={onMoveDown}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && onMoveDown && !isLast) {
                  e.preventDefault();
                  onMoveDown();
                }
              }}
              disabled={isLast}
              title="Move down (Arrow Down)"
              aria-label="Move rule down"
            >
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onTest}
            disabled={isTesting}
            title="Test rule"
            aria-label="Test rule"
          >
            <Play className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onEdit}
            title="Edit rule"
            aria-label="Edit rule"
          >
            <Edit2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={isDeleting}
            title="Delete rule"
            aria-label="Delete rule"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Conditions and Actions Pills */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {/* Condition Logic Indicator */}
        {conditions.length > 1 && (
          <span className="text-muted-foreground font-medium uppercase text-[10px]">
            {rule.conditionLogic === "any" ? "ANY" : "ALL"}:
          </span>
        )}

        {/* Condition Pills */}
        {conditions.slice(0, 3).map((condition, index) => (
          <ConditionPill key={index} condition={condition} />
        ))}
        {conditions.length > 3 && (
          <Badge variant="secondary" className="text-xs">
            +{conditions.length - 3} more
          </Badge>
        )}

        {/* Arrow */}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />

        {/* Action Pills */}
        {actions.slice(0, 2).map((action, index) => (
          <ActionPill
            key={index}
            action={action}
            goalNamesById={goalNamesById}
          />
        ))}
        {actions.length > 2 && (
          <Badge variant="secondary" className="text-xs">
            +{actions.length - 2} more
          </Badge>
        )}
      </div>
    </div>
  );
}

export default RuleCard;
