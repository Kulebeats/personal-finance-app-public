import React from "react";
import { Button } from "@/components/ui/button";
import { Plus, Wand2 } from "lucide-react";
import type { Rule } from "@/hooks/use-settings";
import { RuleCard } from "../RuleCard";

type RulesListProps = {
  rules: Rule[] | undefined;
  isCreating: boolean;
  goalNamesById: Map<string, string>;
  onToggle: (ruleId: string, enabled: boolean) => void;
  onEdit: (rule: Rule) => void;
  onDelete: (ruleId: string) => void;
  onTest: (ruleId: string) => void;
  onMove: (index: number, direction: "up" | "down") => void;
  onStartQuick: () => void;
  isDeleting: boolean;
  isTesting: boolean;
};

export function RulesList({
  rules,
  isCreating,
  goalNamesById,
  onToggle,
  onEdit,
  onDelete,
  onTest,
  onMove,
  onStartQuick,
  isDeleting,
  isTesting,
}: RulesListProps) {
  if (!rules || rules.length === 0) {
    if (isCreating) return null;

    return (
      <div className="text-center py-8">
        <Wand2 className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground mb-2">No rules created yet</p>
        <p className="text-xs text-muted-foreground mb-4">
          Rules help you automatically categorize and organize transactions
        </p>
        <Button
          onClick={onStartQuick}
          className="bg-rose-400 hover:bg-rose-500"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Your First Rule
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rules.map((rule, index) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          goalNamesById={goalNamesById}
          onToggle={(enabled) => onToggle(rule.id, enabled)}
          onEdit={() => onEdit(rule)}
          onDelete={() => onDelete(rule.id)}
          onTest={() => onTest(rule.id)}
          onMoveUp={() => onMove(index, "up")}
          onMoveDown={() => onMove(index, "down")}
          isFirst={index === 0}
          isLast={index === rules.length - 1}
          isDeleting={isDeleting}
          isTesting={isTesting}
        />
      ))}
    </div>
  );
}
