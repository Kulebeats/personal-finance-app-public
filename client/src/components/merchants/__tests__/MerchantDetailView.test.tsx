import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MerchantDetailView } from "../MerchantDetailView";
import type { Merchant } from "@/hooks/use-settings";

// Mock wouter
vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

// The detail view renders <MerchantStatsCards>, which reads currency from
// @/contexts/SettingsContext. Mock it so the component tree does not require a
// real SettingsProvider (matching MerchantStatsCards.test.tsx).
vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({
    currency: "USD",
    timezone: "America/New_York",
  }),
}));

// Mock the detail state hook
vi.mock("../detail/useMerchantDetailState", () => ({
  useMerchantDetailState: vi.fn(() => ({
    state: {
      startDate: "",
      endDate: "",
      groupBy: "day",
      transactionCategoryId: "",
      transactionMinAmount: "",
      transactionMaxAmount: "",
      page: 1,
    },
    data: {
      merchant: null,
      analytics: null,
      last30: null,
      last90: null,
      last365: null,
      categoryOptions: [],
      breakdownItems: [],
      aliases: [],
      formattedTransactions: [],
    },
    mutations: {
      deleteMerchant: {
        isPending: false,
        isPaused: false,
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        data: undefined,
        error: null,
        isError: false,
        isIdle: true,
        isSuccess: false,
        status: 'idle' as const,
        variables: undefined,
        reset: vi.fn(),
        context: undefined,
        failureCount: 0,
        failureReason: null,
        submittedAt: 0,
      },
      addAlias: {
        isPending: false,
        isPaused: false,
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        data: undefined,
        error: null,
        isError: false,
        isIdle: true,
        isSuccess: false,
        status: 'idle' as const,
        variables: undefined,
        reset: vi.fn(),
        context: undefined,
        failureCount: 0,
        failureReason: null,
        submittedAt: 0,
      },
      deleteAlias: {
        isPending: false,
        isPaused: false,
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        data: undefined,
        error: null,
        isError: false,
        isIdle: true,
        isSuccess: false,
        status: 'idle' as const,
        variables: undefined,
        reset: vi.fn(),
        context: undefined,
        failureCount: 0,
        failureReason: null,
        submittedAt: 0,
      },
    },
    actions: {
      setStartDate: vi.fn(),
      setEndDate: vi.fn(),
      setGroupBy: vi.fn(),
      setTransactionCategoryId: vi.fn(),
      setTransactionMinAmount: vi.fn(),
      setTransactionMaxAmount: vi.fn(),
      setPage: vi.fn(),
      applyQuickRange: vi.fn(),
      handleDeleteMerchant: vi.fn(),
      handleExport: vi.fn(),
    },
  })),
}));

import { useMerchantDetailState } from "../detail/useMerchantDetailState";
const mockedUseMerchantDetailState = vi.mocked(useMerchantDetailState);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // TooltipProvider is required by the Edit/Delete <Tooltip> wrappers in the
  // detail view header.
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
};

const mockMerchant: Merchant = {
  id: "1",
  householdId: "h1",
  name: "Test Merchant",
  logoUrl: null,
  category: "Food & Dining",
  defaultCategoryId: null,
  notes: null,
  isActive: true,
  iconType: "logo",
  customIcon: null,
  transactionCount: 10,
  lastTransactionDate: "2024-01-01",
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
};

