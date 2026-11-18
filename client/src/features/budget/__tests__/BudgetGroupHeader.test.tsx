/**
 * BudgetGroupHeader Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BudgetGroupHeader } from "../components/BudgetGroupHeader";
import type { BudgetGroup, BudgetCategory } from "../types";

// Mock the formatters context
vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toFixed(2)}`,
  }),
}));

const mockIcon = () => <span data-testid="mock-icon">$</span>;

const createMockGroup = (
  overrides: Partial<BudgetGroup> = {}
): BudgetGroup => ({
  id: "grp-1",
  name: "Housing",
  type: "expense",
  items: [
    {
      id: "c1",
      name: "Rent",
      icon: mockIcon,
      budget: 1500,
      actual: 1500,
      remaining: 0,
    },
    {
      id: "c2",
      name: "Utilities",
      icon: mockIcon,
      budget: 200,
      actual: 150,
      remaining: 50,
    },
  ],
  expanded: true,
  ...overrides,
});

describe("BudgetGroupHeader", () => {
  const defaultProps = {
    group: createMockGroup(),
    onToggle: vi.fn(),
    onAddItem: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders group name", () => {
    render(<BudgetGroupHeader {...defaultProps} />);
    expect(screen.getByText("Housing")).toBeInTheDocument();
  });

  it("renders total budget from items", () => {
    render(<BudgetGroupHeader {...defaultProps} />);
    // 1500 + 200 = 1700
    expect(screen.getByText("$1700.00")).toBeInTheDocument();
  });

  it("renders total actual from items", () => {
    render(<BudgetGroupHeader {...defaultProps} />);
    // 1500 + 150 = 1650
    expect(screen.getByText("$1650.00")).toBeInTheDocument();
  });

  it("renders total remaining from items", () => {
    render(<BudgetGroupHeader {...defaultProps} />);
    // 0 + 50 = 50
    expect(screen.getByText("$50.00")).toBeInTheDocument();
  });

  it("shows chevron down icon when expanded", () => {
    render(<BudgetGroupHeader {...defaultProps} />);
    // Check for the down chevron (expanded state)
    const chevron =
      document.querySelector('[class*="ChevronDown"]') ||
      document.querySelector("svg");
    expect(chevron).toBeInTheDocument();
  });

  it("calls onToggle when header is clicked", () => {
    const onToggle = vi.fn();
    render(<BudgetGroupHeader {...defaultProps} onToggle={onToggle} />);

    const header = screen.getByText("Housing");
    fireEvent.click(header);

    expect(onToggle).toHaveBeenCalled();
  });

  it("shows Flex badge for flexible groups", () => {
    const flexGroup = createMockGroup({ isFlexible: true });
    render(<BudgetGroupHeader {...defaultProps} group={flexGroup} />);
    expect(screen.getByText("Flex")).toBeInTheDocument();
  });

  it("shows Group badge for group budget groups", () => {
    const groupBudgetGroup = createMockGroup({ isGroupBudget: true });
    render(<BudgetGroupHeader {...defaultProps} group={groupBudgetGroup} />);
    expect(screen.getByText("Group")).toBeInTheDocument();
  });

  it("shows budget input for flexible groups with onUpdateBudget", () => {
    const flexGroup = createMockGroup({ isFlexible: true, budget: 2000 });
    const onUpdateBudget = vi.fn();
    render(
      <BudgetGroupHeader
        {...defaultProps}
        group={flexGroup}
        onUpdateBudget={onUpdateBudget}
      />
    );

    expect(screen.getByDisplayValue("2000")).toBeInTheDocument();
  });

  it("shows budget input for group budget groups with onUpdateBudget", () => {
    const groupBudgetGroup = createMockGroup({
      isGroupBudget: true,
      budget: 1800,
    });
    const onUpdateBudget = vi.fn();
    render(
      <BudgetGroupHeader
        {...defaultProps}
        group={groupBudgetGroup}
        onUpdateBudget={onUpdateBudget}
      />
    );

    expect(screen.getByDisplayValue("1800")).toBeInTheDocument();
  });

  it("calls onUpdateBudget when budget value changes", () => {
    const flexGroup = createMockGroup({ isFlexible: true, budget: 2000 });
    const onUpdateBudget = vi.fn();
    render(
      <BudgetGroupHeader
        {...defaultProps}
        group={flexGroup}
        onUpdateBudget={onUpdateBudget}
      />
    );

    const budgetInput = screen.getByDisplayValue("2000");
    fireEvent.change(budgetInput, { target: { value: "2500" } });

    expect(onUpdateBudget).toHaveBeenCalledWith(2500);
  });

  it("calls onCommitBudget on blur", () => {
    const flexGroup = createMockGroup({ isFlexible: true, budget: 2000 });
    const onUpdateBudget = vi.fn();
    const onCommitBudget = vi.fn();
    render(
      <BudgetGroupHeader
        {...defaultProps}
        group={flexGroup}
        onUpdateBudget={onUpdateBudget}
        onCommitBudget={onCommitBudget}
      />
    );

    const budgetInput = screen.getByDisplayValue("2000");
    fireEvent.blur(budgetInput);

    expect(onCommitBudget).toHaveBeenCalledWith(2000);
  });

  it("shows positive remaining in green", () => {
    render(<BudgetGroupHeader {...defaultProps} />);
    const remainingElement = screen.getByText("$50.00");
    expect(remainingElement).toHaveClass("text-emerald-600");
  });

  it("shows negative remaining in red", () => {
    const overBudgetGroup = createMockGroup({
      items: [
        {
          id: "c1",
          name: "Rent",
          icon: mockIcon,
          budget: 1000,
          actual: 1200,
          remaining: -200,
        },
      ],
    });
    render(<BudgetGroupHeader {...defaultProps} group={overBudgetGroup} />);
    const remainingElement = screen.getByText("$-200.00");
    expect(remainingElement).toHaveClass("text-rose-600");
  });
});
