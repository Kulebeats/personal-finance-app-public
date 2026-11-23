/**
 * Mock Data Provider for Reports Module
 *
 * Toggle USE_MOCK_DATA to true to see widgets with realistic demo data
 */

import type { MoneyDto } from "@shared/money";
import type { CalendarDateRange } from "@shared/household-calendar";
import type { ReportsNetWorthChangesResponse } from "@shared/reports";

// ============================================================================
// TOGGLE - Controlled via VITE_USE_MOCK_REPORTS_DATA
// ============================================================================

export const USE_MOCK_DATA =
  import.meta.env?.VITE_USE_MOCK_REPORTS_DATA === "true";

// ============================================================================
// MOCK DATA GENERATORS
// ============================================================================

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const CATEGORIES = [
  { id: "housing", label: "Housing", color: "#3b82f6" },
  { id: "food", label: "Food & Dining", color: "#10b981" },
  { id: "transport", label: "Transportation", color: "#f97316" },
  { id: "utilities", label: "Utilities", color: "#8b5cf6" },
  { id: "healthcare", label: "Healthcare", color: "#ef4444" },
  { id: "entertainment", label: "Entertainment", color: "#ec4899" },
  { id: "shopping", label: "Shopping", color: "#06b6d4" },
  { id: "other", label: "Other", color: "#64748b" },
];

const INCOME_SOURCES = [
  { id: "salary", label: "Salary", color: "#10b981" },
  { id: "freelance", label: "Freelance", color: "#3b82f6" },
  { id: "investments", label: "Investments", color: "#8b5cf6" },
  { id: "other", label: "Other Income", color: "#64748b" },
];

const toMoneyDto = (value: number, currency: string = "ZMW"): MoneyDto => ({
  amount: value.toFixed(2),
  currency,
});

// Generate random value within range with some variance
// Returns at least minValue to prevent chart errors from near-zero values
function rand(
  base: number,
  variance: number = 0.2,
  minValue: number = 100
): number {
  const factor = 1 + (Math.random() - 0.5) * 2 * variance;
  const value = Math.round(base * factor);
  return Math.max(value, minValue);
}

// ============================================================================
// MOCK ANNUAL DATA
// ============================================================================

