/**
 * useRecurringPageData Hook
 *
 * Centralizes data fetching, transformations, and handlers for Recurring page.
 * NOTE: Business logic (totals, calendar items) remains for now but should
 * ideally come from server API per enterprise patterns.
 */

import { useState, useMemo } from "react";
import { useFormatters } from "@/contexts/SettingsContext";
import { sumMoneyDto, zeroMoneyDto } from "@/lib/money";
import {
  useRecurring,
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
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [deleteConfirm, setDeleteConfirm] =
    useState<RecurringTransaction | null>(null);
  const [editItem, setEditItem] = useState<RecurringTransaction | null>(null);
  const [editForm, setEditForm] = useState<RecurringEditForm>({
    name: "",
    amount: "",
    frequency: "",
  });
  const { currency: defaultCurrency } = useFormatters();

  // API hooks
  const { data: recurringData, isLoading, error } = useRecurring();
  const { data: upcomingBills } = useUpcomingBills(30);
  const deleteRecurring = useDeleteRecurring();
  const pauseRecurring = usePauseRecurring();
  const updateRecurring = useUpdateRecurring();
  const skipRecurring = useSkipRecurring();

  // Calendar values
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const monthName = currentDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const today = new Date().getDate();
  const isCurrentMonth =
    new Date().getMonth() === month && new Date().getFullYear() === year;

  // Transform recurring data to calendar items
  const calendarItems = useMemo<CalendarItem[]>(() => {
    if (!recurringData) return [];
    return recurringData
      .map((item) => {
        const dueDate = new Date(item.nextDueDate);
        const day = dueDate.getDate();
        const isThisMonth =
          dueDate.getMonth() === month && dueDate.getFullYear() === year;
        return {
          id: item.id,
          day: isThisMonth ? day : -1,
          name: item.name,
          amount: item.amount, // Keep as MoneyDto for precision
          type: item.type === "expense" ? "bill" : "income",
          status: dueDate < new Date() ? "paid" : "upcoming",
          category: item.categoryId || "Uncategorized",
          logo: item.name.charAt(0).toUpperCase(),
          isPaused: item.isPaused,
          frequency: item.frequency,
          raw: item,
        } as CalendarItem;
      })
      .filter((item) => item.day > 0);
  }, [recurringData, month, year]);

  // Totals - use MoneyDto for precision
  const totalRecurring = recurringData
    ? sumMoneyDto(
        recurringData.map((r) => r.amount),
        defaultCurrency,
      )
    : zeroMoneyDto(defaultCurrency);
  const billsTotal = recurringData
    ? sumMoneyDto(
        recurringData.filter((r) => r.type === "expense").map((r) => r.amount),
        defaultCurrency,
      )
    : zeroMoneyDto(defaultCurrency);
  const incomeTotal = recurringData
    ? sumMoneyDto(
        recurringData.filter((r) => r.type === "income").map((r) => r.amount),
        defaultCurrency,
      )
    : zeroMoneyDto(defaultCurrency);
  const upcomingCount = upcomingBills?.length || 0;
  const upcomingTotal = upcomingBills
    ? sumMoneyDto(
        upcomingBills.map((r) => r.amount),
        defaultCurrency,
      )
    : zeroMoneyDto(defaultCurrency);

  // Handlers
  const navigateMonth = (delta: number) =>
    setCurrentDate(new Date(year, month + delta, 1));
  const handlePauseToggle = (item: RecurringTransaction) =>
    pauseRecurring.mutate({ id: item.id, pause: !item.isPaused });
  const handleSkip = (item: RecurringTransaction) =>
    skipRecurring.mutate(item.id);
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
    const resolvedFrequency = editForm.frequency || editItem.frequency;
    updateRecurring.mutate(
      {
        id: editItem.id,
        data: {
          name: editForm.name,
          amount: {
            amount: editForm.amount,
            currency: editItem.amount.currency ?? defaultCurrency,
          },
          frequency: resolvedFrequency,
          nextDueDate: editForm.nextDueDate,
          endDate: editForm.endDate || null,
          notes: editForm.notes || null,
          reminderDays: editForm.reminderDays,
          reminderEmail: editForm.reminderEmail,
        },
      },
      { onSuccess: () => setEditItem(null) },
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
    daysInMonth,
    firstDayOfMonth,
    monthName,
    today,
    isCurrentMonth,
    totalRecurring,
    billsTotal,
    incomeTotal,
    upcomingCount,
    upcomingTotal,
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
