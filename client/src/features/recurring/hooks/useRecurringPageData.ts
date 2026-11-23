/**
 * useRecurringPageData Hook
 *
 * Centralizes data fetching, transformations, and handlers for Recurring page.
 * NOTE: Business logic (totals, calendar items) remains for now but should
 * ideally come from server API per enterprise patterns.
 */

import { useState, useCallback, useEffect, useRef, type SetStateAction } from "react";
import { useFormatters } from "@/contexts/SettingsContext";
import { useHouseholdCalendarTimeZone } from "@/lib/calendarZone";
import { householdCalendarDate } from "@shared/household-calendar";
import { sumInCurrency } from "../recurringTotals";
import {
  useRecurring,
  useRecurringCalendar,
  useUpcomingBills,
  useDeleteRecurring,
  usePauseRecurring,
  useUpdateRecurring,
  useSkipRecurring,
  type RecurringTransaction,
} from "@/hooks/useRecurring";
import { type CalendarItem, type RecurringEditForm } from "../types";

export function useRecurringPageData() {
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [selectedMonth, setSelectedMonth] = useState<Date | null>(null);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [deleteConfirm, setDeleteConfirm] =
    useState<RecurringTransaction | null>(null);
  const [editItem, setEditItemState] = useState<RecurringTransaction | null>(null);
  const editVersion = useRef(0);
  const setEditItem = useCallback((item: SetStateAction<RecurringTransaction | null>) => {
    // Closing or opening is a new edit session, including the same rule again.
    editVersion.current++;
    setEditItemState(item);
  }, []);
  useEffect(() => () => { editVersion.current++; }, []);
  const [editForm, setEditForm] = useState<RecurringEditForm>({
    name: "",
    amount: "",
    frequency: "",
  });
  const { currency: defaultCurrency } = useFormatters();

  // API hooks
  const { data: recurringData, isLoading, error, refetch: refetchRecurring } = useRecurring();
  const { data: upcomingBills } = useUpcomingBills(30);
  const deleteRecurring = useDeleteRecurring();
  const pauseRecurring = usePauseRecurring();
  const updateRecurring = useUpdateRecurring();
  const skipRecurring = useSkipRecurring();

  // Calendar values
  const calendarZone = useHouseholdCalendarTimeZone();
  const [todayYear, todayMonth, today] = householdCalendarDate(new Date(), calendarZone).split("-").map(Number);
  const currentDate = selectedMonth ?? new Date(todayYear, todayMonth - 1, 1);
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const monthName = currentDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const isCurrentMonth = todayMonth === month + 1 && todayYear === year;
  const monthKey = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}`;
  const calendar = useRecurringCalendar(
    { from: `${monthKey}-01`, to: `${monthKey}-${daysInMonth}` },
    viewMode === "calendar" && !isLoading && !error,
  );
  const calendarItems: CalendarItem[] = (calendar.data ?? []).map(({ id, date, rule, amount, status }) => ({
    id, day: Number(date.slice(8)), name: rule.name, amount, status, isPaused: rule.isPaused, raw: rule,
  }));

  // Totals - MoneyDto precision, and only amounts proven in the display
  // currency (FIN-05); the rest are counted so the page can say so.
  const rules = recurringData ?? [];
  const allRules = sumInCurrency(rules.map((r) => r.amount), defaultCurrency);
  const totalRecurring = allRules.total;
  const excludedFromTotals = allRules.excludedCount;
  const billsTotal = sumInCurrency(rules.filter((r) => r.type === "expense").map((r) => r.amount), defaultCurrency).total;
  const incomeTotal = sumInCurrency(rules.filter((r) => r.type === "income").map((r) => r.amount), defaultCurrency).total;
  const upcomingCount = upcomingBills?.length || 0;
  const upcoming = sumInCurrency((upcomingBills ?? []).map((r) => r.amount), defaultCurrency);
  const upcomingTotal = upcoming.total;
  const upcomingExcluded = upcoming.excludedCount;

  // Handlers
  const navigateMonth = (delta: number) =>
    setSelectedMonth(new Date(year, month + delta, 1));
  const handlePauseToggle = (item: RecurringTransaction) =>
    pauseRecurring.mutate({ id: item.id, pause: !item.isPaused });
  const handleSkip = (item: RecurringTransaction) =>
    skipRecurring.mutate({ id: item.id, occurrenceDate: item.nextDueDate });
  const handleDelete = (item: RecurringTransaction) => setDeleteConfirm(item);
  const confirmDelete = () => {
    if (deleteConfirm) {
      deleteRecurring.mutate(deleteConfirm.id);
      setDeleteConfirm(null);
    }
  };
  const handleEdit = (item: RecurringTransaction) => {
    setEditForm({
      name: item.name,
      amount: item.amount.amount,
      expectedDefinition: item.definitionToken,
      frequency: item.frequency,
      nextDueDate: item.nextDueDate,
      endDate: item.endDate || undefined,
      notes: item.notes || undefined,
      reminderDays: item.reminderDays || undefined,
      reminderEmail: item.reminderEmail || false,
    });
    setEditItem(item);
  };
  const handleSaveEdit = () => {
    if (!editItem) return;
    const saveVersion = ++editVersion.current;
    const isCurrentEdit = () => editVersion.current === saveVersion;
    const resolvedFrequency = editForm.frequency || editItem.frequency;
    updateRecurring.mutate(
      {
        id: editItem.id,
        data: {
          name: editForm.name,
          ...(editForm.confirmDenomination ? { confirmDenomination: true, expectedDefinition: editForm.expectedDefinition } : {}),
          ...(editForm.confirmDenomination || editItem.verifiedCurrency === "ZMW" ? { amount: {
            amount: editForm.amount,
            currency: "ZMW",
          } } : {}),
          frequency: resolvedFrequency,
          nextDueDate: editForm.nextDueDate,
          endDate: editForm.endDate || null,
          notes: editForm.notes || null,
          reminderDays: editForm.reminderDays,
          reminderEmail: editForm.reminderEmail,
        },
      },
      { onSuccess: () => { if (isCurrentEdit()) setEditItem(null); }, onError: () => {
        if (!isCurrentEdit() || !editForm.confirmDenomination) return;
        setEditForm(current => ({ ...current, amount: "", confirmDenomination: false, expectedDefinition: undefined }));
        setEditItem(null);
        void refetchRecurring();
      } },
    );
  };

  return {
    viewMode,
    setViewMode,
    currentDate,
    showAllUpcoming,
    setShowAllUpcoming,
    deleteConfirm,
    setDeleteConfirm,
    editItem,
    setEditItem,
    editForm,
    setEditForm,
    recurringData,
    isLoading,
    error,
    upcomingBills,
    calendarItems,
    calendarLoading: calendar.isLoading,
    calendarUnavailable: calendar.isError,
    retryCalendar: calendar.refetch,
    daysInMonth,
    firstDayOfMonth,
    monthName,
    today,
    isCurrentMonth,
    totalRecurring,
    excludedFromTotals,
    billsTotal,
    incomeTotal,
    upcomingCount,
    upcomingTotal,
    upcomingExcluded,
    navigateMonth,
    handlePauseToggle,
    handleSkip,
    handleDelete,
    confirmDelete,
    handleEdit,
    handleSaveEdit,
    updateRecurring,
  };
}