export function getMockAnnualData(year: number): unknown {
  const currency = "ZMW";
  const monthlyData = MONTHS.map((month, idx) => {
    const income = rand(35000, 0.15);
    const expenses = rand(22000, 0.2);
    const savingsContributions = rand(8000, 0.25);
    const debtPaid = rand(3000, 0.2);
    const netSavings = income - expenses - debtPaid;
    const netWorthChange = rand(15000, 0.3);

    // Use ISO date format for compatibility with MonthlyTrendsWidget's parseLocalDate
    const monthStr = String(idx + 1).padStart(2, "0");
    return {
      month: `${year}-${monthStr}-15`,
      periodStart: `${year}-${monthStr}-01`,
      monthIndex: idx + 1,
      income,
      expenses,
      savingsContributions,
      netSavings,
      savingsRate: (savingsContributions / income) * 100,
      netSavingsRate: (netSavings / income) * 100,
      debtPaid,
      netWorthChange,
    };
  });

  const totals = {
    income: monthlyData.reduce((sum, m) => sum + m.income, 0),
    expenses: monthlyData.reduce((sum, m) => sum + m.expenses, 0),
    savingsContributions: monthlyData.reduce(
      (sum, m) => sum + m.savingsContributions,
      0
    ),
    netSavings: monthlyData.reduce((sum, m) => sum + m.netSavings, 0),
    debtPaid: monthlyData.reduce((sum, m) => sum + m.debtPaid, 0),
    netWorth: 850000 + rand(50000, 0.3),
    savingsRate: 0,
    netSavingsRate: 0,
    totalNetWorthChange: monthlyData.reduce(
      (sum, m) => sum + m.netWorthChange,
      0
    ),
    avgMonthlyNetWorthChange: 0,
  };

  totals.savingsRate = (totals.savingsContributions / totals.income) * 100;
  totals.netSavingsRate = (totals.netSavings / totals.income) * 100;
  totals.avgMonthlyNetWorthChange = totals.totalNetWorthChange / 12;

  const monthly = monthlyData.map((m) => ({
    ...m,
    income: toMoneyDto(m.income, currency),
    expenses: toMoneyDto(m.expenses, currency),
    savingsContributions: toMoneyDto(m.savingsContributions, currency),
    netSavings: toMoneyDto(m.netSavings, currency),
    debtPaid: toMoneyDto(m.debtPaid, currency),
    netWorthChange: toMoneyDto(m.netWorthChange, currency),
  }));

  return {
    year,
    compareYear: year - 1,
    baseCurrency: currency, // Use user's currency
    monthsInRange: 12,
    totals: {
      income: toMoneyDto(totals.income, currency),
      expenses: toMoneyDto(totals.expenses, currency),
      savingsContributions: toMoneyDto(totals.savingsContributions, currency),
      netSavings: toMoneyDto(totals.netSavings, currency),
      debtPaid: toMoneyDto(totals.debtPaid, currency),
      netWorth: toMoneyDto(totals.netWorth, currency),
      savingsRate: totals.savingsRate,
      netSavingsRate: totals.netSavingsRate,
      totalNetWorthChange: toMoneyDto(totals.totalNetWorthChange, currency),
      avgMonthlyNetWorthChange: toMoneyDto(
        totals.avgMonthlyNetWorthChange,
        currency
      ),
    },
    comparison: {
      incomeChangePct: rand(8, 0.5),
      expensesChangePct: rand(-3, 0.5),
      savingsContributionsChangePct: rand(12, 0.5),
      netSavingsChangePct: rand(15, 0.5),
      debtPaidChangePct: rand(5, 0.5),
      netWorthChangePct: rand(18, 0.3),
    },
    monthly,
    cumulativeSeries: [
      {
        id: "Income",
        data: monthlyData.reduce((acc: Array<{ x: string | number; y: ReturnType<typeof toMoneyDto> }>, m, i) => {
          const prev = i > 0 ? Number(acc[i - 1].y.amount) : 0;
          acc.push({
            x: m.month,
            y: toMoneyDto(prev + m.income, currency),
          });
          return acc;
        }, []),
      },
      {
        id: "Expenses",
        data: monthlyData.reduce((acc: Array<{ x: string | number; y: ReturnType<typeof toMoneyDto> }>, m, i) => {
          const prev = i > 0 ? Number(acc[i - 1].y.amount) : 0;
          acc.push({
            x: m.month,
            y: toMoneyDto(prev + m.expenses, currency),
          });
          return acc;
        }, []),
      },
      {
        id: "SavingsContributions",
        data: monthlyData.reduce((acc: Array<{ x: string | number; y: ReturnType<typeof toMoneyDto> }>, m, i) => {
          const prev = i > 0 ? Number(acc[i - 1].y.amount) : 0;
          acc.push({
            x: m.month,
            y: toMoneyDto(prev + m.savingsContributions, currency),
          });
          return acc;
        }, []),
      },
    ],
    breakdown: {
      income: INCOME_SOURCES.map((src) => ({
        ...src,
        value: toMoneyDto(
          rand(totals.income * (src.id === "salary" ? 0.7 : 0.1), 0.2),
          currency
        ),
        entityId: src.id,
      })),
      expenses: CATEGORIES.map((cat) => ({
        ...cat,
        value: toMoneyDto(
          rand(totals.expenses * 0.125, 0.3),
          currency
        ),
        entityId: cat.id,
      })),
      savingsContributions: [
        {
          id: "emergency",
          label: "Emergency Fund",
          value: toMoneyDto(rand(40000, 0.2), currency),
          color: "#10b981",
          entityId: "emergency",
        },
        {
          id: "retirement",
          label: "Retirement",
          value: toMoneyDto(rand(35000, 0.2), currency),
          color: "#3b82f6",
          entityId: "retirement",
        },
        {
          id: "investments",
          label: "Investments",
          value: toMoneyDto(rand(20000, 0.2), currency),
          color: "#8b5cf6",
          entityId: "investments",
        },
      ],
    },
  };
}

// ============================================================================
// MOCK CASHFLOW DATA
// ============================================================================

