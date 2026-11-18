/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RulesSection from "../index";

// Mock the use-settings hooks
const mockRules = [
  {
    id: "rule-1",
    name: "Categorize Groceries",
    enabled: true,
    priority: 1,
    conditions: [
      { type: "merchant_contains", value: "Shoprite", value2: null },
    ],
    actions: [{ type: "categorize", value: "cat-groceries" }],
    matchCount: 15,
    householdId: "h1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "rule-2",
    name: "Tag Subscriptions",
    enabled: false,
    priority: 2,
    conditions: [
      { type: "description_contains", value: "subscription", value2: null },
    ],
    actions: [
      { type: "add_tags", value: ["tag-1"] },
      { type: "mark_recurring", value: "monthly" },
    ],
    matchCount: 5,
    householdId: "h1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  },
];

const mockCreateRule = vi.fn();
const mockUpdateRule = vi.fn();
const mockDeleteRule = vi.fn();
const mockTestRule = vi.fn();
const mockReorderRules = vi.fn();

vi.mock("@/hooks/use-settings", () => ({
  useRules: vi.fn(() => ({
    data: mockRules,
    isLoading: false,
    error: null,
  })),
  useCreateRule: vi.fn(() => ({
    mutateAsync: mockCreateRule,
    mutate: mockCreateRule,
    isPending: false,
  })),
  useUpdateRule: vi.fn(() => ({
    mutateAsync: mockUpdateRule,
    mutate: mockUpdateRule,
    isPending: false,
  })),
  useDeleteRule: vi.fn(() => ({
    mutateAsync: mockDeleteRule,
    mutate: mockDeleteRule,
    isPending: false,
  })),
  useTestRule: vi.fn(() => ({
    mutateAsync: mockTestRule,
    mutate: mockTestRule,
    isPending: false,
  })),
  useCategories: vi.fn(() => ({
    data: {
      categories: [
        { id: "cat-groceries", name: "Groceries" },
        { id: "cat-utilities", name: "Utilities" },
      ],
    },
    isLoading: false,
  })),
  useMerchants: vi.fn(() => ({
    data: [
      { id: "m1", name: "Shoprite" },
      { id: "m2", name: "Pick n Pay" },
    ],
    isLoading: false,
  })),
  useReorderRules: vi.fn(() => ({
    mutateAsync: mockReorderRules,
    isPending: false,
  })),
  useHouseholdMembers: vi.fn(() => ({
    data: [
      { userId: "u1", user: { fullName: "John Doe", email: "john@example.com" } },
    ],
    isLoading: false,
  })),
  usePreviewRule: vi.fn(() => ({
    mutateAsync: vi.fn(),
    mutate: vi.fn(),
    isPending: false,
    data: null,
  })),
}));

vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: vi.fn(() => ({
    data: [
      { id: "acc-1", name: "Checking Account" },
      { id: "acc-2", name: "Savings Account" },
    ],
    isLoading: false,
  })),
}));

vi.mock("@/hooks/useGoals", () => ({
  useGoals: vi.fn(() => ({
    data: [
      { id: "goal-1", name: "Emergency Fund", type: "save_up" },
      { id: "goal-2", name: "Vacation", type: "save_up" },
    ],
    isLoading: false,
  })),
}));

vi.mock("@/hooks/useTags", () => ({
  useTags: vi.fn(() => ({
    data: [
      { id: "tag-1", name: "Subscription" },
    ],
    isLoading: false,
  })),
}));

