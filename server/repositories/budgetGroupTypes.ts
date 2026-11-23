import { sql } from "drizzle-orm";

// The category-group types the budget readers count (#343, R5-04). A group
// may be typed 'expense' or 'expenses' (both allowed by categories.validation);
// progress, spend, the historical preview and confirmed apply read the same set.
export const BUDGET_GROUP_TYPES = sql.raw("('expense','expenses','income')");
