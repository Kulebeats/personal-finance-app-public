/**
 * FollowUpChips — after an answer, two or three tappable next questions that
 * fit the data the answer drew on, so the conversation carries on in one tap.
 * Every question maps to a shipped analytics tool.
 */
import { Button } from "@/components/ui/button";

const MAX_FOLLOW_UPS = 3;

const FOLLOW_UPS_BY_TOOL: Record<string, readonly string[]> = {
  get_account_balances: ["Where did my money go this month?", "How is my cash flow looking?"],
  get_spending_by_category: ["How does this compare with last month?", "Which merchants do I spend most at?"],
  get_category_trends: ["What are my top spending categories?", "How is my budget this month?"],
  get_merchant_spending: ["Show my recent transactions", "What are my top spending categories?"],
  get_recent_transactions: ["What are my top spending categories?", "What bills are coming up?"],
  get_transaction_search: ["What are my top spending categories?", "Show my recent transactions"],
  get_budget_status: ["Which categories am I overspending in?", "What bills are coming up?"],
  get_upcoming_recurring: ["What are my account balances?", "How is my budget this month?"],
  get_goals_status: ["Which accounts fund my goals?", "How is my cash flow looking?"],
  get_goal_assignments: ["How are my savings goals doing?", "What are my account balances?"],
  get_cash_flow: ["What are my top spending categories?", "How are my savings goals doing?"],
  get_monthly_summary: ["How does this compare with last month?", "How is my budget this month?"],
};

const GENERAL_FOLLOW_UPS = ["What are my account balances?", "How is my budget this month?", "What bills are coming up?"];

/** Up to three distinct next questions for an answer that used `tools`. */
export function followUpsFor(tools: readonly string[]): string[] {
  const fitted = tools.flatMap((tool) => FOLLOW_UPS_BY_TOOL[tool] ?? []);
  const candidates = fitted.length > 0 ? [...fitted, ...GENERAL_FOLLOW_UPS] : GENERAL_FOLLOW_UPS;
  return [...new Set(candidates)].slice(0, MAX_FOLLOW_UPS);
}

interface FollowUpChipsProps {
  tools: readonly string[];
  onSelect: (question: string) => void;
  disabled: boolean;
}

export function FollowUpChips({ tools, onSelect, disabled }: FollowUpChipsProps) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Suggested follow-up questions">
      {followUpsFor(tools).map((question) => (
        <Button
          key={question}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(question)}
          className="rounded-full"
        >
          {question}
        </Button>
      ))}
    </div>
  );
}
