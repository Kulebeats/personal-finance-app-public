import { randomUUID } from "node:crypto";
import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";

test("books fee-inclusive fractional trades from the holding dialog and reads back the FIFO gain", async ({ page }) => {
  const fixture = await createCompletionFixture();
  const account = randomUUID(), security = randomUUID(), holding = randomUUID();
  await withFixtureClient(async client => {
    await client.query("insert into accounts(id,household_id,name,type,currency) values($1,$2,'Trade custody','checking','ZMW')", [account, fixture.householdId]);
    await client.query("insert into securities(id,symbol,name,type,currency,current_price) values($1,$2,'Fractional fee fixture','stock','ZMW',0.6667)", [security, "T" + security.slice(0, 8)]);
    await client.query("insert into holdings(id,household_id,security_id,account_id,quantity) values($1,$2,$3,$4,0)", [holding, fixture.householdId, security, account]);
  });
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  for (const type of ["Buy", "Sell"] as const) {
    await page.goto("/investments");
    const row = page.getByRole("row").filter({ hasText: "Fractional fee fixture" });
    await row.hover();
    await row.getByRole("button", { name: "Record", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: type, exact: true }).click();
    await dialog.getByLabel("Quantity").fill("1.5");
    await dialog.getByLabel("Price per Share").fill("0.6667");
    const fee = dialog.getByLabel("Trade fee"), save = dialog.getByRole("button", { name: "Record " + type });
    await fee.fill("1e");
    await expect(fee).toHaveValue("1e");
    await expect(save).toBeDisabled();
    await fee.fill("0.01");
    const posted = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/investments/transactions");
    await save.click();
    expect((await posted).status()).toBe(201);
    await expect(dialog).toBeHidden();
  }
  await page.reload();
  const rows = await withFixtureClient(async client => (await client.query(`
    select h.quantity, l.remaining_quantity, l.cost_basis as bought, b.price, b.fees as buy_fee,
      s.fees as sell_fee, d.proceeds, d.realized_gain from holdings h
    join tax_lots l on l.holding_id=h.id join investment_transactions b on b.id=l.transaction_id
    join tax_lot_disposals d on d.tax_lot_id=l.id join investment_transactions s on s.id=d.transaction_id
    where h.id=$1 and h.household_id=$2`, [holding, fixture.householdId])).rows);
  expect(rows).toEqual([{ quantity: "0.00000000", remaining_quantity: "0.00000000", bought: "1.01", price: "0.6667",
    buy_fee: "0.01", sell_fee: "0.01", proceeds: "0.99", realized_gain: "-0.02" }]);
});
