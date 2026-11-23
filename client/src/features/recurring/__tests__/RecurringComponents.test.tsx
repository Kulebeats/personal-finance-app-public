/**
 * Recurring Components Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecurringCalendar } from "../components/RecurringCalendar";
import { RecurringList } from "../components/RecurringList";
import { RecurringSummary } from "../components/RecurringSummary";
import type { CalendarItem } from "../types";
import type { RecurringTransaction } from "@/hooks/useRecurring";

// Mock formatCurrency
vi.mock("@/lib/money", () => ({
  formatCurrency: (val: { amount: string; currency: string }) =>
    `${val.currency} ${val.amount}`,
  sumMoneyDto: () => ({ amount: "0.00", currency: "USD" }),
  zeroMoneyDto: () => ({ amount: "0.00", currency: "USD" }),
  // parseMoneyString is consumed transitively: RecurringList renders amounts via
  // parseMoney() from @/lib/utils, whose real implementation calls
  // parseMoneyString(value.amount).toNumber(). Return a Decimal-like stub so the
  // numeric value (used by the income/sort assertions) is preserved.
  parseMoneyString: (value: string | number | null | undefined) => ({
    toNumber: () => Number(value ?? 0),
  }),
}));

const createMockTransaction = (
  overrides: Partial<RecurringTransaction> = {},
): RecurringTransaction => ({
  id: "rec-1",
  name: "Netflix",
  amount: { amount: "15.99", currency: "USD" },
  frequency: "monthly",
  type: "expense",
  nextDueDate: new Date().toISOString(),
  isPaused: false,
  isActive: true,
  categoryId: "cat-1",
  householdId: "h-1",
  accountId: "acc-1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const createMockCalendarItem = (
  overrides: Partial<CalendarItem> = {},
): CalendarItem => ({
  id: "rec-1",
  day: 15,
  name: "Netflix",
  amount: { amount: "15.99", currency: "USD" },
  status: "upcoming",
  isPaused: false,
  raw: createMockTransaction(),
  ...overrides,
});

describe("RecurringCalendar", () => {
  const defaultProps = {
    calendarItems: [createMockCalendarItem({ day: 15 })],
    daysInMonth: 30,
    firstDayOfMonth: 0, // Sunday
    today: 10,
    isCurrentMonth: true,
    onItemClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders day headers", () => {
    render(<RecurringCalendar {...defaultProps} />);
    expect(screen.getByText("Sun")).toBeInTheDocument();
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Tue")).toBeInTheDocument();
    expect(screen.getByText("Wed")).toBeInTheDocument();
    expect(screen.getByText("Thu")).toBeInTheDocument();
    expect(screen.getByText("Fri")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
  });

  it("renders all days of the month", () => {
    render(<RecurringCalendar {...defaultProps} />);
    for (let i = 1; i <= 30; i++) {
      expect(screen.getByText(String(i))).toBeInTheDocument();
    }
  });

  it("highlights today", () => {
    render(<RecurringCalendar {...defaultProps} />);
    const todayCell = screen.getByText("10").closest("div[class*='border']");
    expect(todayCell).toHaveClass("bg-primary/5");
  });

  it("renders calendar items on correct day", () => {
    render(<RecurringCalendar {...defaultProps} />);
    expect(screen.getByText("Netflix")).toBeInTheDocument();
  });

  it("calls onItemClick when item is clicked", () => {
    const onItemClick = vi.fn();
    render(<RecurringCalendar {...defaultProps} onItemClick={onItemClick} />);

    fireEvent.click(screen.getByText("Netflix"));
    expect(onItemClick).toHaveBeenCalledWith(defaultProps.calendarItems[0].raw);
  });

  it("shows paused items with reduced opacity", () => {
    const pausedItem = createMockCalendarItem({ isPaused: true });
    render(
      <RecurringCalendar {...defaultProps} calendarItems={[pausedItem]} />,
    );

    // The opacity is on the button element, not the container div
    const buttonElement = screen.getByText("Netflix").closest("button");
    expect(buttonElement).toHaveClass("opacity-60");
  });
});

describe("RecurringList", () => {
  const defaultTransaction = createMockTransaction();
  const defaultProps = {
    items: [defaultTransaction],
    currency: "USD",
    onPauseToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onSkip: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders list headers", () => {
    render(<RecurringList {...defaultProps} />);
    expect(screen.getByText("Day")).toBeInTheDocument();
    expect(screen.getByText("Merchant")).toBeInTheDocument();
    expect(screen.getByText("Frequency")).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
  });

  it("renders transaction name", () => {
    render(<RecurringList {...defaultProps} />);
    expect(screen.getByText("Netflix")).toBeInTheDocument();
  });

  it("renders transaction type", () => {
    render(<RecurringList {...defaultProps} />);
    expect(screen.getByText("expense")).toBeInTheDocument();
  });

  it("renders frequency label", () => {
    render(<RecurringList {...defaultProps} />);
    expect(screen.getByText("Monthly")).toBeInTheDocument();
  });

  it("shows paused badge for paused items", () => {
    const pausedItem = createMockTransaction({ isPaused: true });
    render(<RecurringList {...defaultProps} items={[pausedItem]} />);
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("shows income in green", () => {
    const incomeItem = createMockTransaction({ type: "income" });
    render(<RecurringList {...defaultProps} items={[incomeItem]} />);

    const amountElement = screen.getByText(/\+\$15\.99/);
    expect(amountElement).toHaveClass("text-chart-income");
  });

  it("sorts items by due date", () => {
    const item1 = createMockTransaction({
      id: "r1",
      name: "Late Bill",
      nextDueDate: new Date(2024, 0, 25).toISOString(),
    });
    const item2 = createMockTransaction({
      id: "r2",
      name: "Early Bill",
      nextDueDate: new Date(2024, 0, 5).toISOString(),
    });

    render(<RecurringList {...defaultProps} items={[item1, item2]} />);

    const names = screen.getAllByText(/Bill/);
    expect(names[0]).toHaveTextContent("Early Bill");
    expect(names[1]).toHaveTextContent("Late Bill");
  });
});

describe("RecurringSummary", () => {
  const defaultProps = {
    totalRecurring: { amount: "5000.00", currency: "USD" },
    billsTotal: { amount: "3500.00", currency: "USD" },
    incomeTotal: { amount: "1500.00", currency: "USD" },
    monthName: "January 2024",
    currency: "USD",
    upcomingBills: [createMockTransaction()],
    recurringCount: 10,
    onViewAll: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders total recurring amount", () => {
    render(<RecurringSummary {...defaultProps} />);
    expect(screen.getByText("USD 5000.00")).toBeInTheDocument();
  });

  it("renders month name", () => {
    render(<RecurringSummary {...defaultProps} />);
    expect(screen.getByText(/January 2024/)).toBeInTheDocument();
  });

  it("renders bills total", () => {
    render(<RecurringSummary {...defaultProps} />);
    expect(screen.getByText("USD 3500.00")).toBeInTheDocument();
  });

  it("renders income total in green", () => {
    render(<RecurringSummary {...defaultProps} />);
    const incomeElement = screen.getByText("USD 1500.00");
    expect(incomeElement).toHaveClass("text-chart-income");
  });

  it("renders upcoming bills section", () => {
    render(<RecurringSummary {...defaultProps} />);
    expect(screen.getByText("Upcoming Bills")).toBeInTheDocument();
  });

  it("renders upcoming bill items", () => {
    render(<RecurringSummary {...defaultProps} />);
    expect(screen.getByText("Netflix")).toBeInTheDocument();
  });

  it("calls onViewAll when View All is clicked", () => {
    const onViewAll = vi.fn();
    render(<RecurringSummary {...defaultProps} onViewAll={onViewAll} />);

    fireEvent.click(screen.getByText("View All"));
    expect(onViewAll).toHaveBeenCalled();
  });

  it("shows recurring count in status card", () => {
    render(<RecurringSummary {...defaultProps} />);
    expect(screen.getByText(/10 recurring/)).toBeInTheDocument();
  });

  it("shows empty state when no upcoming bills", () => {
    render(<RecurringSummary {...defaultProps} upcomingBills={[]} />);
    expect(screen.getByText("No upcoming bills")).toBeInTheDocument();
  });
});
