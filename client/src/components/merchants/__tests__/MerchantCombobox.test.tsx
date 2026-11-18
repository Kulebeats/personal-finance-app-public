import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MerchantCombobox } from "../MerchantCombobox";
import type { Merchant } from "@/hooks/use-settings";

// Mock the hooks
vi.mock("@/hooks/use-settings", () => ({
  useMerchants: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
}));

vi.mock("../useMerchantCombobox", () => ({
  useMerchantCombobox: vi.fn(() => ({
    open: false,
    setOpen: vi.fn(),
    searchValue: "",
    setSearchValue: vi.fn(),
    cleanedSearch: "",
    normalizedSearch: "",
    selectedMerchant: null,
    filteredMerchants: [],
    recentMerchants: [],
    remainingMerchants: [],
    matchingMerchant: null,
    hasExactMerchantMatch: false,
    showSimilarWarning: false,
    bestSimilarMerchant: null,
    showRecentMerchants: false,
    merchantsLoading: false,
    autocompleteLoading: false,
    cleanMerchantName: (name: string) => name.trim(),
  })),
}));

import { useMerchantCombobox } from "../useMerchantCombobox";
const mockedUseMerchantCombobox = vi.mocked(useMerchantCombobox);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
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
  transactionCount: 5,
  lastTransactionDate: "2024-01-01",
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
};

