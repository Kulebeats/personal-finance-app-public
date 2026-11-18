/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TagsList } from "../TagsList";

// Mock the hooks
const mockMutateAsync = vi.fn();
const mockCreateTagMutateAsync = vi.fn();
const mockUpdateTagMutateAsync = vi.fn();
const mockMergeTagsMutateAsync = vi.fn();
const mockArchiveTagMutateAsync = vi.fn();

vi.mock("@/hooks", () => ({
  useTags: vi.fn(() => ({
    data: [
      { id: "1", name: "Test Tag", color: "#FF5733", householdId: "h1", usageCount: 5 },
      { id: "2", name: "Another Tag", color: "#33FF57", householdId: "h1", usageCount: 1 },
    ],
    isLoading: false,
    error: null,
  })),
  useDeleteTag: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
  useCreateTag: vi.fn(() => ({
    mutateAsync: mockCreateTagMutateAsync,
    isPending: false,
  })),
  useUpdateTag: vi.fn(() => ({
    mutateAsync: mockUpdateTagMutateAsync,
    isPending: false,
  })),
  useMergeTags: vi.fn(() => ({
    mutateAsync: mockMergeTagsMutateAsync,
    isPending: false,
  })),
  useArchiveTag: vi.fn(() => ({
    mutateAsync: mockArchiveTagMutateAsync,
    isPending: false,
  })),
}));

// Mock toast
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Get the mocked hook for manipulation in tests
import { useTags, useDeleteTag } from "@/hooks";
const mockedUseTags = vi.mocked(useTags);
const mockedUseDeleteTag = vi.mocked(useDeleteTag);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("TagsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue(undefined);
  });

  it("renders list of tags", () => {
    render(<TagsList />, { wrapper: createWrapper() });

    expect(screen.getByText("Test Tag")).toBeInTheDocument();
    expect(screen.getByText("Another Tag")).toBeInTheDocument();
  });

  it("displays loading spinner when loading", () => {
    mockedUseTags.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as ReturnType<typeof useTags>);

    render(<TagsList />, { wrapper: createWrapper() });

    // Should show loading spinner
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("displays error message on error", () => {
    mockedUseTags.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Failed to load"),
    } as unknown as ReturnType<typeof useTags>);

    render(<TagsList />, { wrapper: createWrapper() });

    expect(screen.getByText(/failed to load tags/i)).toBeInTheDocument();
  });

  it("displays empty state when no tags exist", () => {
    mockedUseTags.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTags>);

    render(<TagsList />, { wrapper: createWrapper() });

    expect(screen.getByText("No tags yet.")).toBeInTheDocument();
    expect(screen.getByText(/create tags to organize/i)).toBeInTheDocument();
  });

  it("displays correct transaction count for each tag", () => {
    mockedUseTags.mockReturnValue({
      data: [
        { id: "1", name: "Test Tag", color: "#FF5733", householdId: "h1", usageCount: 5 },
        { id: "2", name: "Single Tag", color: "#33FF57", householdId: "h1", usageCount: 1 },
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTags>);

    render(<TagsList />, { wrapper: createWrapper() });

    expect(screen.getByText("5 transactions")).toBeInTheDocument();
    expect(screen.getByText("1 transaction")).toBeInTheDocument();
  });

  it("shows color indicator for each tag", () => {
    mockedUseTags.mockReturnValue({
      data: [
        { id: "1", name: "Test Tag", color: "#FF5733", householdId: "h1", usageCount: 5 },
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTags>);

    render(<TagsList />, { wrapper: createWrapper() });

    const colorIndicator = document.querySelector('[style*="background-color: rgb(255, 87, 51)"]');
    expect(colorIndicator).toBeInTheDocument();
  });

  it("opens delete confirmation dialog when delete is clicked from dropdown", async () => {
    const user = userEvent.setup();
    mockedUseTags.mockReturnValue({
      data: [
        { id: "1", name: "Test Tag", color: "#FF5733", householdId: "h1", usageCount: 5 },
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTags>);

    render(<TagsList />, { wrapper: createWrapper() });

    // Click the "More actions" dropdown trigger
    const moreButton = screen.getByRole("button", { name: /more actions for Test Tag/i });
    await user.click(moreButton);

    // Wait for dropdown menu and click delete
    const deleteMenuItem = await screen.findByRole("menuitem", { name: /delete/i });
    await user.click(deleteMenuItem);

    // Should show confirmation dialog
    expect(screen.getByText("Delete tag?")).toBeInTheDocument();
    expect(screen.getByText(/are you sure you want to delete "Test Tag"/i)).toBeInTheDocument();
  });

  it("calls delete mutation when confirmed", async () => {
    const user = userEvent.setup();
    mockedUseTags.mockReturnValue({
      data: [
        { id: "1", name: "Test Tag", color: "#FF5733", householdId: "h1", usageCount: 5 },
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTags>);

    render(<TagsList />, { wrapper: createWrapper() });

    // Open dropdown and click delete
    const moreButton = screen.getByRole("button", { name: /more actions for Test Tag/i });
    await user.click(moreButton);

    const deleteMenuItem = await screen.findByRole("menuitem", { name: /delete/i });
    await user.click(deleteMenuItem);

    // Confirm deletion
    const confirmButton = screen.getByRole("button", { name: /delete$/i });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith("1");
    });
  });

  it("closes delete dialog when cancel is clicked", async () => {
    const user = userEvent.setup();
    mockedUseTags.mockReturnValue({
      data: [
        { id: "1", name: "Test Tag", color: "#FF5733", householdId: "h1", usageCount: 5 },
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTags>);

    render(<TagsList />, { wrapper: createWrapper() });

    // Open dropdown and click delete
    const moreButton = screen.getByRole("button", { name: /more actions for Test Tag/i });
    await user.click(moreButton);

    const deleteMenuItem = await screen.findByRole("menuitem", { name: /delete/i });
    await user.click(deleteMenuItem);

    expect(screen.getByText("Delete tag?")).toBeInTheDocument();

    // Cancel
    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancelButton);

    // Dialog should be closed (title no longer visible)
    await waitFor(() => {
      expect(screen.queryByText("Delete tag?")).not.toBeInTheDocument();
    });
  });

  it("has accessible new tag button", () => {
    mockedUseTags.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTags>);

    render(<TagsList />, { wrapper: createWrapper() });

    const newTagButton = screen.getByRole("button", { name: /new tag/i });
    expect(newTagButton).toBeInTheDocument();
  });

  it("has accessible edit buttons for each tag", () => {
    mockedUseTags.mockReturnValue({
      data: [
        { id: "1", name: "Test Tag", color: "#FF5733", householdId: "h1", usageCount: 5 },
        { id: "2", name: "Another Tag", color: "#33FF57", householdId: "h1", usageCount: 1 },
      ],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useTags>);

    render(<TagsList />, { wrapper: createWrapper() });

    const editButtons = screen.getAllByRole("button", { name: /edit/i });
    expect(editButtons).toHaveLength(2);
  });
});
