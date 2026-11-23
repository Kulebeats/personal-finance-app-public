import { Suspense, useState } from "react";
import { ErrorBoundary } from "@/features/settings/components/ErrorBoundary";
import { LoadingSection } from "@/features/settings/components/LoadingSection";
import { SettingsCard } from "@/features/settings/components/SettingsCard";
import {
  useRules,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
  useTestRule,
  useCategories,
  useMerchants,
  useReorderRules,
  useHouseholdMembers,
} from "@/hooks/use-settings";
import { useAccounts } from "@/hooks/useAccounts";
import { useGoals } from "@/hooks/useGoals";
import type { Rule } from "@/hooks/use-settings";
import type { RuleEditorSaveData } from "./types";
import { RuleEditorModal } from "./RuleEditorModal";
import { ACTION_TYPES, CONDITION_TYPES } from "./constants";
import { RulesHeaderActions } from "./components/RulesHeaderActions";
import { RulesSearchBar } from "./components/RulesSearchBar";
import { QuickRuleBuilder } from "./components/QuickRuleBuilder";
import { RulesList } from "./components/RulesList";

export default function RulesSection() {
  const { data: rulesList, isLoading } = useRules();
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const testRule = useTestRule();
  const { data: categoriesData } = useCategories();
  const { data: merchants } = useMerchants();
  const { data: accounts } = useAccounts();
  const { data: householdMembers } = useHouseholdMembers();
  const { data: goals } = useGoals({
    includeArchived: false,
    includeCompleted: true,
  });
  const reorderRulesMutation = useReorderRules();

  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalRule, setModalRule] = useState<Rule | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const openCreateModal = () => {
    setModalRule(null);
    setIsModalOpen(true);
  };

  const openEditModal = (rule: Rule) => {
    setModalRule(rule);
    setIsModalOpen(true);
  };

  const handleModalSave = async (ruleData: RuleEditorSaveData) => {
    if (modalRule) {
      await updateRule.mutateAsync({ id: modalRule.id, data: ruleData });
    } else {
      await createRule.mutateAsync(ruleData);
    }
  };

  // The list renders `filteredRules`, so "up"/"down" means the visible neighbour. Both rules are
  // looked up by id in the full list: an index into the rendered list is not an index into it.
  const handleMoveRule = async (ruleId: string, direction: "up" | "down") => {
    if (!rulesList) return;

    const visible = filteredRules ?? [];
    const visibleIndex = visible.findIndex((r) => r.id === ruleId);
    const neighbour = visible[direction === "up" ? visibleIndex - 1 : visibleIndex + 1];
    if (visibleIndex < 0 || !neighbour) return;

    const from = rulesList.findIndex((r) => r.id === ruleId);
    const to = rulesList.findIndex((r) => r.id === neighbour.id);
    if (from < 0 || to < 0) return;

    const newRules = [...rulesList];
    [newRules[from], newRules[to]] = [newRules[to], newRules[from]];

    await reorderRulesMutation.mutateAsync(newRules.map((r) => r.id));
  };

  const isQueryEmpty = !searchQuery || searchQuery.trim() === "";
  const filteredRules = rulesList?.filter((rule) => {
    if (isQueryEmpty) return true;
    const query = searchQuery.toLowerCase();

    if (rule.name?.toLowerCase().includes(query)) return true;

    const hasMatchingCondition = rule.conditions.some((c) => {
      if (typeof c.value === "string" && c.value.toLowerCase().includes(query))
        return true;
      if (
        typeof c.value2 === "string" &&
        c.value2.toLowerCase().includes(query)
      )
        return true;
      const typeLabel = CONDITION_TYPES.find((t) => t.value === c.type)?.label;
      if (typeLabel?.toLowerCase().includes(query)) return true;
      return false;
    });
    if (hasMatchingCondition) return true;

    const hasMatchingAction = rule.actions.some((a) => {
      const typeLabel = ACTION_TYPES.find((t) => t.value === a.type)?.label;
      if (typeLabel?.toLowerCase().includes(query)) return true;

      if (a.type === "categorize" && typeof a.value === "string") {
        const categoryName = categoriesData?.categories?.find(
          (c) => c.id === a.value,
        )?.name;
        if (categoryName?.toLowerCase().includes(query)) return true;
      }

      if (a.type === "set_merchant" && typeof a.value === "string") {
        const merchantName = merchants?.find((m) => m.id === a.value)?.name;
        if (merchantName?.toLowerCase().includes(query)) return true;
      }

      if (a.type === "link_goal" && typeof a.value === "string") {
        const goalName = goals?.find((goal) => goal.id === a.value)?.name;
        if (goalName?.toLowerCase().includes(query)) return true;
      }

      if (typeof a.value === "string" && a.value.toLowerCase().includes(query))
        return true;
      return false;
    });

    return hasMatchingAction;
  });

  const linkableGoals = (goals ?? []).filter((goal) => goal.type === "save_up");
  const goalNamesById = new Map(
    linkableGoals.map((goal) => [goal.id, goal.name]),
  );
  const members =
    householdMembers?.map((member) => ({
      id: member.userId,
      name: member.name,
    })) || [];

  const categories =
    categoriesData?.categories?.map((category) => ({
      id: category.id,
      name: category.name,
    })) || [];
  const merchantOptions =
    merchants?.map((merchant) => ({
      id: merchant.id,
      name: merchant.name,
    })) || [];
  const categoryNamesById = new Map(
    categories.map((category) => [category.id, category.name]),
  );
  const accountOptions =
    accounts?.map((account) => ({ id: account.id, name: account.name })) || [];
  const goalOptions = linkableGoals.map((goal) => ({
    id: goal.id,
    name: goal.name,
  }));

  return (
    <>
      {/* Screen reader announcements */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </div>

      <ErrorBoundary sectionName="Rules">
        <Suspense fallback={<LoadingSection variant="list" />}>
          <SettingsCard
            title="Transaction Rules"
            description="Automate your transaction categorization and management"
            isLoading={isLoading}
            action={
              <RulesHeaderActions
                isCreating={isCreating}
                onOpenEditor={openCreateModal}
                onStartQuick={() => setIsCreating(true)}
              />
            }
          >
            <RulesSearchBar value={searchQuery} onChange={setSearchQuery} />

            {isCreating && (
              <QuickRuleBuilder
                createRule={createRule}
                categories={categories}
                merchants={merchantOptions}
                accounts={accountOptions}
                goals={goalOptions}
                onClose={() => setIsCreating(false)}
              />
            )}

            <RulesList
              rules={filteredRules}
              isCreating={isCreating}
              goalNamesById={goalNamesById}
              categoryNamesById={categoryNamesById}
              onToggle={(ruleId, enabled) => {
                const rule = rulesList?.find((r) => r.id === ruleId);
                updateRule.mutate(
                  { id: ruleId, data: { enabled } },
                  {
                    onSuccess: () => {
                      setAnnouncement(
                        `Rule "${rule?.name || "Rule"}" ${enabled ? "enabled" : "disabled"}`
                      );
                    },
                  }
                );
              }}
              onEdit={openEditModal}
              onDelete={(ruleId) => {
                const rule = rulesList?.find((r) => r.id === ruleId);
                deleteRule.mutate(ruleId, {
                  onSuccess: () => {
                    setAnnouncement(`Rule "${rule?.name || "Rule"}" deleted`);
                  },
                });
              }}
              onTest={(ruleId) => {
                const rule = rulesList?.find((r) => r.id === ruleId);
                if (rule) testRule.mutate(rule);
              }}
              onMove={handleMoveRule}
              onStartQuick={() => setIsCreating(true)}
              isDeleting={deleteRule.isPending}
              isTesting={testRule.isPending}
            />
          </SettingsCard>
        </Suspense>
      </ErrorBoundary>

      <RuleEditorModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        rule={modalRule}
        onSave={handleModalSave}
        categories={categories}
        merchants={merchantOptions}
        accounts={accountOptions}
        goals={goalOptions}
        members={members}
        isLoading={createRule.isPending || updateRule.isPending}
      />
    </>
  );
}