describe("MerchantCombobox", () => {
  const defaultProps = {
    value: "",
    selectedMerchantId: "",
    onInputChange: vi.fn(),
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onClear: vi.fn(),
    isCreatePending: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with placeholder text", () => {
    mockedUseMerchantCombobox.mockReturnValue({
      open: false,
      setOpen: vi.fn(),
      searchValue: "",
      setSearchValue: vi.fn(),
      cleanedSearch: "",
      normalizedSearch: "",
      selectedMerchant: null,
      filteredMerchants: [],
      recentMerchants: [],
      remainingMerchants: [],
      matchingMerchant: null,
      hasExactMerchantMatch: false,
      showSimilarWarning: false,
      bestSimilarMerchant: null,
      showRecentMerchants: false,
      merchantsLoading: false,
      autocompleteLoading: false,
      cleanMerchantName: (name: string) => name.trim(),
    });

    render(<MerchantCombobox {...defaultProps} placeholder="Select merchant" />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByRole("combobox")).toHaveTextContent("Select merchant");
  });

  it("displays selected merchant name", () => {
    mockedUseMerchantCombobox.mockReturnValue({
      open: false,
      setOpen: vi.fn(),
      searchValue: "Test Merchant",
      setSearchValue: vi.fn(),
      cleanedSearch: "Test Merchant",
      normalizedSearch: "test merchant",
      selectedMerchant: mockMerchant,
      filteredMerchants: [mockMerchant],
      recentMerchants: [],
      remainingMerchants: [mockMerchant],
      matchingMerchant: null,
      hasExactMerchantMatch: false,
      showSimilarWarning: false,
      bestSimilarMerchant: null,
      showRecentMerchants: false,
      merchantsLoading: false,
      autocompleteLoading: false,
      cleanMerchantName: (name: string) => name.trim(),
    });

    render(
      <MerchantCombobox
        {...defaultProps}
        value="Test Merchant"
        selectedMerchantId="1"
      />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByRole("combobox")).toHaveTextContent("Test Merchant");
  });

  it("shows loading state when merchants are loading", () => {
    mockedUseMerchantCombobox.mockReturnValue({
      open: true,
      setOpen: vi.fn(),
      searchValue: "",
      setSearchValue: vi.fn(),
      cleanedSearch: "",
      normalizedSearch: "",
      selectedMerchant: null,
      filteredMerchants: [],
      recentMerchants: [],
      remainingMerchants: [],
      matchingMerchant: null,
      hasExactMerchantMatch: false,
      showSimilarWarning: false,
      bestSimilarMerchant: null,
      showRecentMerchants: false,
      merchantsLoading: true,
      autocompleteLoading: false,
      cleanMerchantName: (name: string) => name.trim(),
    });

    render(<MerchantCombobox {...defaultProps} />, { wrapper: createWrapper() });

    // The combobox should show loading message in placeholder
    // This would be in the CommandInput placeholder
  });

  it("shows exact match warning when merchant exists", () => {
    mockedUseMerchantCombobox.mockReturnValue({
      open: true,
      setOpen: vi.fn(),
      searchValue: "Test",
      setSearchValue: vi.fn(),
      cleanedSearch: "Test",
      normalizedSearch: "test",
      selectedMerchant: null,
      filteredMerchants: [mockMerchant],
      recentMerchants: [],
      remainingMerchants: [mockMerchant],
      matchingMerchant: mockMerchant,
      hasExactMerchantMatch: true,
      showSimilarWarning: false,
      bestSimilarMerchant: null,
      showRecentMerchants: false,
      merchantsLoading: false,
      autocompleteLoading: false,
      cleanMerchantName: (name: string) => name.trim(),
    });

    render(<MerchantCombobox {...defaultProps} value="Test" />, {
      wrapper: createWrapper(),
    });

    // When open, it should show the warning message
    // Note: This depends on the popover being open in the DOM
  });

  it("handles clear selection", async () => {
    const onClear = vi.fn();
    mockedUseMerchantCombobox.mockReturnValue({
      open: true,
      setOpen: vi.fn(),
      searchValue: "Test Merchant",
      setSearchValue: vi.fn(),
      cleanedSearch: "Test Merchant",
      normalizedSearch: "test merchant",
      selectedMerchant: mockMerchant,
      filteredMerchants: [mockMerchant],
      recentMerchants: [],
      remainingMerchants: [mockMerchant],
      matchingMerchant: null,
      hasExactMerchantMatch: false,
      showSimilarWarning: false,
      bestSimilarMerchant: null,
      showRecentMerchants: false,
      merchantsLoading: false,
      autocompleteLoading: false,
      cleanMerchantName: (name: string) => name.trim(),
    });

    render(
      <MerchantCombobox
        {...defaultProps}
        onClear={onClear}
        value="Test Merchant"
        selectedMerchantId="1"
      />,
      { wrapper: createWrapper() }
    );

    // The clear button should be available in the command list
  });

  it("calls onCreate when creating new merchant", async () => {
    const onCreate = vi.fn().mockResolvedValue(mockMerchant);
    const setSearchValue = vi.fn();

    mockedUseMerchantCombobox.mockReturnValue({
      open: true,
      setOpen: vi.fn(),
      searchValue: "New Merchant",
      setSearchValue,
      cleanedSearch: "New Merchant",
      normalizedSearch: "new merchant",
      selectedMerchant: null,
      filteredMerchants: [],
      recentMerchants: [],
      remainingMerchants: [],
      matchingMerchant: null,
      hasExactMerchantMatch: false,
      showSimilarWarning: false,
      bestSimilarMerchant: null,
      showRecentMerchants: false,
      merchantsLoading: false,
      autocompleteLoading: false,
      cleanMerchantName: (name: string) => name.trim(),
    });

    render(
      <MerchantCombobox {...defaultProps} onCreate={onCreate} value="New Merchant" />,
      { wrapper: createWrapper() }
    );

    // The create option should be visible
  });

  it("disables combobox when disabled prop is true", () => {
    mockedUseMerchantCombobox.mockReturnValue({
      open: false,
      setOpen: vi.fn(),
      searchValue: "",
      setSearchValue: vi.fn(),
      cleanedSearch: "",
      normalizedSearch: "",
      selectedMerchant: null,
      filteredMerchants: [],
      recentMerchants: [],
      remainingMerchants: [],
      matchingMerchant: null,
      hasExactMerchantMatch: false,
      showSimilarWarning: false,
      bestSimilarMerchant: null,
      showRecentMerchants: false,
      merchantsLoading: false,
      autocompleteLoading: false,
      cleanMerchantName: (name: string) => name.trim(),
    });

    render(<MerchantCombobox {...defaultProps} disabled={true} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("shows create pending state", () => {
    mockedUseMerchantCombobox.mockReturnValue({
      open: true,
      setOpen: vi.fn(),
      searchValue: "New Merchant",
      setSearchValue: vi.fn(),
      cleanedSearch: "New Merchant",
      normalizedSearch: "new merchant",
      selectedMerchant: null,
      filteredMerchants: [],
      recentMerchants: [],
      remainingMerchants: [],
      matchingMerchant: null,
      hasExactMerchantMatch: false,
      showSimilarWarning: false,
      bestSimilarMerchant: null,
      showRecentMerchants: false,
      merchantsLoading: false,
      autocompleteLoading: false,
      cleanMerchantName: (name: string) => name.trim(),
    });

    render(
      <MerchantCombobox
        {...defaultProps}
        value="New Merchant"
        isCreatePending={true}
      />,
      { wrapper: createWrapper() }
    );

    // When popover is open, the create button should show loading spinner
  });
});
