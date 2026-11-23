import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { accounts, households, transactions, userNotificationPreferences, users } from "@shared/schema";
import { db } from "../../../db";
import { sendEmail } from "../../../services/emailService";
import { sendWeeklyRecapEmail } from "../weekly-recap.email.service";
import { a, actors, app, b, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

/**
 * OPS-006 (recap part): the in-app weekly recap must fail visibly when a rate
 * is missing, as the emailed digest already does, never show a spending total
 * of 0. The digest already labels spending with the household currency (the
 * OPS-006 "$" premise was stale), and this pins that it stays so.
 * Signed HTTP routes, the spending reads and the digest rendering are real;
 * only the SMTP transport is a stub.
 */
vi.mock("../../../services/emailService", () => ({ sendEmail: vi.fn() }));
const smtp = vi.mocked(sendEmail);

function day(offset: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
const from = day(-3), to = day(3), spentOn = day(-1);
// No test seeds a rate for this currency, so the conversion has nothing to use.
const UNRATED_CURRENCY = "ISK";
const unratedAccount = randomUUID(), unratedTx = randomUUID(), zmwTx = randomUUID();

function signedRecap() {
  return request(app).get(`/api/weekly-recap?weekStart=${from}&weekEnd=${to}`).set("Cookie", actors.get("owner")!.cookie);
}

describe("weekly recap fails visibly instead of reporting zero spending", () => {
  beforeAll(async () => {
    await start();
    await db.insert(userNotificationPreferences).values({ userId: actors.get("owner")!.id, notificationType: "weekly_recap", emailEnabled: true });
  }, 20_000);
  beforeEach(async () => {
    await reset();
    smtp.mockReset();
    smtp.mockResolvedValue(true);
    await db.update(households).set({ aiConsentGiven: true }).where(inArray(households.id, [a, b]));
  });
  afterAll(async () => {
    await db.delete(transactions).where(inArray(transactions.id, [unratedTx, zmwTx]));
    await stop();
  });

  it("answers the in-app recap with 422 MISSING_FX_RATE when a week's spending has no rate", async () => {
    const owner = actors.get("owner")!.id;
    await db.insert(accounts).values({ id: unratedAccount, householdId: a, name: "OPS unrated", type: "checking",
      currency: UNRATED_CURRENCY, initialBalance: "500.00", balance: "500.00", isPrivate: false, ownerUserId: owner });
    await db.insert(transactions).values({ id: unratedTx, householdId: a, accountId: unratedAccount, ownerUserId: owner,
      date: spentOn, name: "OPS unrated purchase", amount: "40.00", type: "expense", isPrivate: false });

    const response = await signedRecap();

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ success: false, error: { code: "MISSING_FX_RATE" } });
  });

  it("labels the digest's spending with the household currency, never $", async () => {
    const owner = actors.get("owner")!.id;
    await db.insert(transactions).values({ id: zmwTx, householdId: a, accountId: ids.sharedAccount, ownerUserId: owner,
      date: spentOn, name: "OPS kwacha purchase", amount: "1234.50", type: "expense", isPrivate: false });
    const [recipient] = await db.select({ email: users.email }).from(users).where(eq(users.id, owner));

    expect(await sendWeeklyRecapEmail(owner, a, recipient.email, from, to)).toBe("sent");

    const html = smtp.mock.calls[0][0].html;
    // Intl separates the code and amount with a no-break space (U+00A0).
    expect(html).toMatch(/ZMW\s1,234\.50/);
    expect(html).not.toMatch(/\$\s?1,234\.50/);
  });
});