export function getMockCashflowData(): unknown {
  const currency = "ZMW";
  const series = MONTHS.map((month, idx) => ({
    label: month,
    monthIndex: idx + 1,
    income: toMoneyDto(rand(35000, 0.15), currency),
    expenses: toMoneyDto(rand(22000, 0.2), currency),
    savings: toMoneyDto(rand(8000, 0.25), currency),
    debt: toMoneyDto(rand(3000, 0.2), currency),
  }));

  return {
    baseCurrency: currency,
    totals: {
      income: toMoneyDto(
        series.reduce((sum, m) => sum + Number(m.income.amount), 0),
        currency
      ),
      expenses: toMoneyDto(
        series.reduce((sum, m) => sum + Number(m.expenses.amount), 0),
        currency
      ),
      savings: toMoneyDto(
        series.reduce((sum, m) => sum + Number(m.savings.amount), 0),
        currency
      ),
      debt: toMoneyDto(
        series.reduce((sum, m) => sum + Number(m.debt.amount), 0),
        currency
      ),
    },
    series,
  };
}

// ============================================================================
// MOCK NET WORTH DATA
// ============================================================================

export function getMockNetWorthData(): unknown {
  const currency = "ZMW";
  let assets = 700000;
  let liabilities = 150000;

  const series = [
    {
      id: "Net Worth",
      data: MONTHS.map((month) => {
        assets += rand(12000, 0.3);
        liabilities -= rand(2000, 0.3);
        return { x: month, y: toMoneyDto(assets - liabilities, currency) };
      }),
    },
    {
      id: "Assets",
      data: MONTHS.map((month, idx) => ({
        x: month,
        y: toMoneyDto(700000 + idx * rand(12000, 0.3), currency),
      })),
    },
    {
      id: "Liabilities",
      data: MONTHS.map((month, idx) => ({
        x: month,
        y: toMoneyDto(150000 - idx * rand(2000, 0.3), currency),
      })),
    },
  ];

  return {
    baseCurrency: currency,
    latest: {
      assets: series[1].data[11].y,
      liabilities: series[2].data[11].y,
      netWorth: series[0].data[11].y,
    },
    series,
  };
}

// ============================================================================
// MOCK FINANCIAL RATIOS DATA
// ============================================================================

export function getMockFinancialRatiosData(): unknown {
  const currency = "ZMW";
  const monthlyIncome = rand(35000, 0.15);
  const monthlyExpenses = rand(22000, 0.2);
  const monthlyDebt = rand(6000, 0.2);
  const liquidAssets = rand(180000, 0.15);
  const currentLiabilities = rand(220000, 0.2);
  const savings = Math.max(monthlyIncome - monthlyExpenses, 0);
  const netSavings = Math.max(monthlyIncome - monthlyExpenses - monthlyDebt, 0);

  return {
    baseCurrency: currency,
    ratios: {
      dti: {
        value: 28.5,
        monthlyDebt: toMoneyDto(monthlyDebt, currency),
        monthlyIncome: toMoneyDto(monthlyIncome, currency),
        status: "good",
      },
      emergencyFund: {
        value: 4.2,
        months: 4.2,
        monthlyExpenses: toMoneyDto(monthlyExpenses, currency),
        liquidAssets: toMoneyDto(liquidAssets, currency),
        status: "warning",
      },
      liquidityRatio: {
        value: 1.8,
        liquidAssets: toMoneyDto(liquidAssets, currency),
        currentLiabilities: toMoneyDto(currentLiabilities, currency),
        status: "good",
      },
      burnRate: {
        value: 8.5,
        months: 8.5,
        liquidAssets: toMoneyDto(liquidAssets, currency),
        monthlyExpenses: toMoneyDto(monthlyExpenses, currency),
        status: "good",
      },
      savingsRate: {
        value: 22.5,
        savings: toMoneyDto(savings, currency),
        income: toMoneyDto(monthlyIncome, currency),
      },
      netSavingsRate: {
        value: 18.2,
        netSavings: toMoneyDto(netSavings, currency),
        income: toMoneyDto(monthlyIncome, currency),
      },
    },
  };
}

// ============================================================================
// MOCK EXPENSE CLASSIFICATION DATA
// ============================================================================