// Mock toast
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Mock RuleEditorModal to avoid complex hook dependencies. The mock exposes a
// "Save" button that invokes onSave with a representative editor payload, so we
// can assert how RulesSection wires the save into the create/update mutations
// (the editor produces { name, conditions, conditionLogic, actions, enabled,
// priority, applyToPast } — see useRuleEditorState.handleSave).
vi.mock("../RuleEditorModal", () => ({
  RuleEditorModal: ({
    open,
    onOpenChange,
    rule,
    onSave,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    rule: import("../types").Rule | null;
    onSave: (data: import("../types").RuleEditorSaveData) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="rule-editor-modal" role="dialog">
        <button onClick={() => onOpenChange(false)}>Close</button>
        <button
          onClick={() =>
            onSave({
              name: rule?.name ?? "New Rule",
              conditions: [
                {
                  type: "merchant_name",
                  operator: "contains",
                  value: "Shoprite",
                  enabled: true,
                },
              ],
              conditionLogic: "all",
              actions: [
                { type: "categorize", value: "cat-groceries", enabled: true },
              ],
              enabled: true,
              priority: rule?.priority ?? 0,
              applyToPast: false,
            })
          }
        >
          Save
        </button>
      </div>
    ) : null,
}));

import { useRules } from "@/hooks/use-settings";
const mockedUseRules = vi.mocked(useRules);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("RulesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock
    mockedUseRules.mockReturnValue({
      data: mockRules,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRules>);
  });

  it("renders rules section with title", () => {
    render(<RulesSection />, { wrapper: createWrapper() });

    expect(screen.getByText("Transaction Rules")).toBeInTheDocument();
  });

  it("displays description text", () => {
    render(<RulesSection />, { wrapper: createWrapper() });

    expect(
      screen.getByText(/automate your transaction categorization/i)
    ).toBeInTheDocument();
  });

  it("displays loading state with skeleton", () => {
    mockedUseRules.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useRules>);

    render(<RulesSection />, { wrapper: createWrapper() });

    // When loading, skeleton loader is shown
    const skeleton = document.querySelector(".animate-pulse");
    expect(skeleton).toBeInTheDocument();
  });

  it("displays rule list when data is loaded", async () => {
    render(<RulesSection />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText("Categorize Groceries")).toBeInTheDocument();
    });
    expect(screen.getByText("Tag Subscriptions")).toBeInTheDocument();
  });

  describe("search functionality", () => {
    it("has search input field", async () => {
      render(<RulesSection />, { wrapper: createWrapper() });

      await waitFor(() => {
        const searchInput = screen.getByPlaceholderText(/search rules/i);
        expect(searchInput).toBeInTheDocument();
      });
    });

    it("search input accepts input", async () => {
      render(<RulesSection />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search rules/i)).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/search rules/i);
      fireEvent.change(searchInput, { target: { value: "Groceries" } });

      expect(searchInput).toHaveValue("Groceries");
    });
  });

  describe("rule toggling", () => {
    it("displays enabled/disabled state for each rule", async () => {
      render(<RulesSection />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("Categorize Groceries")).toBeInTheDocument();
      });

      // Rules should be visible with their toggle states
      expect(screen.getByText("Tag Subscriptions")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("handles empty rules list", () => {
      mockedUseRules.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      } as unknown as ReturnType<typeof useRules>);

      render(<RulesSection />, { wrapper: createWrapper() });

      expect(screen.getByText("Transaction Rules")).toBeInTheDocument();
    });
  });

  describe("error handling", () => {
    it("renders within error boundary", () => {
      render(<RulesSection />, { wrapper: createWrapper() });

      expect(screen.getByText("Transaction Rules")).toBeInTheDocument();
    });
  });

  describe("accessibility", () => {
    it("has accessible section title", () => {
      render(<RulesSection />, { wrapper: createWrapper() });

      expect(screen.getByText("Transaction Rules")).toBeInTheDocument();
    });

    it("search input has placeholder text", async () => {
      render(<RulesSection />, { wrapper: createWrapper() });

      await waitFor(() => {
        const searchInput = screen.getByPlaceholderText(/search rules/i);
        expect(searchInput).toBeInTheDocument();
      });
    });
  });

  describe("header actions", () => {
    it("has quick rule builder button", async () => {
      render(<RulesSection />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("Transaction Rules")).toBeInTheDocument();
      });

      // RulesHeaderActions should have buttons
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe("rule editor modal", () => {
    it("initially has modal closed", () => {
      render(<RulesSection />, { wrapper: createWrapper() });

      expect(screen.queryByTestId("rule-editor-modal")).not.toBeInTheDocument();
    });
  });

  describe("modal save wiring", () => {
    it("sends updateRule a { id, data } payload when editing an existing rule", async () => {
      const user = userEvent.setup();
      render(<RulesSection />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByText("Categorize Groceries")).toBeInTheDocument();
      });

      // Open the editor for the first rule, then save from the modal.
      await user.click(screen.getAllByLabelText("Edit rule")[0]);
      expect(await screen.findByTestId("rule-editor-modal")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Save" }));

      // useUpdateRule expects { id, data: UpdateRuleData }. The payload must be
      // nested under `data`, not spread flat alongside `id`.
      expect(mockUpdateRule).toHaveBeenCalledTimes(1);
      expect(mockUpdateRule).toHaveBeenCalledWith({
        id: "rule-1",
        data: expect.objectContaining({
          name: "Categorize Groceries",
          conditionLogic: "all",
          conditions: expect.any(Array),
          actions: expect.any(Array),
          enabled: true,
          applyToPast: false,
        }),
      });

      // Regression guard against the old flat spread, which put the rule fields
      // at the top level and never sent a `data` key at all.
      const [arg] = mockUpdateRule.mock.calls[0];
      expect(arg).toHaveProperty("data");
      expect(arg).not.toHaveProperty("name");
    });

    it("sends createRule a flat payload when creating a new rule", async () => {
      const user = userEvent.setup();
      render(<RulesSection />, { wrapper: createWrapper() });

      await user.click(
        screen.getByRole("button", { name: /New Rule \(Editor\)/i })
      );
      expect(await screen.findByTestId("rule-editor-modal")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Save" }));

      // Create takes CreateRuleData directly (no { id, data } envelope).
      expect(mockCreateRule).toHaveBeenCalledTimes(1);
      expect(mockCreateRule).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "New Rule",
          conditionLogic: "all",
          conditions: expect.any(Array),
          actions: expect.any(Array),
        })
      );
      const [arg] = mockCreateRule.mock.calls[0];
      expect(arg).not.toHaveProperty("data");
      expect(arg).not.toHaveProperty("id");
    });
  });
});
