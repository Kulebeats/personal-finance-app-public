import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture, type CompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";

async function signIn(page: Page, fixture: CompletionFixture) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByPlaceholder(/enter your password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/");
  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(200);
}

async function persistedSessions(userId: string) {
  return withFixtureClient(async client => {
    const { rows: tracking } = await client.query<{ id: string }>(
      "SELECT id FROM user_sessions WHERE user_id = $1 ORDER BY id", [userId]);
    const { rows: [counts] } = await client.query<{ stored: number; revoked: number; generation: number }>(`SELECT
      (SELECT count(*)::int FROM session WHERE sess->>'userId' = $1::text) AS stored,
      (SELECT count(*)::int FROM session_revocations WHERE user_id = $1::uuid) AS revoked,
      security_generation AS generation FROM users WHERE id = $1::uuid`, [userId]);
    return { tracking: tracking.map(row => row.id), ...counts };
  });
}

test("two browser jars revoke only the selected authenticated device", async ({ browser, baseURL }) => {
  expect(baseURL).toBeTruthy();
  const fixture = await createCompletionFixture();
  const first = await browser.newContext({ baseURL, timezoneId: "Africa/Lusaka" });
  const second = await browser.newContext({ baseURL, timezoneId: "Africa/Lusaka" });
  try {
    const firstPage = await first.newPage();
    const secondPage = await second.newPage();
    await signIn(firstPage, fixture);
    const initialResponse = await first.request.get("/api/settings/security/sessions");
    expect(initialResponse.status()).toBe(200);
    const initial = (await initialResponse.json()).data.sessions as { id: string }[];
    expect(initial).toHaveLength(1);
    const preservedId = initial[0].id;
    await signIn(secondPage, fixture);
    const bothResponse = await first.request.get("/api/settings/security/sessions");
    expect(bothResponse.status()).toBe(200);
    const both = (await bothResponse.json()).data.sessions as { id: string }[];
    expect(both).toHaveLength(2);
    const selected = both.filter(row => row.id !== preservedId);
    expect(selected).toHaveLength(1);
    expect(await persistedSessions(fixture.userId)).toEqual({
      tracking: [preservedId, selected[0].id].sort(), stored: 2, revoked: 0, generation: 0,
    });
    const stepUp = await first.request.post("/api/settings/security/step-up", { data: { password: fixture.password } });
    expect(stepUp.status()).toBe(200);
    const revoked = await first.request.delete(`/api/settings/security/sessions/${selected[0].id}`);
    expect(revoked.status()).toBe(200);
    expect((await revoked.json()).success).toBe(true);
    expect((await first.request.get("/api/auth/me")).status()).toBe(200);
    expect((await second.request.get("/api/auth/me")).status()).toBe(401);
    expect(await persistedSessions(fixture.userId)).toEqual({ tracking: [preservedId], stored: 1, revoked: 1, generation: 0 });
    await secondPage.reload();
    await expect(secondPage).toHaveURL(/\/login(?:\?|$)/);
    await expect(secondPage.getByRole("button", { name: /sign in/i })).toBeVisible();
    await firstPage.reload();
    await expect(firstPage).toHaveURL("/");
    await expect(firstPage.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    expect((await first.request.get("/api/auth/me")).status()).toBe(200);
  } finally {
    // Close pages with guards installed, then drain their in-flight handlers
    // before disposing the request contexts that own fetched response bodies.
    for (const context of [second, first]) {
      for (const page of context.pages()) await page.close();
      await context.unrouteAll({ behavior: "wait" });
      await context.close();
    }
  }
});
