import { randomUUID } from "node:crypto";
import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { loadTestTarget } from "../server/testing/test-target.mjs";

// Bounded observers emit fixed classifications/codes plus owned paths only.
// Never emit messages, stacks, response data, headers or error arguments.
test.beforeEach(async ({ page }) => {
  const origin = loadTestTarget().server?.origin;
  const counts = { asset: 0, page: 0, boundary: 0, api: 0 };
  const names = ["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError", "AggregateError", "ChunkLoadError", "DOMException"];
  const networkCodes = ["net::ERR_ABORTED", "net::ERR_FAILED", "net::ERR_CONNECTION_RESET", "net::ERR_CONNECTION_CLOSED",
    "net::ERR_CONNECTION_REFUSED", "net::ERR_TIMED_OUT", "net::ERR_NETWORK_CHANGED", "net::ERR_NAME_NOT_RESOLVED",
    "net::ERR_INTERNET_DISCONNECTED", "net::ERR_BLOCKED_BY_CLIENT", "net::ERR_EMPTY_RESPONSE", "net::ERR_HTTP_RESPONSE_CODE_FAILURE"];
  const apiCodes = ["VALIDATION_ERROR", "UNAUTHENTICATED", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT",
    "SESSION_CONTEXT_CHANGED", "FINANCIAL_DATA_UNAVAILABLE", "INTERNAL_ERROR", "CSRF_INVALID", "STEP_UP_REQUIRED",
    "EMAIL_VERIFICATION_REQUIRED", "HOUSEHOLD_NOT_FOUND", "RATE_LIMITED", "TOO_MANY_REQUESTS"];
  const category = (raw: string) => /dynamically imported module|loading chunk|ChunkLoadError|module script/i.test(raw) ? "lazy-module-load"
    : /ERR_CONNECTION_RESET|ECONNRESET|socket hang up/i.test(raw) ? "connection-reset"
    : /ReferenceError|is not defined/i.test(raw) ? "missing-reference"
    : /TypeError|cannot read properties|is not a function/i.test(raw) ? "render-type-error"
    : /SyntaxError|unexpected token/i.test(raw) ? "module-or-render-syntax" : "unknown-error";
  const emit = (kind: keyof typeof counts, fields: Record<string, unknown>) => {
    if (counts[kind]++ < 8) console.error("R13_BROWSER_DIAGNOSTIC", JSON.stringify({ kind, ...fields }));
  };
  page.on("requestfailed", request => {
    const url = new URL(request.url());
    if (url.origin !== origin || !/^\/(?:assets|src|@fs|@vite|@id|node_modules)\//.test(url.pathname) ||
      !["script", "stylesheet", "font", "image"].includes(request.resourceType())) return;
    const code = request.failure()?.errorText.match(/\bnet::ERR_[A-Z0-9_]+\b/)?.[0];
    emit("asset", { path: url.pathname.slice(0, 220), code: code && networkCodes.includes(code) ? code : "UNKNOWN_NETWORK_ERROR" });
  });
  page.on("pageerror", error => emit("page", {
    name: names.includes(error.name) ? error.name : "UnknownError",
    reason: category(error.name + " " + error.message),
  }));
  page.on("console", message => {
    if (message.type() !== "error" || !/^Route error in /.test(message.text())) return;
    const raw = message.text();
    const type = raw.match(/\b(ChunkLoadError|TypeError|ReferenceError|SyntaxError|RangeError|Error)\b/)?.[1] || "UnknownError";
    emit("boundary", { type, reason: category(raw) });
  });
  page.on("response", async response => {
    const url = new URL(response.url());
    if (url.origin !== origin || response.status() < 400 ||
      !/^\/api\/investments\/(?:holdings|portfolio)(?:\/|$)/.test(url.pathname) || counts.api >= 8) return;
    ++counts.api;
    let code = "UNKNOWN_API_ERROR";
    try {
      const body = await response.json() as { error?: { code?: unknown } };
      if (typeof body?.error?.code === "string" && apiCodes.includes(body.error.code)) code = body.error.code;
    } catch { /* Body may be unavailable after a transport reset; retain status. */ }
    console.error("R13_BROWSER_DIAGNOSTIC", JSON.stringify({ kind: "api", path: url.pathname.slice(0, 220), status: response.status(), code }));
  });
});


