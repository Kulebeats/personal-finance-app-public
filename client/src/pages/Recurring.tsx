/**
 * Recurring Page
 *
 * Displays recurring transactions in calendar or list view.
 * Uses components from the recurring feature module.
 */

import { useEffect, useRef } from "react";
import { useSearch } from "wouter";
import Layout from "@/components/Layout";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSettings } from "@/contexts/SettingsContext";
import { formatCurrency } from "@/lib/format";
import { parseMoney } from "@/lib/utils";

// Feature module imports
import {
  RecurringCalendar,
  RecurringList,
  RecurringSummary,
  RecurringEditModal,
  RecurringPageHeader,
  RecurringLoadingState,
  RecurringErrorState,
  useRecurringPageData,
  FREQUENCY_LABELS,
} from "@/features/recurring";

export default function Recurring() {
  const settings = useSettings();
  const currency = settings.currency || "ZMW";

  const data = useRecurringPageData();

  // R12: dashboard's RecurringExpensesWidget deep-links to
  // `/recurring?ruleId=<id>` for a specific upcoming bill (audit v2 P2 -
  // that widget was previously a dead end). Consume the param once the
  // rules have loaded and open the existing edit modal for the matching
  // rule. This is a one-time navigation intent, not a filter, so it is
  // consumed once via a ref guard rather than living in persistent state
  // (mirrors the `?action=add` pattern on the Transactions page).
  const urlSearch = useSearch();
  const openedRuleIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!data.recurringData) return;
    const ruleId = new URLSearchParams(urlSearch).get("ruleId");
    if (!ruleId || openedRuleIdRef.current === ruleId) return;
    const match = data.recurringData.find((item) => item.id === ruleId);
    if (!match) return;
    openedRuleIdRef.current = ruleId;
    data.handleEdit(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearch, data.recurringData]);

  // Loading state
  if (data.isLoading) {
    return (
      <Layout>
        <RecurringLoadingState />
      </Layout>
    );
  }

  // Error state
  if (data.error) {
    return (
      <Layout>
        <RecurringErrorState
          error={data.error as Error}
          onRetry={() => window.location.reload()}
        />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <RecurringPageHeader
          upcomingCount={data.upcomingCount}
          upcomingTotal={data.upcomingTotal}
          upcomingExcluded={data.upcomingExcluded}
          currency={currency}
          viewMode={data.viewMode}
          setViewMode={data.setViewMode}
        />

        {/* Calendar Controls */}
        <div className="flex items-center justify-between bg-card p-4 rounded-lg border border-border shadow-sm">
          <button
            className="p-2 hover:bg-muted rounded-full"
            onClick={() => data.navigateMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>
          <h2 className="text-lg font-semibold">{data.monthName}</h2>
          <button
            className="p-2 hover:bg-muted rounded-full"
            onClick={() => data.navigateMonth(1)}
            aria-label="Next month"
          >
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="md:col-span-2">
            <Card className="p-6 shadow-sm border-border h-full">
              {data.viewMode === "calendar" ? (
                data.calendarUnavailable ? (
                  <div>
                    <p role="status">Calendar status is unavailable.</p>
                    <button type="button" className="text-primary underline" onClick={() => void data.retryCalendar()}>
                      Retry calendar
                    </button>
                  </div>
                ) : (
                  <>
                    {data.calendarLoading && <p role="status">Loading calendar status…</p>}
                    <RecurringCalendar
                      calendarItems={data.calendarItems}
                      daysInMonth={data.daysInMonth}
                      firstDayOfMonth={data.firstDayOfMonth}
                      today={data.today}
                      isCurrentMonth={data.isCurrentMonth}
                      onItemClick={data.handleEdit}
                    />
                  </>
                )
              ) : (
                <RecurringList
                  items={data.recurringData || []}
                  currency={currency}
                  onPauseToggle={data.handlePauseToggle}
                  onEdit={data.handleEdit}
                  onDelete={data.handleDelete}
                  onSkip={data.handleSkip}
                />
              )}
            </Card>
          </div>

          {/* Sidebar */}
          <RecurringSummary
            totalRecurring={data.totalRecurring}
            excludedCount={data.excludedFromTotals}
            billsTotal={data.billsTotal}
            incomeTotal={data.incomeTotal}
            monthName={data.monthName}
            currency={currency}
            upcomingBills={data.upcomingBills || []}
            recurringCount={data.recurringData?.length || 0}
            onViewAll={() => data.setShowAllUpcoming(true)}
          />
        </div>
      </div>

      {/* View All Modal */}
      <Dialog
        open={data.showAllUpcoming}
        onOpenChange={data.setShowAllUpcoming}
      >
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>All Upcoming Bills</DialogTitle>
            <DialogDescription>Bills due in the next 30 days</DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-border overflow-y-auto max-h-[50vh]">
            {data.upcomingBills?.map((item) => {
              const dueDate = new Date(item.nextDueDate);
              return (
                <div
                  key={item.id}
                  className="py-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center justify-center w-10 h-10 bg-muted border border-border rounded text-xs font-bold">
                      <span className="text-rose-500 uppercase text-[9px]">
                        {dueDate.toLocaleDateString("en-US", {
                          month: "short",
                        })}
                      </span>
                      <span className="text-lg leading-none">
                        {dueDate.getDate()}
                      </span>
                    </div>
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {FREQUENCY_LABELS[item.frequency] || item.frequency}
                      </div>
                    </div>
                  </div>
                  <div className="font-semibold">
                    {formatCurrency(parseMoney(item.amount), currency)}
                  </div>
                </div>
              );
            })}
            {(!data.upcomingBills || data.upcomingBills.length === 0) && (
              <div className="py-8 text-center text-muted-foreground">
                No upcoming bills
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <RecurringEditModal
        isOpen={!!data.editItem}
        onClose={() => data.setEditItem(null)}
        form={data.editForm}
        onFormChange={(u) => data.setEditForm({ ...data.editForm, ...u })}
        onSave={data.handleSaveEdit}
        isSaving={data.updateRecurring.isPending}
        currency={data.editItem?.amount.currency}
        verifiedCurrency={data.editItem?.verifiedCurrency}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!data.deleteConfirm}
        onOpenChange={() => data.setDeleteConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete recurring transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{data.deleteConfirm?.name}" and stop
              all future occurrences.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={data.confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}
