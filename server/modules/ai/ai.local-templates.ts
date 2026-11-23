/**
 * Local degraded-mode templates (R17.1, AI-04).
 *
 * Renders a limited, clearly labelled summary from ALREADY-SANITISED tool
 * results, with no model involved. Amounts are the sanitiser's decimal strings
 * printed as-is: there is no arithmetic here, so nothing can be invented or
 * rounded. A result shape with no template renders nothing, and when nothing
 * renders the caller reports "unavailable" instead of a success-shaped reply.
 *
 * @module ai/ai.local-templates
 */

type Row = Record<string, unknown>;

const MAX_ROWS = 5;

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Row => entry !== null && typeof entry === "object").slice(0, MAX_ROWS)
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function money(currency: string, value: unknown): string {
  const amount = text(value);
  return amount ? `${currency} ${amount}` : "unavailable";
}

function section(title: string, lines: string[]): string | null {
  return lines.length > 0 ? `${title}\n${lines.map((line) => `- ${line}`).join("\n")}` : null;
}

type Renderer = (data: Row, currency: string) => string | null;

const RENDERERS: readonly Renderer[] = [
  (data, cur) => {
    const list = rows(data.categories);
    const body = section(
      data.rankingAvailability === "unavailable" ? "Spending by category (ranking unavailable):" : "Top spending categories:",
      list.map((row) => `${text(row.name)}: ${money(cur, row.amount)} (${text(row.count)} transactions)`),
    );
    return body && data.total !== undefined ? `${body}\nTotal: ${money(cur, data.total)}` : body;
  },
  (data, cur) =>
    section(
      "Your goals:",
      rows(data.goals).map((goal) => {
        const target = goal.targetAmount === null || goal.targetAmount === undefined ? "" : `target ${money(cur, goal.targetAmount)} `;
        return goal.progressAvailability === "unavailable" || goal.currentAmount === null
          ? `${text(goal.name)}: ${target}(progress unavailable)`
          : `${text(goal.name)}: ${text(goal.progressPercent)}% complete (${money(cur, goal.currentAmount)} of ${money(cur, goal.targetAmount)})`;
      }),
    ),
  (data, cur) =>
    section(
      "Recent transactions:",
      rows(data.transactions).map((txn) => `${text(txn.date)}: ${text(txn.description)} - ${money(cur, txn.amount)}`),
    ),
  (data, cur) =>
    section(
      "Upcoming recurring payments:",
      rows(data.recurring).map(
        (item) => `${text(item.nextDate)}: ${text(item.description)} - ${money(cur, item.amount)} (${text(item.frequency)})`,
      ),
    ),
  (data, cur) =>
    section(
      "Budgets this period:",
      rows(data.budgets).map(
        (budget) =>
          `${text(budget.categoryName)}: spent ${money(cur, budget.spent)} of ${money(cur, budget.budgeted)} (${text(budget.percentUsed)}% used)`,
      ),
    ),
  (data, cur) =>
    section(
      data.rankingAvailability === "unavailable" ? "Merchant spending (ranking unavailable):" : "Top merchants:",
      rows(data.merchants).map(
        (merchant) => `${text(merchant.name)}: ${money(cur, merchant.totalSpent)} (${text(merchant.transactionCount)} transactions)`,
      ),
    ),
  (data, cur) =>
    section(
      "Account balances:",
      // Astra A-07: each balance in its account's own currency.
      rows(data.accounts).map((account) => `${text(account.name)} (${text(account.type)}): ${money(text(account.currency) || cur, account.balance)}`),
    ),
  (data) =>
    section(
      "Category trends:",
      rows(data.trends).map((trend) => `${text(trend.categoryName)}: ${text(trend.trendDirection)}`),
    ),
  (data, cur) =>
    typeof data.month === "string" && data.income !== undefined && data.expenses !== undefined
      ? `Summary for ${data.month}:\n- Income: ${money(cur, data.income)}\n- Expenses: ${money(cur, data.expenses)}\n- Net savings: ${money(cur, data.netSavings)}`
      : null,
  (data, cur) =>
    section(
      "Goal funding sources:",
      rows(data.assignments).map(
        (item) =>
          // A withheld goal carries accountName null too; that is not "unlinked" (Astra r2).
          item.progressAvailability === "unavailable"
            ? `${text(item.goalName)}: funding information is unavailable`
            : `${text(item.goalName)}: ${text(item.accountName) || "no linked account"} (current ${money(cur, item.current)})`,
      ),
    ),
  (data, cur) =>
    section(
      "Projected cash flow:",
      // Amounts with missing conversion evidence are null and read "unavailable".
      rows(data.projections).map(
        (point) => `${text(point.month)}: in ${money(cur, point.inflow)}, out ${money(cur, point.outflow)}, net ${money(cur, point.net)}, balance ${money(cur, point.projectedEndingBalance)}`,
      ),
    ),
];

export const LOCAL_SUMMARY_PREFIX = "Limited local summary (no AI provider was used):";
/** After a dispatched provider call: honest without denying the transmission (P2-3). */
export const LOCAL_SUMMARY_AFTER_ATTEMPT_PREFIX =
  "Limited local summary (the AI provider could not answer, so this was prepared locally):";

export function localSummaryPrefix(providerAttempted: boolean): string {
  return providerAttempted ? LOCAL_SUMMARY_AFTER_ATTEMPT_PREFIX : LOCAL_SUMMARY_PREFIX;
}

/**
 * Render every recognised section of the sanitised results. Returns null when
 * nothing could be rendered, so the caller can answer "unavailable" honestly.
 * `providerAttempted` picks the prefix from the recorded attempts (P2-3).
 */
export function renderLocalSummary(
  sanitisedResults: readonly unknown[],
  currency: string,
  providerAttempted = false,
): string | null {
  const sections: string[] = [];
  for (const result of sanitisedResults) {
    if (result === null || typeof result !== "object") continue;
    for (const render of RENDERERS) {
      const rendered = render(result as Row, currency);
      if (rendered) sections.push(rendered);
    }
  }
  return sections.length > 0 ? `${localSummaryPrefix(providerAttempted)}\n\n${sections.join("\n\n")}` : null;
}
