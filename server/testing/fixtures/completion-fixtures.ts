import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { withFixtureClient } from "./fixture-context";

export interface CompletionFixture {
  userId: string;
  householdId: string;
  email: string;
  password: string;
  incomeCategoryId: string;
  expenseCategoryId: string;
}

/** Prerequisites only: the UI must create every account and transaction. */
export async function createCompletionFixture(): Promise<CompletionFixture> {
  return withFixtureClient(async (client, runId) => {
    const suffix = `${runId}-${randomUUID().slice(0, 8)}`;
    const email = `golden-${suffix}@example.invalid`;
    const password = `Synthetic!9-${randomUUID()}`;
    const hash = await bcrypt.hash(password, 12);
    await client.query("BEGIN");
    try {
      const { rows: [user] } = await client.query<{ id: string }>(`INSERT INTO users
        (username, email, password_hash, full_name, display_name, timezone, email_verified)
        VALUES ($1, $2, $3, 'Synthetic Golden A', 'Synthetic Golden A', 'Africa/Lusaka', true) RETURNING id`,
      [`golden-${suffix}`, email, hash]);
      const { rows: [household] } = await client.query<{ id: string }>(
        "INSERT INTO households (name, currency) VALUES ($1, 'ZMW') RETURNING id", [`Golden A ${suffix}`]);
      await client.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')", [household.id, user.id]);
      await client.query("INSERT INTO household_preferences (household_id) VALUES ($1)", [household.id]);
      await client.query("INSERT INTO user_display_settings (user_id) VALUES ($1)", [user.id]);
      const categoryIds: string[] = [];
      for (const [index, type] of ["income", "expenses"].entries()) {
        const { rows: [group] } = await client.query<{ id: string }>(`INSERT INTO category_groups
          (household_id, name, type, display_order) VALUES ($1, $2, $3, $4) RETURNING id`,
        [household.id, `Golden ${type}`, type, index]);
        const { rows: [category] } = await client.query<{ id: string }>(`INSERT INTO categories
          (household_id, group_id, name, display_order) VALUES ($1, $2, $3, 0) RETURNING id`,
        [household.id, group.id, type === "income" ? "Golden Income" : "Golden Expense"]);
        categoryIds.push(category.id);
      }
      await client.query("COMMIT");
      return { userId: user.id, householdId: household.id, email, password,
        incomeCategoryId: categoryIds[0], expenseCategoryId: categoryIds[1] };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
}
