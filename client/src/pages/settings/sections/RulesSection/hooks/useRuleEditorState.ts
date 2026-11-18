import { useState, useEffect } from "react";
import { usePreviewRule } from "@/hooks/use-settings";
import {
  Rule,
  RuleCondition,
  RuleAction,
  RuleEditorSaveData,
} from "../types";
import { getDefaultCondition, getDefaultAction } from "../constants";

export interface UseRuleEditorStateProps {
  rule?: Rule | null;
  open: boolean;
  onSave: (ruleData: RuleEditorSaveData) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

/**
 * Custom hook for managing RuleEditorModal form state and actions.
 */
export function useRuleEditorState({
  rule,
  open,
  onSave,
  onOpenChange,
}: UseRuleEditorStateProps) {
  const [activeTab, setActiveTab] = useState("settings");
  const [name, setName] = useState("");
  const [conditionLogic, setConditionLogic] = useState<"all" | "any">("all");
  const [conditions, setConditions] = useState<RuleCondition[]>([]);
  const [actions, setActions] = useState<RuleAction[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [priority, setPriority] = useState(0);
  const [applyToPast, setApplyToPast] = useState(false);
  const [previewCount, setPreviewCount] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize form when rule changes
  useEffect(() => {
    if (rule) {
      setName(rule.name);
      setConditionLogic(rule.conditionLogic);
      setConditions(rule.conditions);
      setActions(rule.actions);
      setEnabled(rule.enabled);
      setPriority(rule.priority || 0);
      setApplyToPast(rule.applyToPast);
    } else {
      setName("");
      setConditionLogic("all");
      setConditions([getDefaultCondition("merchant_name")]);
      setActions([getDefaultAction("categorize")]);
      setEnabled(true);
      setPriority(0);
      setApplyToPast(false);
    }
    setPreviewCount(0);
  }, [rule, open]);

  const previewMutation = usePreviewRule();

  // Fetch preview when conditions change
  useEffect(() => {
    if (activeTab === "preview") {
      const enabledConditions = conditions.filter((c) => c.enabled);
      if (enabledConditions.length > 0) {
        previewMutation.mutate({
          conditions: enabledConditions,
          conditionLogic,
        });
      }
    }
  }, [activeTab, conditions, conditionLogic]);

  // Update badge count
  useEffect(() => {
    if (previewMutation.data?.matchCount !== undefined) {
      setPreviewCount(previewMutation.data.matchCount);
    }
  }, [previewMutation.data]);

  const updateCondition = (index: number, updates: Partial<RuleCondition>) => {
    setConditions((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...updates } : c)),
    );
  };

  const addCondition = (type: string) => {
    setConditions((prev) => [...prev, getDefaultCondition(type)]);
  };

  const removeCondition = (index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  };

  const updateAction = (index: number, updates: Partial<RuleAction>) => {
    setActions((prev) =>
      prev.map((a, i) => (i === index ? { ...a, ...updates } : a)),
    );
  };

  const addAction = (type: string) => {
    setActions((prev) => [...prev, getDefaultAction(type)]);
  };

  const removeAction = (index: number) => {
    setActions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      await onSave({
        name,
        conditions,
        conditionLogic,
        actions,
        enabled,
        priority,
        applyToPast,
      });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const enabledConditions = conditions.filter((c) => c.enabled);
  const enabledActions = actions.filter((a) => a.enabled);

  return {
    // Tab state
    activeTab,
    setActiveTab,

    // Form state
    name,
    setName,
    conditionLogic,
    setConditionLogic,
    conditions,
    actions,
    enabled,
    setEnabled,
    priority,
    setPriority,
    applyToPast,
    setApplyToPast,
    previewCount,
    isSaving,
    hasUnsavedChanges:
      name !== (rule?.name || "") ||
      conditions !== (rule?.conditions || []) ||
      actions !== (rule?.actions || []) ||
      enabled !== (rule?.enabled ?? true) ||
      priority !== (rule?.priority || 0) ||
      applyToPast !== (rule?.applyToPast || false),

    // Computed
    enabledConditions,
    enabledActions,

    // Preview mutation
    previewMutation,

    // Actions
    updateCondition,
    addCondition,
    removeCondition,
    updateAction,
    addAction,
    removeAction,
    handleSave,
  };
}
