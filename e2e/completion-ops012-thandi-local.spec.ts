import { randomUUID } from "node:crypto";
import { test, expect } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";

/**
 * OPS-012: Thandi is honest when no AI provider is configured (the test server
 * has neither key). After the owner grants consent in the browser, an answer is
 * labelled as a limited local summary, never as a Claude or Gemini answer, and
 * the status route reports both providers as not configured.
 */
test("with no provider configured Thandi labels its answer as a local summary", async ({ page }) => {
  const fixture = await createCompletionFixture();
  await withFixtureClient(client => client.query(
    "INSERT INTO accounts (id, household_id, name, type, balance, currency, is_private) VALUES ($1, $2, $3, 'checking', 150, 'ZMW', false)",
    [randomUUID(), fixture.householdId, `OPS012 account ${randomUUID().slice(0, 8)}`]));
  await signInAs(page, fixture);

  const status = await page.request.get("/api/ai/status");
  expect(status.status()).toBe(200);
  const statusBody = await status.json();
  const health = statusBody.data ?? statusBody;
  for (const provider of health.providers ?? []) expect(provider.configured).toBe(false);

  await page.goto("/advice");
  await expect(page.getByRole("heading", { name: "Thandi (AI Assistant)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enable Thandi", exact: true }).click();

  const composer = page.getByRole("textbox", { name: "Ask Thandi a question", exact: true });
  await composer.fill("What are my account balances?");
  const answered = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/ai/chat" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const reply = await answered;
  expect(reply.status()).toBe(200);
  const replyBody = await reply.json();
  expect((replyBody.data ?? replyBody).answerMode).toBe("local");

  await expect(page.getByText("Limited local summary", { exact: true })).toBeVisible();
  await expect(page.getByText(/Answered using (Claude|Gemini)/)).toHaveCount(0);
});
