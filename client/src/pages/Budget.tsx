/**
 * Budget Page
 *
 * Displays budget management with categories, groups, and forecasts.
 * Uses components from the budget feature module.
 */

import Layout from "@/components/Layout";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBudgetRecalculationPreview } from "@/features/budget/hooks/useBudgetRecalculationPreview";
import { UnavailableBudgetsNotice } from "@/features/budget/components/UnavailableBudgetsNotice";
import { isUnbudgetedUnavailable } from "@/hooks/useUnbudgetedSpend";

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
  BudgetGridScroller,
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
  const budgetPreview = useBudgetRecalculationPreview(budgetData.isSettingsOpen);

  // Use modal management hook with save handlers
  const modals = useBudgetModals({
    selectedYear: budgetData.selectedYear,
    selectedMonth: budgetData.selectedMonth,
    moveMoneyOptions: budgetData.moveMoneyOptions,
    budgets: budgetData.apiBudgets,
    householdCurrency: budgetData.householdCurrency,
    unavailableBudgets: budgetData.unavailableBudgets,
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
              <UnavailableBudgetsNotice budgets={budgetData.unavailableBudgets} />
              <BudgetGridScroller>
              <div className="bg-card rounded-lg border border-border shadow-sm overflow-hidden pb-6">
                <BudgetSection
                  title="Income"
                  currency={budgetData.reportingCurrency}
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
                  unbudgetedSpent={budgetData.unbudgetedSpend.income}
                  onToggleShowUnbudgeted={() =>
                    budgetData.toggleUnbudgetedSection("Income")
                  }
                />
                <BudgetSection
                  title="Expenses"
                  currency={budgetData.reportingCurrency}
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
                  unbudgetedSpent={budgetData.unbudgetedSpend.expense}
                  onToggleShowUnbudgeted={() =>
                    budgetData.toggleUnbudgetedSection("Expenses")
                  }
                />
                {budgetData.savingsGroups.length > 0 && (
                  <BudgetSection
                    title="Savings"
                    currency={budgetData.reportingCurrency}
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
                    currency={budgetData.reportingCurrency}
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
              </BudgetGridScroller>
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
            currency={budgetData.reportingCurrency}
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
            isIncomeActualIncomplete={isUnbudgetedUnavailable(budgetData.unbudgetedSpend.income)}
            isExpenseActualIncomplete={isUnbudgetedUnavailable(budgetData.unbudgetedSpend.expense)}
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
        preview={budgetPreview}
        isOpen={budgetData.isSettingsOpen}
        onClose={() => budgetData.setIsSettingsOpen(false)}
        budgetSystem={budgetData.budgetSystem}
        defaultApplyScope={budgetData.defaultApplyScope}
        onSaveSettings={(settings) => {
          budgetData.updateBudgetSettings.mutate(settings, {
            onSuccess: () => budgetData.setIsSettingsOpen(false),
          });
        }}
        categories={budgetData.categories}
        categoryGroups={budgetData.categoryGroups}
        onClear={() => budgetData.clearBudgets.mutate()}
        isSaving={budgetData.updateBudgetSettings.isPending}
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
        opener={modals.budgetEditOpener}
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