export function getMockExpenseClassificationData(): unknown {
  const currency = "ZMW";
  const fixed = rand(120000, 0.1);
  const variable = rand(100000, 0.15);
  const discretionary = rand(45000, 0.2);
  const total = fixed + variable + discretionary;

  return {
    baseCurrency: currency,
    total: toMoneyDto(total, currency),
    classification: {
      fixed: {
        amount: toMoneyDto(fixed, currency),
        percent: Math.round((fixed / total) * 100),
        categories: [
          { name: "Rent/Mortgage", amount: toMoneyDto(rand(60000, 0.1), currency) },
          { name: "Insurance", amount: toMoneyDto(rand(15000, 0.1), currency) },
          { name: "Loan Payments", amount: toMoneyDto(rand(25000, 0.1), currency) },
          { name: "Subscriptions", amount: toMoneyDto(rand(8000, 0.2), currency) },
        ],
      },
      variable: {
        amount: toMoneyDto(variable, currency),
        percent: Math.round((variable / total) * 100),
        categories: [
          { name: "Groceries", amount: toMoneyDto(rand(45000, 0.2), currency) },
          { name: "Transportation", amount: toMoneyDto(rand(25000, 0.2), currency) },
          { name: "Utilities", amount: toMoneyDto(rand(18000, 0.15), currency) },
        ],
      },
      discretionary: {
        amount: toMoneyDto(discretionary, currency),
        percent: Math.round((discretionary / total) * 100),
        categories: [
          { name: "Entertainment", amount: toMoneyDto(rand(20000, 0.3), currency) },
          { name: "Shopping", amount: toMoneyDto(rand(15000, 0.3), currency) },
          { name: "Dining Out", amount: toMoneyDto(rand(10000, 0.3), currency) },
        ],
      },
    },
  };
}

// ============================================================================
// MOCK GOALS PROGRESS DATA
// ============================================================================

export function getMockGoalsProgressData(): unknown {
  const currency = "ZMW";
  return {
    baseCurrency: currency,
    goals: [
      {
        id: "1",
        name: "Emergency Fund",
        type: "save_up",
        targetAmount: toMoneyDto(180000, currency),
        currentAmount: toMoneyDto(135000, currency),
        progress: 75,
        targetDate: "2026-12-31",
        onTrack: true,
        monthlyRequired: toMoneyDto(3750, currency),
      },
      {
        id: "2",
        name: "Vacation Fund",
        type: "save_up",
        targetAmount: toMoneyDto(45000, currency),
        currentAmount: toMoneyDto(38000, currency),
        progress: 84,
        targetDate: "2026-06-30",
        onTrack: true,
        monthlyRequired: toMoneyDto(1400, currency),
      },
      {
        id: "3",
        name: "New Car",
        type: "save_up",
        targetAmount: toMoneyDto(450000, currency),
        currentAmount: toMoneyDto(180000, currency),
        progress: 40,
        targetDate: "2027-12-31",
        onTrack: false,
        monthlyRequired: toMoneyDto(11250, currency),
      },
      {
        id: "4",
        name: "House Down Payment",
        type: "save_up",
        targetAmount: toMoneyDto(750000, currency),
        currentAmount: toMoneyDto(225000, currency),
        progress: 30,
        targetDate: "2028-06-30",
        onTrack: true,
        monthlyRequired: toMoneyDto(17500, currency),
      },
    ],
    summary: {
      totalGoals: 4,
      onTrackCount: 3,
      behindCount: 1,
      completedCount: 0,
    },
  };
}

// ============================================================================
// MOCK FORECAST DATA
// ============================================================================

export function getMockForecastData(): unknown {
  const currentNetWorth = 850000;
  const months = 12;
  const projection = [];

  for (let i = 1; i <= months; i++) {
    const month = new Date(2026, i, 1);
    // Use YYYY-MM format for chart compatibility
    const monthStr = `${month.getFullYear()}-${String(
      month.getMonth() + 1
    ).padStart(2, "0")}`;
    const predicted = currentNetWorth + i * rand(15000, 0.2);
    const variance = rand(5000, 0.3) * i;
    projection.push({
      month: monthStr,
      predicted,
      lowerBound: predicted - variance,
      upperBound: predicted + variance,
    });
  }

  return {
    baseCurrency: "ZMW",
    currentNetWorth,
    projectedNetWorth: projection[11].predicted,
    projectedGrowth:
      ((projection[11].predicted - currentNetWorth) / currentNetWorth) * 100,
    projection,
  };
}

