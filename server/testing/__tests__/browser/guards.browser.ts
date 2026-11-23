import { test, expect } from "../../../../e2e/protected-test";
import pg from "pg";
import net from "node:net";
import { parseConnection } from "../../test-target.mjs";

test("browser and worker allow the verified target and refuse unrelated egress", async ({ page, request, browser }) => {
  const denied = process.env.PFA_R00_DENIED_ORIGIN;
  if (!denied) throw new Error("Negative browser proof requires its own local denied sink");
  expect((await page.goto("/"))?.status()).toBe(200);
  await expect(page.locator("body")).toHaveText("synthetic-browser-guard");
  const api = await request.get("/__test/identity");
  expect(api.ok()).toBe(true);
  await expect(request.get(denied)).rejects.toThrow(/TEST NETWORK DENIED/);
  expect(() => net.connect({ host: "127.0.0.1", port: +new URL(denied).port })).toThrow(/TEST NETWORK DENIED/);
  await expect(new pg.Client({ host: "127.0.0.1", port: 55432, database: "finance_app" }).connect()).rejects.toThrow(/TEST DATABASE DENIED/);
  const client = new pg.Client(parseConnection(process.env.TEST_DATABASE_URL!));
  try {
    await client.connect();
    expect((await client.query("SELECT 41 + 1 AS answer")).rows[0].answer).toBe(42);
  } finally { await client.end(); }
  // reports.spec creates a page directly in beforeAll, bypassing page/context
  // fixtures. That ordinary path must receive the same interception.
  const manual = await browser.newPage();
  try {
    await manual.goto(new URL("/", api.url()).origin);
    await expect(manual.locator("body")).toHaveText("synthetic-browser-guard");
    await expect(manual.goto(denied)).rejects.toThrow();
  } finally { await manual.close(); }
  const manualContext = await browser.newContext();
  try {
    const contextPage = await manualContext.newPage();
    await contextPage.goto(new URL("/", api.url()).origin);
    await expect(contextPage.locator("body")).toHaveText("synthetic-browser-guard");
    await expect(contextPage.goto(new URL("/redirect", api.url()).href)).rejects.toThrow();
  } finally { await manualContext.close(); }
  const sameOriginRedirect = await browser.newPage();
  try { await expect(sameOriginRedirect.goto(new URL("/redirect-safe", api.url()).href)).rejects.toThrow(); }
  finally { await sameOriginRedirect.close(); }
});
