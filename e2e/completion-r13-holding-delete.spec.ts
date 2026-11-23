import { createHash, randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
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


const openingDate = "2026-01-20";
async function startJourney(page: Page, label: string) {
  const fixture = await createCompletionFixture(), securityId = randomUUID();
  const symbol = "D" + securityId.slice(0, 8), securityName = label + " " + securityId.slice(0, 8);
  const ownedOrigin = loadTestTarget().server?.origin;
  if (!ownedOrigin) throw new Error("Holding removal journey requires the marked owned browser origin");
  await withFixtureClient(async client => {
    await client.query("insert into securities(id,symbol,name,type,currency,current_price) values($1,$2,$3,'stock','ZMW',1)",
      [securityId, symbol, securityName]);
    // Synthetic prerequisites inside the marked disposable target; no provider request.
    await client.query("insert into fx_rates(from_currency,to_currency,rate,date,source) values('ZMW','USD',0.05,current_date,'synthetic_browser_holding_delete')");
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
  await accountDialog.getByLabel("Account Name", { exact: true }).fill(label + " custody");
  await accountDialog.locator("#balance").fill("125");
  const [accountResponse] = await Promise.all([
    page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/accounts"),
    accountDialog.getByRole("button", { name: "Save Account", exact: true }).click(),
  ]);
  expect(accountResponse.status()).toBe(201);
  const accountId: string = (await accountResponse.json()).data.id;
  await page.goto("/investments");
  await expect(page.getByRole("heading", { name: "No Holdings Yet" })).toBeVisible();
  return { fixture, securityId, symbol, securityName, accountId, ownedOrigin };
}

async function openHolding(page: Page, source: Awaited<ReturnType<typeof startJourney>>, quantity: "0" | "3") {
  await page.getByRole("button", { name: "Add Your First Holding", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(/Search securities/).fill(source.securityName);
  await dialog.getByRole("button").filter({ hasText: source.securityName }).click();
  await dialog.getByLabel("Quantity", { exact: false }).fill(quantity);
  await dialog.getByLabel("Purchase Price (ZMW)", { exact: false }).fill(quantity === "0" ? "0" : "1");
  await dialog.getByLabel("Purchase Date", { exact: true }).fill(openingDate);
  const [response] = await Promise.all([
    page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/investments/holdings"),
    dialog.getByRole("button", { name: "Add Holding", exact: true }).click(),
  ]);
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({ accountId: source.accountId, securityId: source.securityId,
    expectedCurrency: "ZMW", quantity, costBasis: quantity === "0" ? "0.00" : "3.00", acquiredDate: openingDate });
  const holding: { id: string; quantity: string; costBasis: string } = (await response.json()).data;
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: source.securityName })).toHaveCount(1);
  return holding;
}

async function persistedState(fixture: CompletionFixture, holdingId: string, knownTransactionIds: readonly string[] = []) {
  return withFixtureClient(async client => {
    const home = [fixture.householdId];
    const accounts = (await client.query("select * from accounts where household_id=$1 order by id", home)).rows;
    const holdings = (await client.query("select * from holdings where household_id=$1 order by id", home)).rows;
    const activity = (await client.query("select * from investment_transactions where household_id=$1 order by id", home)).rows;
    const lots = (await client.query("select * from tax_lots where household_id=$1 order by id", home)).rows;
    const disposals = (await client.query("select * from tax_lot_disposals where household_id=$1 order by id", home)).rows;
    const cash = (await client.query("select * from transactions where household_id=$1 order by id", home)).rows;
    const openings = (await client.query(`select * from investment_opening_operation_receipts
      where household_id=$1 order by operation_id`, home)).rows;
    const receipts = (await client.query(`select * from investment_holding_deletion_receipts
      where household_id=$1 order by holding_id`, home)).rows;
    // Preserve the original activity identities even if a regression destroys a
    // row. Audience and actor filters must not hide damaged or extra evidence.
    const transactionIds = Array.from(new Set(knownTransactionIds.concat(activity.filter(row => row.holding_id === holdingId).map(row => row.id))));
    const audits = (await client.query(`select * from audit_logs
      where (entity_type='holding' and entity_id=$1)
        or (entity_type='investment_transaction' and entity_id=any($2::uuid[])) order by id`, [holdingId, transactionIds])).rows;
    const deleteAudits = audits.filter(row => row.entity_type === "holding" && row.action === "DELETE");
    return { accounts, holdings, activity, lots, disposals, cash, openings, receipts, audits, deleteAudits };
  });
}

test("recovers the same holding removal after a real committed204 acknowledgement is lost and the last row disappears", async ({ page }) => {
  const source = await startJourney(page, "Synthetic removable shell"), holding = await openHolding(page, source, "0");
  expect(holding).toMatchObject({ quantity: "0.00000000", costBasis: "0.00" });
  const before = await persistedState(source.fixture, holding.id);
  expect(before.accounts).toMatchObject([{ id: source.accountId, balance: "125.00" }]);
  expect(before.holdings).toMatchObject([{ id: holding.id, quantity: "0.00000000" }]);
  for (const key of ["activity", "lots", "disposals", "cash", "receipts", "deleteAudits"] as const) expect(before[key]).toEqual([]);
  expect(before.openings).toHaveLength(1);
  expect(before.openings[0]).toMatchObject({ household_id: source.fixture.householdId, actor_user_id: source.fixture.userId, holding_id: holding.id });
  expect(before.openings[0].creation_snapshot).toMatchObject({ purchaseId: null, lotId: null, holding: { id: holding.id } });
  expect(before.audits).toHaveLength(1);
  expect(before.audits[0]).toMatchObject({ entity_type: "holding", entity_id: holding.id, action: "CREATE" });

  const path = `/api/investments/holdings/${holding.id}`;
  const requests: Array<{ path: string; body: string | null }> = [];
  const acknowledgements: Array<{ status: number; bytes: number }> = [];
  let hiddenAcknowledgement: { status: number; bytes: number } | undefined;
  await page.route(url => url.origin === source.ownedOrigin && url.pathname === path, async route => {
    if (route.request().method() !== "DELETE") return route.fallback();
    const requested = new URL(route.request().url());
    requests.push({ path: requested.pathname + requested.search, body: route.request().postData() });
    let response;
    try { response = await route.fetch({ maxRedirects: 0 }); }
    catch { return route.abort("blockedbyclient"); }
    if ([301, 302, 303, 307, 308].includes(response.status())) return route.abort("blockedbyclient");
    if (response.status() === 204) {
      // APIResponse retains both handler bodies; Chromium may expose no CDP
      // response-body resource for an otherwise successful browser204.
      const acknowledgement = { status: response.status(), bytes: (await response.body()).length };
      acknowledgements.push(acknowledgement);
      if (!hiddenAcknowledgement) {
        // The real signed handler committed; hide only its first acknowledgement.
        hiddenAcknowledgement = acknowledgement;
        return route.abort("failed");
      }
    }
    return route.fulfill({ response });
  });
  await page.getByRole("button", { name: `Review removal of ${source.symbol}`, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/server will check/i)).toBeVisible();
  await dialog.getByRole("button", { name: "Remove holding", exact: true }).click();
  await expect(dialog.getByText("Removal was not confirmed. Retry the same holding.", { exact: true })).toBeVisible();
  expect(hiddenAcknowledgement).toEqual({ status: 204, bytes: 0 });
  await expect(page.getByText("Holding Removed", { exact: true })).toHaveCount(0);

  const committed = await persistedState(source.fixture, holding.id);
  expect(committed.holdings).toEqual([]);
  for (const key of ["accounts", "activity", "lots", "disposals", "cash", "openings"] as const) expect(committed[key]).toEqual(before[key]);
  expect(committed.receipts).toHaveLength(1); expect(committed.deleteAudits).toHaveLength(1);
  expect(committed.audits).toHaveLength(before.audits.length + 1);
  expect(committed.audits.filter(audit => audit.id !== committed.deleteAudits[0].id)).toEqual(before.audits);
  const requestDigest = createHash("sha256").update(JSON.stringify({ version: 1, householdId: source.fixture.householdId,
    actorUserId: source.fixture.userId, verb: "DELETE", holdingId: holding.id.toLowerCase() })).digest("hex");
  expect(committed.receipts[0]).toMatchObject({ household_id: source.fixture.householdId, actor_user_id: source.fixture.userId,
    holding_id: holding.id, account_id: source.accountId, security_id: source.securityId, request_version: 1,
    request_digest: requestDigest, effect_digest: expect.stringMatching(/^[0-9a-f]{64}$/), delete_audit_id: committed.deleteAudits[0].id });
  expect(committed.deleteAudits[0]).toMatchObject({ user_id: source.fixture.userId, household_id: null,
    entity_type: "holding", entity_id: holding.id, action: "DELETE",
    details: { oldValue: { accountId: source.accountId, securityId: source.securityId, quantity: "0.00000000", costBasis: "0.00" } } });

  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  const [refreshed] = await Promise.all([
    page.waitForResponse(r => r.request().method() === "GET" && new URL(r.url()).pathname === "/api/investments/holdings"),
    page.getByRole("button", { name: "USD", exact: true }).click(),
  ]);
  expect(refreshed.status()).toBe(200); expect((await refreshed.json()).data).toEqual([]);
  await expect(page.getByRole("heading", { name: "No Holdings Yet" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: source.securityName })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Holding", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Your First Holding", exact: true })).toBeVisible();
  const recover = page.getByRole("button", { name: "Review removal", exact: true });
  await recover.click();
  await expect(dialog.getByText(`Review removal of ${source.symbol}.`, { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retry removal", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await recover.click();
  const [replay] = await Promise.all([
    page.waitForResponse(r => r.request().method() === "DELETE" && new URL(r.url()).pathname === path),
    dialog.getByRole("button", { name: "Retry removal", exact: true }).click(),
  ]);
  expect(replay.status()).toBe(204);
  expect(acknowledgements).toEqual([{ status: 204, bytes: 0 }, { status: 204, bytes: 0 }]);
  expect(requests).toEqual([{ path, body: null }, { path, body: null }]);
  await expect(dialog).toBeHidden(); await expect(recover).toHaveCount(0);
  await expect(page.getByText("Holding Removed", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "No Holdings Yet" })).toBeVisible();
  expect(await persistedState(source.fixture, holding.id)).toEqual(committed);
});

test("refuses removal of a genuinely fully sold holding and retains its booked financial history", async ({ page }) => {
  const source = await startJourney(page, "Synthetic sold history"), holding = await openHolding(page, source, "3");
  const row = page.getByRole("row").filter({ hasText: source.securityName });
  await expect(row.getByRole("button", { name: /Review removal/ })).toHaveCount(0);
  await row.getByRole("button", { name: "Record", exact: true }).click();
  const trade = page.getByRole("dialog");
  await trade.getByRole("button", { name: "Sell", exact: true }).click();
  await trade.getByLabel("Quantity", { exact: true }).fill("3");
  await trade.getByLabel("Price per Share", { exact: true }).fill("1");
  await trade.getByLabel("Trade fee", { exact: true }).fill("0");
  await trade.getByLabel("Transaction Date", { exact: true }).fill("2026-01-21");
  const [sale] = await Promise.all([
    page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/investments/transactions"),
    trade.getByRole("button", { name: "Record Sell", exact: true }).click(),
  ]);
  expect(sale.status()).toBe(201); await expect(trade).toBeHidden();
  await page.reload();
  const review = page.getByRole("button", { name: `Review removal of ${source.symbol}`, exact: true });
  await expect(review).toBeVisible();
  const before = await persistedState(source.fixture, holding.id);
  const transactionIds = before.activity.map(row => row.id as string);
  expect(before.accounts).toMatchObject([{ id: source.accountId, balance: "125.00" }]);
  expect(before.holdings).toMatchObject([{ id: holding.id, quantity: "0.00000000" }]);
  expect(before.activity).toHaveLength(2);
  expect(before.activity.map(item => item.type).sort()).toEqual(["buy", "sell"]);
  expect(before.lots).toMatchObject([{ holding_id: holding.id, quantity: "3.00000000", remaining_quantity: "0.00000000", cost_basis: "3.00" }]);
  expect(before.disposals).toMatchObject([{ holding_id: holding.id, quantity: "3.00000000", proceeds: "3.00", cost_basis: "3.00", realized_gain: "0.00" }]);
  expect(before.cash).toEqual([]); expect(before.receipts).toEqual([]); expect(before.deleteAudits).toEqual([]);
  expect(before.openings).toHaveLength(1);
  expect(before.openings[0]).toMatchObject({ household_id: source.fixture.householdId, actor_user_id: source.fixture.userId, holding_id: holding.id });
  expect(before.audits).toHaveLength(3);
  expect(before.audits).toEqual(expect.arrayContaining([
    expect.objectContaining({ entity_type: "holding", entity_id: holding.id, action: "CREATE" }),
    ...transactionIds.map(id => expect.objectContaining({ entity_type: "investment_transaction", entity_id: id, action: "CREATE" })),
  ]));
  await review.click();
  const dialog = page.getByRole("alertdialog");
  const [refusal] = await Promise.all([
    page.waitForResponse(r => r.request().method() === "DELETE" && new URL(r.url()).pathname === `/api/investments/holdings/${holding.id}`),
    dialog.getByRole("button", { name: "Remove holding", exact: true }).click(),
  ]);
  expect(refusal.status()).toBe(409);
  const refused = await refusal.json();
  expect(refused).toMatchObject({ success: false, error: { code: "CONFLICT", message: expect.stringMatching(/history|disposal|correction|review/i) } });
  expect(refused).not.toHaveProperty("data");
  await expect(dialog.getByText(refused.error.message, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Retry removal", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Remove holding", exact: true })).toHaveCount(0);
  await expect(page.getByText("Holding Removed", { exact: true })).toHaveCount(0);
  expect(await persistedState(source.fixture, holding.id, transactionIds)).toEqual(before);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload(); await expect(review).toBeVisible();
  expect(await persistedState(source.fixture, holding.id, transactionIds)).toEqual(before);
});
