/**
 * IMP-01 browser proof: the import templates download with the template's
 * headers, and a small synthetic .xlsx goes through the whole wizard (upload,
 * column mapping, review with the server preview, execute) and lands in the
 * transactions list with exact painted amounts, read back through the API
 * and the database.
 *
 * The workbook is generated in the test (e2e/utils/import-workbook.ts) on a
 * fresh synthetic household: no real data, no checked-in file. Matched by the
 * completion config's pattern, so it runs in the CI e2e gate (chromium).
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import type { Download, Locator } from "@playwright/test";
import { test, expect, type Page } from "./protected-test";
import { TEMPLATE_COLUMNS, TEMPLATE_INSTRUCTIONS } from "../shared/import-template";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";
import { buildImportWorkbook } from "./utils/import-workbook";
import { kwacha, responseValue, shownText, storedMoney } from "./utils/observe";
import { moneyValue, renderedMoney } from "./utils/money-value";
import { readBack, submitStep, type SubmitStep } from "./utils/submit";
import { testWithMutants } from "./utils/mutants";

/**
 * The wizard's execute write (QA-01, scripts/e2e-mutation-check.mjs): its corrupt
 * mutant imports the second file row (the income, rows are keyed by the
 * template header) at 251.00 instead of 250.00.
 */
const EXECUTE_IMPORT: SubmitStep = { name: "import-execute", method: "POST", path: "/api/import/execute", corruptField: "rows.1.Amount" };

const ACCOUNT_NAME = "Synthetic import account";
const OPENING_BALANCE = "100.00";
const HEADERS = TEMPLATE_COLUMNS.map((column) => column.header);
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** Names without digits: the importer keeps them as typed. */
const EXPENSE = { name: "Raven bakery", signed: "-18.40", amount: "18.40", painted: new RegExp(`^${kwacha("18.40")}$`) };
const INCOME = { name: "Raven refund", signed: "250.00", amount: "250.00", painted: new RegExp(`^\\+${kwacha("250.00")}$`) };

/** Today in the app's time zone, as YYYY-MM-DD (the list shows this month). */
const today = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lusaka" }).format(new Date());

function apiResponse(page: Page, method: string, path: string) {
  return page.waitForResponse((response) => response.request().method() === method && new URL(response.url()).pathname === path);
}

async function downloaded(page: Page, link: Locator): Promise<{ download: Download; bytes: Buffer }> {
  const pending = page.waitForEvent("download");
  await link.click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error(`${download.suggestedFilename()} was not saved`);
  return { download, bytes: await readFile(path) };
}

/** A sheet's rows as text cells, the way a spreadsheet shows them. */
function sheetRows(workbook: XLSX.WorkBook, name: string): string[][] {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`the workbook has no ${name} sheet`);
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
}

async function checkTemplates(page: Page, wizard: Locator): Promise<void> {
  const csv = await downloaded(page, wizard.getByRole("link", { name: "CSV template" }));
  expect(csv.download.suggestedFilename()).toBe("transactions-import-template.csv");
  expect(csv.bytes.toString("utf8").split("\r\n")[0]).toBe(HEADERS.join(","));

  const excel = await downloaded(page, wizard.getByRole("link", { name: "Excel template (.xlsx)" }));
  expect(excel.download.suggestedFilename()).toBe("transactions-import-template.xlsx");
  const workbook = XLSX.read(excel.bytes, { type: "buffer" });
  expect(workbook.SheetNames).toEqual(["Transactions", "Instructions"]);
  expect(sheetRows(workbook, "Transactions")[0]).toEqual(HEADERS);
  const sheetInstructions = sheetRows(workbook, "Instructions").map((row) => row[0]);
  expect(sheetInstructions).toEqual([...TEMPLATE_INSTRUCTIONS]);

  // The wizard shows the same instructions, for CSV users too.
  const instructions = wizard.getByTestId("import-template-instructions");
  await instructions.locator("summary").click();
  await expect(instructions.locator("summary")).toHaveText(sheetInstructions[0]);
  await expect(instructions.locator("p")).toHaveText(sheetInstructions.slice(1).map((line) => line.trim()));
}

