import type {
  Rule,
  RuleCondition,
  RuleAction,
  SplitConfig,
} from "@/hooks/use-settings";

export type { Rule, RuleCondition, RuleAction, SplitConfig };

/**
 * Payload produced by the rule editor on save (see
 * useRuleEditorState.handleSave). It mirrors the editable rule fields and is
 * accepted by both useCreateRule (CreateRuleData) and useUpdateRule
 * (UpdateRuleData). Distinct from `Rule`, which also carries server-owned
 * fields like id / householdId / timestamps.
 */
export interface RuleEditorSaveData {
  name: string;
  conditions: RuleCondition[];
  conditionLogic: "all" | "any";
  actions: RuleAction[];
  enabled: boolean;
  priority: number;
  applyToPast: boolean;
}

export interface RuleEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: Rule | null;
  onSave: (rule: RuleEditorSaveData) => Promise<void>;
  categories: Array<{ id: string; name: string }>;
  merchants: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  goals: Array<{ id: string; name: string }>;
  members: Array<{ id: string; name: string }>;
  isLoading?: boolean;
}
