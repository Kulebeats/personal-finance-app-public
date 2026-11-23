import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Wand2, X } from "lucide-react";
import { QuickRuleConditionBuilder } from "./QuickRuleConditionBuilder";
import { QuickRuleActionBuilder } from "./QuickRuleActionBuilder";
import type {
  CreateRuleData,
  RuleAction,
  RuleCondition,
} from "@/hooks/use-settings";

type EntityOption = { id: string; name: string };

type CreateRuleMutation = {
  isPending: boolean;
  mutate: (data: CreateRuleData, options?: { onSuccess?: () => void }) => void;
};

type QuickRuleBuilderProps = {
  createRule: CreateRuleMutation;
  categories: EntityOption[];
  merchants: EntityOption[];
  accounts: EntityOption[];
  goals: EntityOption[];
  onClose: () => void;
};

type NewRuleDraft = {
  name: string;
  conditions: Array<{
    type: string;
    operator: string;
    value: string;
    value2?: string;
  }>;
  actions: Array<{
    type: string;
    // add_tags carries a list of tag ids; every other action a single string.
    value: string | string[];
  }>;
  enabled: boolean;
  applyToPast: boolean;
};

const buildInitialRule = (): NewRuleDraft => ({
  name: "",
  conditions: [
    {
      type: "merchant_name",
      operator: "contains",
      value: "",
      value2: "",
    },
  ],
  actions: [{ type: "categorize", value: "" }],
  enabled: true,
  applyToPast: false,
});

const isActionValueEmpty = (value: string | string[]): boolean =>
  Array.isArray(value) ? value.length === 0 : !value;

/**
 * Convert the loose quick-builder draft into a typed CreateRuleData payload.
 *
 * The quick builder intentionally has no condition-logic control, so it always
 * defaults to "all" (a single condition makes the choice moot). The draft's
 * string-typed condition/action `type`/`operator` values come from constrained
 * Select options, so they are narrowed to the canonical union types here — the
 * same narrowing constants.ts already performs for default conditions/actions.
 */
export function buildCreateRulePayload(draft: NewRuleDraft): CreateRuleData {
  return {
    name: draft.name,
    conditionLogic: "all",
    conditions: draft.conditions.map((condition) => ({
      type: condition.type as RuleCondition["type"],
      operator: condition.operator as RuleCondition["operator"],
      value: condition.value,
      ...(condition.value2 ? { value2: condition.value2 } : {}),
    })),
    actions: draft.actions.map((action) => ({
      type: action.type as RuleAction["type"],
      value: action.value,
    })),
    enabled: draft.enabled,
    applyToPast: draft.applyToPast,
  };
}

export function QuickRuleBuilder({
  createRule,
  categories,
  merchants,
  accounts,
  goals,
  onClose,
}: QuickRuleBuilderProps) {
  const [newRule, setNewRule] = useState<NewRuleDraft>(buildInitialRule());

  const conditionType = newRule.conditions[0].type;
  const operatorType = newRule.conditions[0].operator;

  const handleCreateRule = () => {
    const actionType = newRule.actions[0].type;
    const valueRequired =
      actionType !== "hide" &&
      actionType !== "mark_reviewed" &&
      actionType !== "set_category_from_merchant";
    const rangeRequired = conditionType === "amount" && operatorType === "range";

    if (
      !newRule.name ||
      !newRule.conditions[0].value ||
      (rangeRequired && !newRule.conditions[0].value2) ||
      (valueRequired && isActionValueEmpty(newRule.actions[0].value))
    ) {
      return;
    }

    createRule.mutate(buildCreateRulePayload(newRule), {
      onSuccess: () => {
        onClose();
        setNewRule(buildInitialRule());
      },
    });
  };

  return (
    <div className="mb-6 p-4 border rounded-lg bg-accent/20 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-rose-500" />
          Create New Rule
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close rule builder">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-3">
        <div>
          <Label htmlFor="rule-name" className="text-xs text-muted-foreground uppercase">
            Rule Name
          </Label>
          <Input
            id="rule-name"
            placeholder="e.g., Shoprite -> Food & Groceries"
            value={newRule.name}
            onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
          />
        </div>

        <QuickRuleConditionBuilder
          condition={newRule.conditions[0]}
          categories={categories}
          accounts={accounts}
          onChange={(condition) =>
            setNewRule({ ...newRule, conditions: [condition] })
          }
        />

        <QuickRuleActionBuilder
          action={newRule.actions[0]}
          categories={categories}
          merchants={merchants}
          goals={goals}
          onChange={(action) =>
            setNewRule({ ...newRule, actions: [action] })
          }
        />

        <div className="flex items-center gap-4 pt-2">
          <div className="flex items-center gap-2">
            <Switch
              id="apply-to-past"
              checked={newRule.applyToPast}
              onCheckedChange={(v) => setNewRule({ ...newRule, applyToPast: v })}
              aria-label="Apply to past transactions"
            />
            <Label htmlFor="apply-to-past" className="text-sm cursor-pointer">
              Apply to past transactions
            </Label>
          </div>
        </div>

        <Button
          onClick={handleCreateRule}
          disabled={createRule.isPending || !newRule.name}
          className="w-full bg-rose-400 hover:bg-rose-500"
        >
          {createRule.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            "Create Rule"
          )}
        </Button>
      </div>
    </div>
  );
}