// ============================================================================
// MOCK SPENDING BREAKDOWN DATA
// ============================================================================

export function getMockSpendingBreakdownData(): unknown {
  const currency = "ZMW";
  return {
    baseCurrency: currency,
    items: CATEGORIES.map((cat, idx) => ({
      ...cat,
      value: toMoneyDto(rand(30000 - idx * 2000, 0.3), currency),
      percent: 0,
      entityId: cat.id,
    })),
    total: toMoneyDto(0, currency),
  };
}

// ============================================================================
// MOCK NET WORTH CHANGES DATA
// ============================================================================

export function getMockNetWorthChangesData({ from, to }: CalendarDateRange): ReportsNetWorthChangesResponse {
  const currency = "ZMW";
  const captures: string[] = [];
  const through = new Date(`${to}T00:00:00Z`);
  const month = new Date(`${from}T00:00:00Z`);
  month.setUTCDate(1);
  for (; from <= to && month <= through; month.setUTCMonth(month.getUTCMonth() + 1)) {
    const end = new Date(month);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
    captures.push(end > through ? to : end.toISOString().slice(0, 10));
  }

  let runningNetWorth = 700000;
  const periods = captures.slice(1).map((period, index) => {
    const isNegative = Math.random() < 0.25;
    const change = isNegative ? -rand(8000, 0.5) : rand(18000, 0.4);
    const startNetWorth = runningNetWorth;
    const endNetWorth = runningNetWorth + change;
    runningNetWorth = endNetWorth;
    return {
      period,
      startPeriod: captures[index],
      spansGap: false,
      startNetWorth: toMoneyDto(startNetWorth, currency),
      endNetWorth: toMoneyDto(endNetWorth, currency),
      change: toMoneyDto(change, currency),
      changePct: startNetWorth !== 0 ? (change / startNetWorth) * 100 : 0,
    };
  });

  const totalChange = periods.reduce(
    (sum, p) => sum + Number(p.change.amount),
    0
  );

  return {
    range: { from, to, currency },
    periods,
    totalChange: toMoneyDto(totalChange, currency),
    avgMonthlyChange: periods.length ? toMoneyDto(totalChange / periods.length, currency) : null,
    historyCoverage: "snapshots",
    insufficientHistory: periods.length === 0,
    missingMonths: [],
  };
}

// ============================================================================
// MOCK DEBT ANALYSIS DATA
// ============================================================================

export function getMockDebtAnalysisData(): unknown {
  const currency = "ZMW";
  return {
    baseCurrency: currency,
    totalDebt: toMoneyDto(150000, currency),
    debtPaydown: rand(36000, 0.2),
    debtByType: [
      { type: "Auto Loans", balance: toMoneyDto(rand(85000, 0.1), currency) },
      {
        type: "Credit Cards",
        balance: toMoneyDto(rand(35000, 0.2), currency),
      },
      {
        type: "Student Loans",
        balance: toMoneyDto(rand(30000, 0.15), currency),
      },
    ],
    topDebtAccounts: [
      {
        id: "1",
        name: "Car Loan - First Bank",
        balance: toMoneyDto(rand(85000, 0.1), currency),
      },
      {
        id: "2",
        name: "Visa Platinum",
        balance: toMoneyDto(rand(25000, 0.15), currency),
      },
      {
        id: "3",
        name: "Student Loan",
        balance: toMoneyDto(rand(30000, 0.1), currency),
      },
      {
        id: "4",
        name: "Mastercard Gold",
        balance: toMoneyDto(rand(10000, 0.2), currency),
      },
    ],
    paymentTrend: MONTHS.map((month) => ({
      period: month,
      amount: toMoneyDto(rand(3000, 0.25), currency),
    })),
  };
}

