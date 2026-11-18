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

  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 5, 1)
    .toISOString()
    .split("T")[0];
  const defaultTo = today.toISOString().split("T")[0];

  const [startDate, setStartDate] = useState(defaultFrom);
  const [endDate, setEndDate] = useState(defaultTo);

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
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    endDate: defaultTo,
    groupBy: "month",
  });
  const last90 = useMerchantAnalytics(merchantId || undefined, {
    startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    endDate: defaultTo,
    groupBy: "month",
  });
  const last365 = useMerchantAnalytics(merchantId || undefined, {
    startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
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

  const handleDeleteMerchant = (onClose: () => void) => {
    if (!merchant) return;
    const confirmed = window.confirm(
      `Delete merchant "${merchant.name}"? This will archive it.`
    );
    if (!confirmed) return;
    deleteMerchant.mutate(
      { id: merchant.id, options: { action: "soft" } },
      { onSuccess: () => onClose() }
    );
  };

  const handleExport = async () => {
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
      window.location.href = getReportsExportDownloadUrl(exportId);
    } catch (error) {
      console.error(error);
    }
  };

  const applyQuickRange = (days: number) => {
    const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    setStartDate(fromDate);
    setEndDate(defaultTo);
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
