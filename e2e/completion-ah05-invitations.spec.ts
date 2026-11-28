import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "./protected-test";
import { createCompletionFixture } from "../server/testing/fixtures/completion-fixtures";
import { withFixtureClient } from "../server/testing/fixtures/fixture-context";
import { signInAs } from "./utils/fixture-session";

/**
 * AH-05: an owner invites a member from Settings > Members, sees the invitation
 * pending, resends it and revokes it. Each write goes through the UI; the state
 * is read back from the API the screen uses and from the database.
 */
interface InvitationRow { id: string; email: string; invite_code: string }

async function storedInvitations(householdId: string): Promise<InvitationRow[]> {
  return withFixtureClient(async (client) => (await client.query<InvitationRow>(
    "SELECT id, email, invite_code FROM household_invitations WHERE household_id = $1 AND accepted_at IS NULL",
    [householdId])).rows);
}

async function apiInvitationEmails(page: Page): Promise<string[]> {
  const response = await page.request.get("/api/household/invitations");
  expect(response.status()).toBe(200);
  const body = await response.json() as { data: { invitations: { email: string }[] } };
  return body.data.invitations.map((invitation) => invitation.email);
}

function responseTo(page: Page, method: string, path: RegExp) {
  return page.waitForResponse((response) =>
    response.request().method() === method && path.test(new URL(response.url()).pathname));
}

test("an owner invites a member, sees it pending, resends it and revokes it", async ({ page }) => {
  const fixture = await createCompletionFixture();
  const guest = `ah05-guest-${randomUUID().slice(0, 8)}@example.test`;
  await signInAs(page, fixture);
  await page.goto("/settings/members");

  const section = page.getByRole("region", { name: "Pending invitations" });
  await expect(section.getByText("No invitations are waiting.")).toBeVisible();

  await page.getByRole("button", { name: "Add Member", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a household member" });
  await dialog.getByLabel("Email address", { exact: true }).fill(guest);
  const invited = responseTo(page, "POST", /^\/api\/household\/invite$/);
  await dialog.getByRole("button", { name: "Send invitation", exact: true }).click();
  expect((await invited).status()).toBe(201);
  await expect(dialog).toBeHidden();

  const list = page.getByRole("list", { name: "Pending invitations" });
  await expect(list.getByText(guest, { exact: true })).toBeVisible();
  expect(await apiInvitationEmails(page)).toEqual([guest]);
  const [stored] = await storedInvitations(fixture.householdId);
  expect(stored.email).toBe(guest);

  const resent = responseTo(page, "POST", /^\/api\/household\/invitations\/[^/]+\/resend$/);
  await page.getByRole("button", { name: `Resend invitation to ${guest}`, exact: true }).click();
  expect((await resent).status()).toBe(200);
  const [rotated] = await storedInvitations(fixture.householdId);
  expect(rotated.id).toBe(stored.id);
  expect(rotated.invite_code).not.toBe(stored.invite_code);

  await page.getByRole("button", { name: `Revoke invitation to ${guest}`, exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Revoke this invitation?" });
  const revoked = responseTo(page, "DELETE", /^\/api\/household\/invitations\/[^/]+$/);
  await confirm.getByRole("button", { name: "Revoke invitation", exact: true }).click();
  expect((await revoked).status()).toBe(204);

  await expect(section.getByText("No invitations are waiting.")).toBeVisible();
  expect(await apiInvitationEmails(page)).toEqual([]);
  expect(await storedInvitations(fixture.householdId)).toEqual([]);

  await page.reload();
  await expect(page.getByRole("region", { name: "Pending invitations" })
    .getByText("No invitations are waiting.")).toBeVisible();
});
