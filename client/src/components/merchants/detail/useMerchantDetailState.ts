import { calendarDaysAgo, calendarMonthRange, calendarToday, useCalendarTimeZone } from "@/lib/calendarZone";
import type { CalendarDateRange } from "@shared/household-calendar";
import { useMemo, useState } from "react";
import {
  useAddMerchantAlias,
  useCategories,
  useDeleteMerchant,
  useDeleteMerchantAlias,
  useMerchantAnalytics,
  useMerchantDetails,
  useMerchantTransactions,
} from "@/hooks/use-settings";
import {
  getReportsExportDownloadUrl,
  requestReportExport,
  useReportsSpendingBreakdown,
} from "@/hooks/use-reports";
import { parseMoneyInputNumber } from "@/lib/money";

export function useMerchantDetailState(merchantId: string | null) {
  const [page, setPage] = useState(0);
  const [groupBy, setGroupBy] = useState<"month" | "day">("month");
  const [transactionCategoryId, setTransactionCategoryId] = useState("all");
  const [transactionMinAmount, setTransactionMinAmount] = useState("");
  const [transactionMaxAmount, setTransactionMaxAmount] = useState("");

  // NEW-15: every range counts from one calendar-zone today. The defaults are
  // derived on each render, so they follow the saved zone when settings load
  // after the first render. Once the user edits either end, the whole range
  // they saw is kept in state and a zone change no longer moves it.
  useCalendarTimeZone();
  const defaultFrom = calendarMonthRange(-5).from;
  const defaultTo = calendarToday();
  const [chosenRange, setChosenRange] = useState<CalendarDateRange | null>(null);
  const startDate = chosenRange?.from ?? defaultFrom;
  const endDate = chosenRange?.to ?? defaultTo;
  const setStartDate = (from: string) => setChosenRange({ from, to: endDate });
  const setEndDate = (to: string) => setChosenRange({ from: startDate, to });

  const { data: categoryData } = useCategories();
  const { data: details } = useMerchantDetails(merchantId || undefined);
  const { data: analytics } = useMerchantAnalytics(merchantId || undefined, {
    startDate,
    endDate,
    groupBy,
  });
  const { data: categoryBreakdown } = useReportsSpendingBreakdown(
    {
      from: startDate,
      to: endDate,
      groupBy: "category",
      limit: 6,
      merchantId: merchantId || undefined,
    },
    { enabled: !!merchantId }
  );
  const last30 = useMerchantAnalytics(merchantId || undefined, {
    startDate: calendarDaysAgo(30),
    endDate: defaultTo,
    groupBy: "month",
  });
  const last90 = useMerchantAnalytics(merchantId || undefined, {
    startDate: calendarDaysAgo(90),
    endDate: defaultTo,
    groupBy: "month",
  });
  const last365 = useMerchantAnalytics(merchantId || undefined, {
    startDate: calendarDaysAgo(365),
    endDate: defaultTo,
    groupBy: "month",
  });

  const minAmountValue = useMemo(() => {
    return parseMoneyInputNumber(transactionMinAmount) ?? undefined;
  }, [transactionMinAmount]);

  const maxAmountValue = useMemo(() => {
    return parseMoneyInputNumber(transactionMaxAmount) ?? undefined;
  }, [transactionMaxAmount]);

  const { data: transactions } = useMerchantTransactions(
    merchantId || undefined,
    {
      limit: 10,
      offset: page * 10,
      startDate,
      endDate,
      categoryId:
        transactionCategoryId !== "all" ? transactionCategoryId : undefined,
      minAmount: minAmountValue,
      maxAmount: maxAmountValue,
    }
  );

  const addAlias = useAddMerchantAlias();
  const deleteAlias = useDeleteMerchantAlias();
  const deleteMerchant = useDeleteMerchant();

  const merchant = details?.merchant || null;
  const aliases = details?.aliases || [];

  const formattedTransactions = useMemo(() => {
    return transactions?.transactions || [];
  }, [transactions]);

  /** Archive the merchant; the detail view's confirm dialog asks first. */
  const handleDeleteMerchant = (onClose: () => void) => {
    if (!merchant) return;
    deleteMerchant.mutate(
      { id: merchant.id, options: { action: "soft" } },
      { onSuccess: () => onClose() }
    );
  };

  const handleExport = async () => {
    const operation = captureOperationLifetime();
    if (!merchantId) return;
    const payload: Record<string, string> = {
      reportType: "transactions",
      format: "csv",
      startDate,
      endDate,
      merchantId,
    };
    if (transactionCategoryId !== "all") {
      payload.categoryId = transactionCategoryId;
    }
    try {
      const exportId = await requestReportExport(payload);
      await downloadProtectedResource(getReportsExportDownloadUrl(exportId), undefined, operation);
    } catch (error) {
      console.error(error);
    }
  };

  const applyQuickRange = (days: number) => {
    setChosenRange({ from: calendarDaysAgo(days), to: calendarToday() });
  };

  const breakdownItems = useMemo(() => {
    return categoryBreakdown?.items || [];
  }, [categoryBreakdown]);

  const categoryOptions = useMemo(() => {
    return (categoryData?.categories || []).filter(
      (category) => !category.isArchived && !category.deletedAt
    );
  }, [categoryData]);

  return {
    state: {
      page,
      groupBy,
      startDate,
      endDate,
      transactionCategoryId,
      transactionMinAmount,
      transactionMaxAmount,
    },
    data: {
      merchant,
      aliases,
      analytics,
      last30: last30.data,
      last90: last90.data,
      last365: last365.data,
      formattedTransactions,
      breakdownItems,
      categoryOptions,
    },
    mutations: {
      addAlias,
      deleteAlias,
      deleteMerchant,
    },
    actions: {
      setPage,
      setGroupBy,
      setStartDate,
      setEndDate,
      setTransactionCategoryId,
      setTransactionMinAmount,
      setTransactionMaxAmount,
      handleDeleteMerchant,
      handleExport,
      applyQuickRange,
    },
  };
}
import { downloadProtectedResource } from "@/lib/protected-media";
import { captureOperationLifetime } from "@/lib/operation-lifetime";