test("recovers a committed opening through the other page control after losing its acknowledgement", async ({ page }) => {
  const fixture = await createCompletionFixture(), securityId = randomUUID();
  const securityName = "Synthetic exact opening " + securityId.slice(0, 8), date = "2026-01-20";
  const ownedOrigin = loadTestTarget().server?.origin;
  if (!ownedOrigin) throw new Error("Opening journey requires the marked owned browser origin");
  await withFixtureClient(async client => {
    await client.query("insert into securities(id,symbol,name,type,currency,current_price) values($1,$2,$3,'stock','ZMW',0.1)",
      [securityId, "O" + securityId.slice(0, 8), securityName]);
    // Synthetic rates only, inside the marked disposable target. No provider is contacted.
    await client.query("insert into fx_rates(from_currency,to_currency,rate,date,source) values('ZMW','USD',0.05,current_date,'synthetic_browser_opening')");
    await client.query(`insert into provider_fx_quotes(from_currency,to_currency,provider,quoted_at,effective_date,valid_through,rate)
      values('ZMW','USD','exchangerate_api',now(),(now() at time zone 'UTC')::date,(now() at time zone 'UTC')::date,0.05)`);
  });
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/accounts");
  await page.getByRole("button", { name: /add account/i }).click();
  const accountDialog = page.getByRole("dialog");
  await accountDialog.getByRole("button", { name: /^Investment BOZ Bonds, Stocks$/ }).click();
  await accountDialog.getByLabel("Account Name", { exact: true }).fill("Opening custody");
  await accountDialog.locator("#balance").fill("125");
  const [accountResponse] = await Promise.all([
    page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/accounts"),
    accountDialog.getByRole("button", { name: "Save Account", exact: true }).click(),
  ]);
  expect(accountResponse.status()).toBe(201);
  const accountId = (await accountResponse.json()).data.id;
  await page.goto("/investments");
  await expect(page.getByRole("heading", { name: "No Holdings Yet" })).toBeVisible();

  const dialog = page.getByRole("dialog");
  async function enterOpening() {
    await dialog.getByPlaceholder(/Search securities/).fill(securityName);
    await dialog.getByRole("button").filter({ hasText: securityName }).click();
    await dialog.getByLabel("Quantity", { exact: false }).fill("3");
    await dialog.getByLabel("Purchase Price (ZMW)", { exact: false }).fill("0.10");
    await dialog.getByLabel("Purchase Date", { exact: true }).fill(date);
    await expect(dialog.getByText("Total Cost (ZMW)", { exact: true })).toBeVisible();
  }

  let originalRequest: Record<string, unknown> | undefined;
  let originalHolding: Record<string, unknown> | undefined;
  let lost = false;
  await page.route(url => url.origin === ownedOrigin && url.pathname === "/api/investments/holdings", async route => {
    if (route.request().method() !== "POST" || lost) return route.fallback();
    let response;
    try { response = await route.fetch({ maxRedirects: 0 }); }
    catch { return route.abort("blockedbyclient"); }
    if ([301, 302, 303, 307, 308].includes(response.status())) return route.abort("blockedbyclient");
    if (response.status() !== 201) return route.fulfill({ response });
    // Execute the real signed handler first; discard only its successful acknowledgement.
    originalRequest = route.request().postDataJSON();
    originalHolding = (await response.json()).data;
    lost = true;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Add Your First Holding", exact: true }).click();
  await enterOpening();
  await dialog.getByRole("button", { name: "Add Holding", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry same opening", exact: true })).toBeVisible();
  expect(lost).toBe(true);
  expect(originalRequest).toMatchObject({ accountId, securityId, quantity: "3", costBasis: "0.30", acquiredDate: date, expectedCurrency: "ZMW",
    operationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) });
  expect(originalHolding).toMatchObject({ quantity: "3.00000000", costBasis: "0.30" });

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  const refreshed = page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/investments/holdings"
    && new URL(r.url()).searchParams.get("baseCurrency") === "USD");
  await page.getByRole("button", { name: "USD", exact: true }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByRole("row").filter({ hasText: securityName })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Add Your First Holding", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add Holding", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Retry same opening", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Quantity", { exact: false })).toHaveValue("3");
  await expect(dialog.getByLabel("Quantity", { exact: false })).toBeDisabled();
  await expect(dialog.getByLabel("Purchase Price (ZMW)", { exact: false })).toHaveValue("0.10");
  await expect(dialog.getByLabel("Purchase Date", { exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
  const [replay] = await Promise.all([
    page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/investments/holdings"),
    dialog.getByRole("button", { name: "Retry same opening", exact: true }).click(),
  ]);
  expect(replay.status()).toBe(201);
  expect(replay.request().postDataJSON()).toEqual(originalRequest);
  expect((await replay.json()).data).toEqual(originalHolding);
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: securityName })).toHaveCount(1);

  const persisted = await withFixtureClient(async client => {
    const receipt = (await client.query(`select operation_id,request_version,request_digest,currency,holding_id,creation_snapshot
      from investment_opening_operation_receipts where household_id=$1 and actor_user_id=$2`, [fixture.householdId, fixture.userId])).rows;
    const state = (await client.query(`select a.balance::text,
      (select count(*)::int from transactions t where t.account_id=a.id) as cash,
      (select count(*)::int from accounts c where c.household_id=a.household_id) as accounts
      from accounts a where a.id=$1 and a.household_id=$2`, [accountId, fixture.householdId])).rows;
    const positions = (await client.query("select id,quantity::text,cost_basis::text,account_id,security_id from holdings where household_id=$1", [fixture.householdId])).rows;
    const purchases = (await client.query("select id,type,holding_id,account_id,security_id,quantity::text,amount::text,price::text from investment_transactions where household_id=$1", [fixture.householdId])).rows;
    const lots = (await client.query("select id,holding_id,transaction_id,quantity::text,remaining_quantity::text,cost_basis::text from tax_lots where household_id=$1", [fixture.householdId])).rows;
    const audits = (await client.query(`select entity_type,entity_id,action,household_id from audit_logs
      where user_id=$1 and entity_type in ('holding','investment_transaction') order by entity_type`, [fixture.userId])).rows;
    return { receipt, state, positions, purchases, lots, audits };
  });
  expect(persisted.state).toEqual([{ balance: "125.00", cash: 0, accounts: 1 }]);
  expect(persisted.positions).toEqual([{ id: originalHolding!.id, quantity: "3.00000000", cost_basis: "0.30", account_id: accountId, security_id: securityId }]);
  expect(persisted.purchases).toHaveLength(1);
  expect(persisted.purchases[0]).toEqual({ id: expect.any(String), type: "buy", holding_id: originalHolding!.id,
    account_id: accountId, security_id: securityId, quantity: "3.00000000", amount: "0.30", price: null });
  expect(persisted.lots).toEqual([{ id: expect.any(String), holding_id: originalHolding!.id, transaction_id: persisted.purchases[0].id,
    quantity: "3.00000000", remaining_quantity: "3.00000000", cost_basis: "0.30" }]);
  expect(persisted.audits).toEqual([{ entity_type: "holding", entity_id: originalHolding!.id, action: "CREATE", household_id: null },
    { entity_type: "investment_transaction", entity_id: persisted.purchases[0].id, action: "CREATE", household_id: null }]);
  expect(persisted.receipt).toHaveLength(1);
  expect(persisted.receipt[0]).toMatchObject({ operation_id: originalRequest!.operationId, request_version: 1, currency: "ZMW",
    request_digest: expect.stringMatching(/^[0-9a-f]{64}$/), holding_id: originalHolding!.id });
  expect(persisted.receipt[0].creation_snapshot.holding).toEqual(originalHolding);
  expect(persisted.receipt[0].creation_snapshot.purchaseId).toBe(persisted.purchases[0].id);
  expect(persisted.receipt[0].creation_snapshot.lotId).toBe(persisted.lots[0].id);
});
