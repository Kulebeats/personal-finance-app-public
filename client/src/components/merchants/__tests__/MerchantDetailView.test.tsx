import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
          totalSpent: { amount: "1000.00", currency: "ZMW" },
          transactionCount: 10,
          averageTransaction: { amount: "100.00", currency: "ZMW" },
          trend: [],
        },
        last30: { totalSpent: { amount: "300.00", currency: "ZMW" }, transactionCount: 5, averageTransaction: { amount: "60.00", currency: "ZMW" }, trend: [] },
        last90: { totalSpent: { amount: "600.00", currency: "ZMW" }, transactionCount: 8, averageTransaction: { amount: "75.00", currency: "ZMW" }, trend: [] },
        last365: { totalSpent: { amount: "1000.00", currency: "ZMW" }, transactionCount: 10, averageTransaction: { amount: "100.00", currency: "ZMW" }, trend: [] },
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

  it("calls handleDeleteMerchant once the archive is confirmed in the dialog", async () => {
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

    // NEW-37: the app's confirm dialog comes first; nothing is archived yet.
    const dialog = await screen.findByRole("alertdialog", { name: /archive merchant\?/i });
    expect(handleDeleteMerchant).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive merchant$/i }));
    expect(handleDeleteMerchant).toHaveBeenCalledTimes(1);
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
          totalSpent: { amount: "1000.00", currency: "ZMW" },
          transactionCount: 10,
          averageTransaction: { amount: "100.00", currency: "ZMW" },
          trend: [],
        },
        last30: { totalSpent: { amount: "300.00", currency: "ZMW" }, transactionCount: 5, averageTransaction: { amount: "60.00", currency: "ZMW" }, trend: [] },
        last90: { totalSpent: { amount: "600.00", currency: "ZMW" }, transactionCount: 8, averageTransaction: { amount: "75.00", currency: "ZMW" }, trend: [] },
        last365: { totalSpent: { amount: "1000.00", currency: "ZMW" }, transactionCount: 10, averageTransaction: { amount: "100.00", currency: "ZMW" }, trend: [] },
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

/**
 * NEW-37: archiving a merchant from its detail view asks through the app's
 * AlertDialog, never the browser's native confirm box.
 */
describe("MerchantDetailView archive confirmation", () => {
  function arrange() {
    const handleDeleteMerchant = vi.fn();
    const defaults = mockedUseMerchantDetailState.getMockImplementation()!(null);
    mockedUseMerchantDetailState.mockReturnValue({
      ...defaults,
      data: { ...defaults.data, merchant: mockMerchant },
      actions: { ...defaults.actions, handleDeleteMerchant },
    });
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MerchantDetailView merchantId="1" onClose={vi.fn()} />, { wrapper: createWrapper() });
    return { handleDeleteMerchant, nativeConfirm, user: userEvent.setup() };
  }

  it("opens the dialog instead of the native confirm, and Cancel archives nothing", async () => {
    const { handleDeleteMerchant, nativeConfirm, user } = arrange();

    await user.click(screen.getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("alertdialog", { name: /archive merchant\?/i });
    expect(within(dialog).getByText(/transactions, aliases and logo are kept/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(handleDeleteMerchant).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
    nativeConfirm.mockRestore();
  });

  it("the D shortcut opens the dialog; Escape cancels and returns focus to the trigger", async () => {
    const { handleDeleteMerchant, nativeConfirm, user } = arrange();
    const trigger = screen.getByRole("button", { name: /delete/i });
    trigger.focus();

    await user.keyboard("d");
    await screen.findByRole("alertdialog", { name: /archive merchant\?/i });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(handleDeleteMerchant).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
    nativeConfirm.mockRestore();
  });
});