export default {
  USE_MOCK_DATA,
  getMockAnnualData,
  getMockCashflowData,
  getMockNetWorthData,
  getMockFinancialRatiosData,
  getMockExpenseClassificationData,
  getMockGoalsProgressData,
  getMockForecastData,
  getMockSpendingBreakdownData,
  getMockNetWorthChangesData,
  getMockDebtAnalysisData,
};

// ============================================================================
// MOCK SUBCATEGORY BREAKDOWN DATA
// ============================================================================

export function getMockSubcategoryBreakdownData(type?: string): unknown {
  const currency = "ZMW";
  const incomeCategories = [
    {
      id: "salary",
      label: "Salary",
      value: toMoneyDto(rand(290000, 0.1), currency),
      color: "#10b981",
    },
    {
      id: "bonus",
      label: "Bonuses",
      value: toMoneyDto(rand(45000, 0.3), currency),
      color: "#3b82f6",
    },
    {
      id: "freelance",
      label: "Freelance",
      value: toMoneyDto(rand(35000, 0.4), currency),
      color: "#8b5cf6",
    },
    {
      id: "investments",
      label: "Investment Returns",
      value: toMoneyDto(rand(28000, 0.3), currency),
      color: "#f97316",
    },
    {
      id: "rental",
      label: "Rental Income",
      value: toMoneyDto(rand(18000, 0.2), currency),
      color: "#ec4899",
    },
  ];

  const expenseCategories = [
    {
      id: "rent",
      label: "Rent/Mortgage",
      value: toMoneyDto(rand(72000, 0.1), currency),
      color: "#ef4444",
    },
    {
      id: "groceries",
      label: "Groceries",
      value: toMoneyDto(rand(36000, 0.2), currency),
      color: "#f97316",
    },
    {
      id: "transport",
      label: "Transport",
      value: toMoneyDto(rand(24000, 0.25), currency),
      color: "#eab308",
    },
    {
      id: "utilities",
      label: "Utilities",
      value: toMoneyDto(rand(18000, 0.15), currency),
      color: "#22c55e",
    },
    {
      id: "dining",
      label: "Dining Out",
      value: toMoneyDto(rand(15000, 0.3), currency),
      color: "#3b82f6",
    },
    {
      id: "entertainment",
      label: "Entertainment",
      value: toMoneyDto(rand(12000, 0.35), currency),
      color: "#8b5cf6",
    },
    {
      id: "healthcare",
      label: "Healthcare",
      value: toMoneyDto(rand(9000, 0.2), currency),
      color: "#ec4899",
    },
    {
      id: "shopping",
      label: "Shopping",
      value: toMoneyDto(rand(18000, 0.4), currency),
      color: "#06b6d4",
    },
  ];

  const debtCategories = [
    {
      id: "car_loan",
      label: "Car Loan",
      value: toMoneyDto(rand(22000, 0.1), currency),
      color: "#ef4444",
    },
    {
      id: "credit_card",
      label: "Credit Card",
      value: toMoneyDto(rand(8000, 0.3), currency),
      color: "#f97316",
    },
    {
      id: "student_loan",
      label: "Student Loan",
      value: toMoneyDto(rand(6000, 0.15), currency),
      color: "#8b5cf6",
    },
  ];

  const savingsCategories = [
    {
      id: "emergency",
      label: "Emergency Fund",
      value: toMoneyDto(rand(48000, 0.15), currency),
      color: "#10b981",
    },
    {
      id: "retirement",
      label: "Retirement",
      value: toMoneyDto(rand(36000, 0.2), currency),
      color: "#3b82f6",
    },
    {
      id: "investments",
      label: "Investments",
      value: toMoneyDto(rand(12000, 0.25), currency),
      color: "#8b5cf6",
    },
  ];

  let items;
  switch (type) {
    case "income":
      items = incomeCategories;
      break;
    case "debt":
      items = debtCategories;
      break;
    case "savingsContributions":
      items = savingsCategories;
      break;
    default:
      items = expenseCategories;
  }

  const total = items.reduce((sum, i) => sum + Number(i.value.amount), 0);

  return {
    baseCurrency: currency,
    items: items.map((i) => ({
      ...i,
      percent: (Number(i.value.amount) / total) * 100,
      entityId: i.id,
    })),
    total: toMoneyDto(total, currency),
  };
}