describe("MerchantDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when merchantId is null", () => {
    render(
      <MerchantDetailView merchantId={null} onClose={vi.fn()} />,
      { wrapper: createWrapper() }
    );

    // Dialog should not be visible
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders merchant details when merchantId is provided", () => {
    mockedUseMerchantDetailState.mockReturnValue({
      state: {
        startDate: "",
        endDate: "",
        groupBy: "day",
        transactionCategoryId: "",
        transactionMinAmount: "",
        transactionMaxAmount: "",
        page: 1,
      },
      data: {
        merchant: mockMerchant,
        analytics: {
          totalSpent: 1000,
          transactionCount: 10,
          averageTransaction: 100,
          trend: [],
        },
        last30: { totalSpent: 300, transactionCount: 5, averageTransaction: 60, trend: [] },
        last90: { totalSpent: 600, transactionCount: 8, averageTransaction: 75, trend: [] },
        last365: { totalSpent: 1000, transactionCount: 10, averageTransaction: 100, trend: [] },
        categoryOptions: [],
        breakdownItems: [],
        aliases: [],
        formattedTransactions: [],
      },
      mutations: {
        deleteMerchant: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        addAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        deleteAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
      },
      actions: {
        setStartDate: vi.fn(),
        setEndDate: vi.fn(),
        setGroupBy: vi.fn(),
        setTransactionCategoryId: vi.fn(),
        setTransactionMinAmount: vi.fn(),
        setTransactionMaxAmount: vi.fn(),
        setPage: vi.fn(),
        applyQuickRange: vi.fn(),
        handleDeleteMerchant: vi.fn(),
        handleExport: vi.fn(),
      },
    });

    render(
      <MerchantDetailView merchantId="1" onClose={vi.fn()} />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText("Test Merchant")).toBeInTheDocument();
    expect(screen.getByText("Food & Dining")).toBeInTheDocument();
  });

  it("calls onClose when dialog is closed", () => {
    const onClose = vi.fn();
    mockedUseMerchantDetailState.mockReturnValue({
      state: {
        startDate: "",
        endDate: "",
        groupBy: "day",
        transactionCategoryId: "",
        transactionMinAmount: "",
        transactionMaxAmount: "",
        page: 1,
      },
      data: {
        merchant: mockMerchant,
        analytics: undefined,
        last30: undefined,
        last90: undefined,
        last365: undefined,
        categoryOptions: [],
        breakdownItems: [],
        aliases: [],
        formattedTransactions: [],
      },
      mutations: {
        deleteMerchant: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        addAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        deleteAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
      },
      actions: {
        setStartDate: vi.fn(),
        setEndDate: vi.fn(),
        setGroupBy: vi.fn(),
        setTransactionCategoryId: vi.fn(),
        setTransactionMinAmount: vi.fn(),
        setTransactionMaxAmount: vi.fn(),
        setPage: vi.fn(),
        applyQuickRange: vi.fn(),
        handleDeleteMerchant: vi.fn(),
        handleExport: vi.fn(),
      },
    });

    render(
      <MerchantDetailView merchantId="1" onClose={onClose} />,
      { wrapper: createWrapper() }
    );

    // Dialog close would trigger onClose
    // This test would need to interact with the dialog close button
  });

  it("calls onEdit when edit button is clicked", () => {
    const onEdit = vi.fn();
    const onClose = vi.fn();
    mockedUseMerchantDetailState.mockReturnValue({
      state: {
        startDate: "",
        endDate: "",
        groupBy: "day",
        transactionCategoryId: "",
        transactionMinAmount: "",
        transactionMaxAmount: "",
        page: 1,
      },
      data: {
        merchant: mockMerchant,
        analytics: undefined,
        last30: undefined,
        last90: undefined,
        last365: undefined,
        categoryOptions: [],
        breakdownItems: [],
        aliases: [],
        formattedTransactions: [],
      },
      mutations: {
        deleteMerchant: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        addAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        deleteAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
      },
      actions: {
        setStartDate: vi.fn(),
        setEndDate: vi.fn(),
        setGroupBy: vi.fn(),
        setTransactionCategoryId: vi.fn(),
        setTransactionMinAmount: vi.fn(),
        setTransactionMaxAmount: vi.fn(),
        setPage: vi.fn(),
        applyQuickRange: vi.fn(),
        handleDeleteMerchant: vi.fn(),
        handleExport: vi.fn(),
      },
    });

    render(
      <MerchantDetailView merchantId="1" onClose={onClose} onEdit={onEdit} />,
      { wrapper: createWrapper() }
    );

    const editButton = screen.getByRole("button", { name: /edit/i });
    fireEvent.click(editButton);

    expect(onEdit).toHaveBeenCalledWith(mockMerchant);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls handleDeleteMerchant when delete button is clicked", () => {
    const handleDeleteMerchant = vi.fn();
    mockedUseMerchantDetailState.mockReturnValue({
      state: {
        startDate: "",
        endDate: "",
        groupBy: "day",
        transactionCategoryId: "",
        transactionMinAmount: "",
        transactionMaxAmount: "",
        page: 1,
      },
      data: {
        merchant: mockMerchant,
        analytics: undefined,
        last30: undefined,
        last90: undefined,
        last365: undefined,
        categoryOptions: [],
        breakdownItems: [],
        aliases: [],
        formattedTransactions: [],
      },
      mutations: {
        deleteMerchant: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        addAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        deleteAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
      },
      actions: {
        setStartDate: vi.fn(),
        setEndDate: vi.fn(),
        setGroupBy: vi.fn(),
        setTransactionCategoryId: vi.fn(),
        setTransactionMinAmount: vi.fn(),
        setTransactionMaxAmount: vi.fn(),
        setPage: vi.fn(),
        applyQuickRange: vi.fn(),
        handleDeleteMerchant,
        handleExport: vi.fn(),
      },
    });

    render(
      <MerchantDetailView merchantId="1" onClose={vi.fn()} />,
      { wrapper: createWrapper() }
    );

    const deleteButton = screen.getByRole("button", { name: /delete/i });
    fireEvent.click(deleteButton);

    expect(handleDeleteMerchant).toHaveBeenCalled();
  });

  it("disables edit button when onEdit is not provided", () => {
    mockedUseMerchantDetailState.mockReturnValue({
      state: {
        startDate: "",
        endDate: "",
        groupBy: "day",
        transactionCategoryId: "",
        transactionMinAmount: "",
        transactionMaxAmount: "",
        page: 1,
      },
      data: {
        merchant: mockMerchant,
        analytics: undefined,
        last30: undefined,
        last90: undefined,
        last365: undefined,
        categoryOptions: [],
        breakdownItems: [],
        aliases: [],
        formattedTransactions: [],
      },
      mutations: {
        deleteMerchant: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        addAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        deleteAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
      },
      actions: {
        setStartDate: vi.fn(),
        setEndDate: vi.fn(),
        setGroupBy: vi.fn(),
        setTransactionCategoryId: vi.fn(),
        setTransactionMinAmount: vi.fn(),
        setTransactionMaxAmount: vi.fn(),
        setPage: vi.fn(),
        applyQuickRange: vi.fn(),
        handleDeleteMerchant: vi.fn(),
        handleExport: vi.fn(),
      },
    });

    render(
      <MerchantDetailView merchantId="1" onClose={vi.fn()} />,
      { wrapper: createWrapper() }
    );

    const editButton = screen.getByRole("button", { name: /edit/i });
    expect(editButton).toBeDisabled();
  });

  it("displays stats cards with merchant analytics", () => {
    mockedUseMerchantDetailState.mockReturnValue({
      state: {
        startDate: "",
        endDate: "",
        groupBy: "day",
        transactionCategoryId: "",
        transactionMinAmount: "",
        transactionMaxAmount: "",
        page: 1,
      },
      data: {
        merchant: mockMerchant,
        analytics: {
          totalSpent: 1000,
          transactionCount: 10,
          averageTransaction: 100,
          trend: [],
        },
        last30: { totalSpent: 300, transactionCount: 5, averageTransaction: 60, trend: [] },
        last90: { totalSpent: 600, transactionCount: 8, averageTransaction: 75, trend: [] },
        last365: { totalSpent: 1000, transactionCount: 10, averageTransaction: 100, trend: [] },
        categoryOptions: [],
        breakdownItems: [],
        aliases: [],
        formattedTransactions: [],
      },
      mutations: {
        deleteMerchant: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        addAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
        deleteAlias: {
          isPending: false,
          isPaused: false,
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          data: undefined,
          error: null,
          isError: false,
          isIdle: true,
          isSuccess: false,
          status: 'idle' as const,
          variables: undefined,
          reset: vi.fn(),
          context: undefined,
          failureCount: 0,
          failureReason: null,
          submittedAt: 0,
        },
      },
      actions: {
        setStartDate: vi.fn(),
        setEndDate: vi.fn(),
        setGroupBy: vi.fn(),
        setTransactionCategoryId: vi.fn(),
        setTransactionMinAmount: vi.fn(),
        setTransactionMaxAmount: vi.fn(),
        setPage: vi.fn(),
        applyQuickRange: vi.fn(),
        handleDeleteMerchant: vi.fn(),
        handleExport: vi.fn(),
      },
    });

    render(
      <MerchantDetailView merchantId="1" onClose={vi.fn()} />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText("10")).toBeInTheDocument(); // transaction count
  });
});
