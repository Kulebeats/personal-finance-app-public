/**
 * Budget Page
 *
 * Displays budget management with categories, groups, and forecasts.
 * Uses components from the budget feature module.
 */

import Layout from "@/components/Layout";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";

// Feature module imports
import {
  BudgetSection,
  BudgetDetailModal,
  BudgetSettingsModal,
  BudgetEditModal,
  ForecastEditModal,
  BudgetForecastTable,
  MoveMoneyModal,
  BudgetWalkthrough,
  BudgetSummaryCard,
  ContributionsSection,
  BudgetPageHeader,
  BudgetLoadingState,
  BudgetErrorState,
  BudgetEmptyState,
  useBudgetPageData,
  useBudgetModals,
} from "@/features/budget";

export default function Budget() {
  const isMobile = useIsMobile();
  const [, setLocation] = useLocation();

  const budgetData = useBudgetPageData();

  // Use modal management hook with save handlers
  const modals = useBudgetModals({
    selectedYear: budgetData.selectedYear,
    selectedMonth: budgetData.selectedMonth,
    moveMoneyOptions: budgetData.moveMoneyOptions,
    createBudget: budgetData.createBudget,
    updateBudget: budgetData.updateBudget,
    updateBudgetForecast: budgetData.updateBudgetForecast,
    moveBudgetAmount: budgetData.moveBudgetAmount,
  });

  const isBudgetEditSaving =
    budgetData.updateBudget.isPending ||
    budgetData.updateBudgetForecast.isPending ||
    budgetData.createBudget.isPending;

  // Loading state
  if (budgetData.isLoading) {
    return (
      <Layout>
        <BudgetLoadingState />
      </Layout>
    );
  }

  // Error state
  if (budgetData.error) {
    return (
      <Layout>
        <BudgetErrorState
          error={budgetData.error as Error}
          onRetry={() => window.location.reload()}
        />
      </Layout>
    );
  }

  // Empty state
  if (!budgetData.categoriesLoading && budgetData.categoryGroups.length === 0) {
    return (
      <Layout>
        <BudgetEmptyState
          onNavigateToCategories={() => setLocation("/settings/categories")}
        />
      </Layout>
    );
  }

  return (
    <Layout>
      <BudgetPageHeader
        headerLabel={budgetData.headerLabel}
        viewMode={budgetData.viewMode}
        setViewMode={budgetData.setViewMode}
        timeframe={budgetData.timeframe}
        setTimeframe={budgetData.setTimeframe}
        onShiftMonth={budgetData.shiftMonth}
        onResetToToday={budgetData.resetToToday}
        onOpenSettings={() => budgetData.setIsSettingsOpen(true)}
        isMobile={isMobile}
      />

      <div className="flex flex-col lg:flex-row items-start gap-4 lg:gap-8 h-full pb-20">
        <div className="flex-1 flex flex-col w-full">
          {budgetData.viewMode === "budget" ? (
            <>
              <div className="grid grid-cols-12 gap-4 py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border mb-2">
                <div className="col-span-5">Category</div>
                <div className="col-span-3 text-right pr-4">Budget</div>
                <div className="col-span-2 text-right pr-8">Actual</div>
                <div className="col-span-2 text-right">Remaining</div>
              </div>

              <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden pb-6">
                <BudgetSection
                  title="Income"
                  groups={budgetData.incomeGroups}
                  onToggleGroup={budgetData.toggleGroup}
                  onAddItemToGroup={budgetData.addItemToGroup}
                  onUpdateItem={budgetData.updateItem}
                  onSelectItem={budgetData.setSelectedItem}
                  onUpdateGroupBudget={budgetData.updateGroupBudget}
                  onCommitGroupBudget={budgetData.commitGroupBudget}
                  onCommitItemBudget={modals.handleCommitItemBudget}
                  showUnbudgeted={Boolean(
                    budgetData.showUnbudgetedBySection.Income
                  )}
                  onToggleShowUnbudgeted={() =>
                    budgetData.toggleUnbudgetedSection("Income")
                  }
                />
                <BudgetSection
                  title="Expenses"
                  groups={budgetData.expenseGroups}
                  onToggleGroup={budgetData.toggleGroup}
                  onAddItemToGroup={budgetData.addItemToGroup}
                  onUpdateItem={budgetData.updateItem}
                  onSelectItem={budgetData.setSelectedItem}
                  onMoveMoney={modals.handleMoveMoney}
                  onUpdateGroupBudget={budgetData.updateGroupBudget}
                  onCommitGroupBudget={budgetData.commitGroupBudget}
                  onCommitItemBudget={modals.handleCommitItemBudget}
                  showUnbudgeted={Boolean(
                    budgetData.showUnbudgetedBySection.Expenses
                  )}
                  onToggleShowUnbudgeted={() =>
                    budgetData.toggleUnbudgetedSection("Expenses")
                  }
                />
                {budgetData.savingsGroups.length > 0 && (
                  <BudgetSection
                    title="Savings"
                    groups={budgetData.savingsGroups}
                    onToggleGroup={budgetData.toggleGroup}
                    onAddItemToGroup={budgetData.addItemToGroup}
                    onUpdateItem={budgetData.updateItem}
                    onSelectItem={budgetData.setSelectedItem}
                    onUpdateGroupBudget={budgetData.updateGroupBudget}
                    onCommitGroupBudget={budgetData.commitGroupBudget}
                    onCommitItemBudget={modals.handleCommitItemBudget}
                    showUnbudgeted={Boolean(
                      budgetData.showUnbudgetedBySection.Savings
                    )}
                    onToggleShowUnbudgeted={() =>
                      budgetData.toggleUnbudgetedSection("Savings")
                    }
                  />
                )}
                {budgetData.debtGroups.length > 0 && (
                  <BudgetSection
                    title="Debts"
                    groups={budgetData.debtGroups}
                    onToggleGroup={budgetData.toggleGroup}
                    onAddItemToGroup={budgetData.addItemToGroup}
                    onUpdateItem={budgetData.updateItem}
                    onSelectItem={budgetData.setSelectedItem}
                    onUpdateGroupBudget={budgetData.updateGroupBudget}
                    onCommitGroupBudget={budgetData.commitGroupBudget}
                    onCommitItemBudget={modals.handleCommitItemBudget}
                    showUnbudgeted={Boolean(
                      budgetData.showUnbudgetedBySection.Debts
                    )}
                    onToggleShowUnbudgeted={() =>
                      budgetData.toggleUnbudgetedSection("Debts")
                    }
                  />
                )}
                <ContributionsSection goals={budgetData.contributionGoals} />
              </div>
            </>
          ) : (
            <>
              <BudgetForecastTable
                forecast={budgetData.forecastQuery.data}
                isLoading={budgetData.forecastQuery.isLoading}
                currentYear={budgetData.todayYear}
                currentMonth={budgetData.todayMonth}
                onEdit={modals.handleForecastEdit}
                showUnbudgeted={budgetData.showUnbudgetedForecast}
                onToggleShowUnbudgeted={() =>
                  budgetData.setShowUnbudgetedForecast((prev) => !prev)
                }
              />
              <ContributionsSection goals={budgetData.contributionGoals} />
            </>
          )}
        </div>

        <div className="w-full lg:w-80 shrink-0 lg:sticky lg:top-6 order-first lg:order-last">
          <BudgetSummaryCard
            totalIncomeBudget={budgetData.totalIncomeBudget}
            totalIncomeActual={budgetData.totalIncomeActual}
            totalExpenseBudget={budgetData.totalExpenseBudget}
            totalExpenseActual={budgetData.totalExpenseActual}
            incomeRemaining={budgetData.incomeRemaining}
            expenseRemaining={budgetData.expenseRemaining}
            incomeGroups={budgetData.incomeGroups}
            expenseGroups={budgetData.expenseGroups}
            summaryTab={budgetData.summaryTab}
            onTabChange={budgetData.setSummaryTab}
          />
        </div>
      </div>

      {/* Modals */}
      <BudgetDetailModal
        selected={budgetData.selectedItem}
        groups={budgetData.displayGroups}
        year={budgetData.selectedYear}
        month={budgetData.selectedMonth}
        onClose={() => budgetData.setSelectedItem(null)}
        onUpdate={budgetData.updateItem}
        onCommitBudget={modals.handleCommitItemBudget}
      />
      <BudgetSettingsModal
        isOpen={budgetData.isSettingsOpen}
        onClose={() => budgetData.setIsSettingsOpen(false)}
        budgetSystem={budgetData.budgetSystem}
        defaultApplyScope={budgetData.defaultApplyScope}
        onSaveSettings={(settings) => {
          budgetData.updateBudgetSettings.mutate(settings, {
            onSuccess: () => budgetData.setIsSettingsOpen(false),
          });
        }}
        onRecalculate={() =>
          budgetData.recalculateBudgets.mutate({ months: 3 })
        }
        onClear={() => budgetData.clearBudgets.mutate()}
        isSaving={budgetData.updateBudgetSettings.isPending}
        isRecalculating={budgetData.recalculateBudgets.isPending}
        isClearing={budgetData.clearBudgets.isPending}
        onStartWalkthrough={() => budgetData.setIsWalkthroughActive(true)}
      />
      <BudgetEditModal
        isOpen={Boolean(modals.budgetEdit)}
        onClose={modals.closeBudgetEdit}
        data={modals.budgetEdit}
        defaultApplyScope={budgetData.defaultApplyScope}
        isSaving={isBudgetEditSaving}
        onSave={modals.handleBudgetEditSave}
      />
      <ForecastEditModal
        isOpen={Boolean(modals.forecastEdit)}
        onClose={modals.closeForecastEdit}
        data={modals.forecastEdit}
        defaultApplyScope={budgetData.defaultApplyScope}
        isSaving={budgetData.updateBudgetForecast.isPending}
        onSave={modals.handleForecastEditSave}
      />
      <MoveMoneyModal
        isOpen={Boolean(modals.moveMoneyState)}
        onClose={modals.closeMoveMoneyModal}
        options={budgetData.moveMoneyOptions}
        initialFromId={modals.moveMoneyState?.fromBudgetId}
        initialAmount={modals.moveMoneyState?.amount}
        defaultApplyScope={budgetData.defaultApplyScope}
        disabledReason={budgetData.moveMoneyDisabledReason}
        fromLocked={budgetData.moveMoneyFromLocked}
        isSaving={budgetData.moveBudgetAmount.isPending}
        onMove={modals.handleMoveMoneySubmit}
      />
      {budgetData.isWalkthroughActive && (
        <BudgetWalkthrough
          onClose={() => budgetData.setIsWalkthroughActive(false)}
        />
      )}
    </Layout>
  );
}