testWithMutants("IMP-01: templates download with their headers, and a synthetic .xlsx imports through the wizard", { corrupt: [EXECUTE_IMPORT] }, async (page) => {
  test.setTimeout(180_000);
  const fixture = await createCompletionFixture();
  const accountId = randomUUID();
  // An asset account may not go below zero, and the expense row may post before the income row,
  // so the account opens with enough to cover the expense on its own.
  await withFixtureClient((client) => client.query(
    "INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES ($1, $2, $3, 'checking', $4, 'ZMW', false)",
    [accountId, fixture.householdId, ACCOUNT_NAME, OPENING_BALANCE]));
  await signInAs(page, fixture);
  await page.goto("/transactions");
  await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Import", exact: true }).click();
  const wizard = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Upload your transactions file" }) });
  await expect(wizard).toBeVisible();
  await checkTemplates(page, wizard);

  // Upload: the template's own headers, so the wizard maps every column itself.
  const date = today();
  const workbook = buildImportWorkbook([
    { date, merchant: EXPENSE.name, amount: EXPENSE.signed, currency: "ZMW", reference: `E2E-${randomUUID()}` },
    { date, merchant: INCOME.name, amount: INCOME.signed, currency: "ZMW", reference: `E2E-${randomUUID()}` },
  ]);
  const parsed = apiResponse(page, "POST", "/api/import/parse");
  await wizard.locator("input[type=file]").setInputFiles({ name: "synthetic-import.xlsx", mimeType: XLSX_MIME, buffer: workbook });
  expect((await parsed).status()).toBe(200);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /assign the columns in your file/i })).toBeVisible();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  // The rows have no Category values, so there is nothing to map here.
  await expect(dialog.getByRole("heading", { name: "Assign CSV categories to CopperCoin categories" })).toBeVisible();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();

  // Review: choosing the account runs the server preview.
  await expect(dialog.getByRole("heading", { name: "Review and Import" })).toBeVisible();
  const previewed = apiResponse(page, "POST", "/api/import/preview");
  await dialog.getByRole("combobox").filter({ hasText: "Select an account..." }).click();
  await page.getByRole("option", { name: `${ACCOUNT_NAME} (checking)`, exact: true }).click();
  expect((await previewed).status()).toBe(200);
  const importButton = dialog.getByRole("button", { name: "Import Transactions", exact: true });
  await expect(importButton).toBeEnabled();
  const execution = await submitStep(page, EXECUTE_IMPORT, () => importButton.click());
  expect(execution.status()).toBe(200);
  // The income row's imported amount, before the painted-amount checks below, which a wrong amount would also fail.
  await readBack(EXECUTE_IMPORT, moneyValue(INCOME.amount, "ZMW"), {
    api: async () => {
      const listed = await page.request.get(`/api/transactions?accountId=${accountId}`);
      if (listed.status() !== 200) throw new Error(`GET /api/transactions returned ${listed.status()}`);
      const named = ((await listed.json()) as { data: { name: string; amount: unknown }[] }).data.filter((row) => row.name === INCOME.name);
      if (named.length !== 1) throw new Error(`expected one imported ${INCOME.name}, found ${named.length}`);
      return responseValue(named[0].amount, "amount");
    },
    db: () => storedMoney("SELECT amount::text AS amount, currency FROM transactions WHERE household_id = $1 AND account_id = $2 AND name = $3",
      [fixture.householdId, accountId, INCOME.name]),
  });
  expect(await execution.json()).toMatchObject({ imported: 2 });
  await expect(dialog.getByRole("heading", { name: "Import Successful!" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();

  // The list paints each imported row's exact amount.
  await page.reload();
  for (const row of [EXPENSE, INCOME]) {
    const listRow = page.getByRole("button", { name: new RegExp(`^View ${row.name}, `) });
    await expect(listRow).toHaveCount(1);
    await expect(listRow.getByTestId("transaction-amount")).toHaveText(row.painted);
    expect(renderedMoney((await shownText(listRow.getByTestId("transaction-amount"))).replace(/^\+/, "")))
      .toBe(moneyValue(row.amount, "ZMW"));
  }

  // API and database read-back.
  const list = await page.request.get(`/api/transactions?accountId=${accountId}`);
  expect(list.status()).toBe(200);
  const rows = ((await list.json()) as { data: { id: string; name: string; type: string; date: string; amount: unknown }[] }).data;
  const byName = new Map(rows.map((row) => [row.name, row]));
  expect(rows).toHaveLength(2);
  for (const [row, type] of [[EXPENSE, "expense"], [INCOME, "income"]] as const) {
    const read = byName.get(row.name);
    expect(read).toMatchObject({ name: row.name, type, date });
    expect(responseValue(read?.amount, "amount")).toBe(moneyValue(row.amount, "ZMW"));
    expect(await storedMoney("SELECT amount::text AS amount, currency FROM transactions WHERE id = $1 AND household_id = $2 AND account_id = $3",
      [read?.id, fixture.householdId, accountId])).toBe(moneyValue(row.amount, "ZMW"));
  }
});
