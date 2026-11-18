import React from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Plus } from "lucide-react";
import { CONDITION_TYPES, ACTION_TYPES } from "./constants";
import { ConditionCard } from "./components/ConditionCard";
import { ActionCard } from "./components/ActionCard";
import type { RuleCondition, RuleAction } from "./types";

interface RuleEditorSettingsTabProps {
  name: string;
  setName: (name: string) => void;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  priority: number;
  setPriority: (priority: number) => void;
  conditionLogic: "all" | "any";
  setConditionLogic: (logic: "all" | "any") => void;
  conditions: RuleCondition[];
  actions: RuleAction[];
  applyToPast: boolean;
  setApplyToPast: (apply: boolean) => void;
  updateCondition: (index: number, updates: Partial<RuleCondition>) => void;
  addCondition: (type: string) => void;
  removeCondition: (index: number) => void;
  updateAction: (index: number, updates: Partial<RuleAction>) => void;
  addAction: (type: string) => void;
  removeAction: (index: number) => void;
  categories: Array<{ id: string; name: string }>;
  merchants: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  goals: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
}

export function RuleEditorSettingsTab({
  name,
  setName,
  enabled,
  setEnabled,
  priority,
  setPriority,
  conditionLogic,
  setConditionLogic,
  conditions,
  actions,
  applyToPast,
  setApplyToPast,
  updateCondition,
  addCondition,
  removeCondition,
  updateAction,
  addAction,
  removeAction,
  categories,
  merchants,
  accounts,
  goals,
  members,
}: RuleEditorSettingsTabProps) {
  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Rule Name */}
        <div className="space-y-2">
          <Label htmlFor="ruleName">Rule Name</Label>
          <Input
            id="ruleName"
            placeholder="e.g., Shoprite -> Groceries"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex items-center gap-2 border p-2 rounded-md">
            <Switch
              id="ruleEnabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
            <Label htmlFor="ruleEnabled">Rule Enabled</Label>
          </div>

          <div className="flex items-center gap-2 border p-2 rounded-md flex-1">
            <Label htmlFor="rulePriority" className="whitespace-nowrap">
              Priority (Higher runs first):
            </Label>
            <Input
              id="rulePriority"
              type="number"
              value={priority}
              onChange={(e) =>
                setPriority(parseInt(e.target.value) || 0)
              }
              className="w-20"
            />
          </div>
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left Column: Conditions */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                If transaction matches...
              </h3>
              <Select
                value={conditionLogic}
                onValueChange={(v) =>
                  setConditionLogic(v as "all" | "any")
                }
              >
                <SelectTrigger className="w-24 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ALL</SelectItem>
                  <SelectItem value="any">ANY</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              {conditions.map((condition, index) => (
                <ConditionCard
                  key={index}
                  condition={condition}
                  onUpdate={(updates) =>
                    updateCondition(index, updates)
                  }
                  onRemove={() => removeCondition(index)}
                  categories={categories}
                  accounts={accounts}
                />
              ))}
            </div>

            {/* Add Condition */}
            <Select onValueChange={addCondition}>
              <SelectTrigger className="w-full border-dashed">
                <Plus className="w-4 h-4 mr-2" />
                <span className="text-muted-foreground">
                  Add condition
                </span>
              </SelectTrigger>
              <SelectContent>
                {CONDITION_TYPES.map((ct) => (
                  <SelectItem key={ct.value} value={ct.value}>
                    <span className="mr-2">{ct.icon}</span>
                    {ct.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Right Column: Actions */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
              Then apply these updates...
            </h3>

            <div className="space-y-3">
              {actions.map((action, index) => (
                <ActionCard
                  key={index}
                  action={action}
                  onUpdate={(updates) => updateAction(index, updates)}
                  onRemove={() => removeAction(index)}
                  categories={categories}
                  merchants={merchants}
                  goals={goals}
                  members={members}
                />
              ))}
            </div>

            {/* Add Action */}
            <Select onValueChange={addAction}>
              <SelectTrigger className="w-full border-dashed">
                <Plus className="w-4 h-4 mr-2" />
                <span className="text-muted-foreground">
                  Add action
                </span>
              </SelectTrigger>
              <SelectContent>
                {ACTION_TYPES.map((at) => (
                  <SelectItem key={at.value} value={at.value}>
                    <span className="mr-2">{at.icon}</span>
                    {at.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Apply to past */}
        <div className="flex items-center gap-3 pt-4 border-t">
          <Switch
            checked={applyToPast}
            onCheckedChange={setApplyToPast}
          />
          <Label className="text-sm">
            Apply this rule to existing transactions
          </Label>
        </div>
      </div>
    </ScrollArea>
  );
}
