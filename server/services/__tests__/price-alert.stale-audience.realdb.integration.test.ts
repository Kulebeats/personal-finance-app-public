/**
 * Astra A-57: a stale-price notice names a security, so it goes only to the
 * members who can see a holding of that security. A holding in a member's
 * private account tells only that member; a holding in a shared account tells
 * every notifiable member. REAL DB; each member's notices read over HTTP.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accounts, holdings, householdMembers, notificationDeliveries, notifications, securities } from "@shared/schema";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { db } from "../../db";
import { priceAlertService } from "../PriceAlertService";
import { notificationService } from "../NotificationService";
import * as emailChannel from "../notification/email-channel";
import { pushNotificationService } from "../notification/push";
import { a, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AGE_DAYS = 40;

let privateSecurity: string;
let sharedSecurity: string;

const actorIds = () => [...actors.values()].map(({ id }) => id);
const userId = (role: Role) => actors.get(role)!.id;

async function clean() {
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, actorIds()));
  await db.delete(notifications).where(inArray(notifications.userId, actorIds()));
  await db.delete(holdings).where(eq(holdings.householdId, a));
  const seeded = [privateSecurity, sharedSecurity].filter(Boolean);
  if (seeded.length) await db.delete(securities).where(inArray(securities.id, seeded));
}

/** Who was told about this security, by user id. */
async function recipients(securityId: string): Promise<string[]> {
  const rows = await db.select({ userId: notifications.userId }).from(notifications).where(and(
    eq(notifications.type, NOTIFICATION_TYPES.STALE_PRICE),
    sql`${notifications.metadata}->>'securityId' = ${securityId}`,
  ));
  return rows.map((row) => row.userId).sort();
}

const notices = (role: Role) => request(app).get("/api/notifications")
  .set("Cookie", actors.get(role)!.cookie).set("X-Capital-Subject", userId(role)).set("X-Capital-Household", a);

describe("Astra A-57: a stale-price notice reaches only members who can see the holding (real DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    privateSecurity = randomUUID(); sharedSecurity = randomUUID();
    const stale = new Date(Date.now() - STALE_AGE_DAYS * DAY_MS);
    await db.insert(securities).values([
      { id: privateSecurity, symbol: "PRIVSTALE", name: "PRIVSTALE Holdings plc", type: "stock", currency: "ZMW", currentPrice: "1.00", lastPriceUpdate: stale },
      { id: sharedSecurity, symbol: "SHRDSTALE", name: "SHRDSTALE Holdings plc", type: "stock", currency: "ZMW", currentPrice: "1.00", lastPriceUpdate: stale },
    ]);
    await db.insert(holdings).values([
      // Held only in the owner's private account (A5 PRIVATE).
      { householdId: a, accountId: ids.privateAccount, securityId: privateSecurity, quantity: "10" },
      { householdId: a, accountId: ids.sharedAccount, securityId: sharedSecurity, quantity: "10" },
    ]);
  });
  afterAll(async () => {
    await clean();
    await stop();
  });

  it("a security held only in a private account is named to its owner alone", async () => {
    await priceAlertService.checkStalePrices();
    expect(await recipients(privateSecurity)).toEqual([userId("owner")]);

    const peer = await notices("member").expect(200);
    const admin = await notices("admin").expect(200);
    const owner = await notices("owner").expect(200);
    expect(JSON.stringify(peer.body)).not.toContain("PRIVSTALE");
    expect(JSON.stringify(admin.body)).not.toContain("PRIVSTALE");
    expect(JSON.stringify(owner.body)).toContain("Stale price: PRIVSTALE");
  });

  it("a security held in a shared account is named to every notifiable member", async () => {
    await priceAlertService.checkStalePrices();
    await priceAlertService.checkStalePrices();
    expect(await recipients(sharedSecurity)).toEqual([userId("owner"), userId("admin"), userId("member")].sort());

    const peer = await notices("member").expect(200);
    expect(JSON.stringify(peer.body)).toContain("Stale price: SHRDSTALE");
  });

  it("uses one bounded key per quote and recipient while honoring a legacy external delivery", async () => {
    const recipient = userId("member");
    const [quote] = await db.select({ lastUpdate: securities.lastPriceUpdate }).from(securities)
      .where(eq(securities.id, sharedSecurity));
    const lastUpdate = quote.lastUpdate!;
    const legacyKey = `stale_price:${a}:${sharedSecurity}:${lastUpdate}:user:${recipient}`;
    expect(legacyKey.length).toBeGreaterThan(150);
    await db.insert(notificationDeliveries).values({ userId: recipient, eventKey: legacyKey, channel: "email", status: "sent" });

    const originalPreferences = notificationService.getUserPreferences.bind(notificationService);
    const preferences = vi.spyOn(notificationService, "getUserPreferences").mockImplementation((id, type) =>
      id === recipient && type === NOTIFICATION_TYPES.STALE_PRICE
        ? Promise.resolve({ inAppEnabled: true, emailEnabled: true, pushEnabled: false })
        : originalPreferences(id, type));
    const email = vi.spyOn(emailChannel, "sendNotificationEmail").mockResolvedValue({ status: "sent" });
    try {
      await priceAlertService.checkStalePrices();
      await priceAlertService.checkStalePrices();
      const saved = await db.select({ key: notifications.dedupeKey }).from(notifications).where(and(
        eq(notifications.userId, recipient),
        eq(notifications.type, NOTIFICATION_TYPES.STALE_PRICE),
      ));
      expect(saved).toEqual([{ key: `stale_price:${a}:${sharedSecurity}:${lastUpdate.getTime()}:user:${recipient}` }]);
      expect(email).not.toHaveBeenCalled();

      await db.update(securities).set({ lastPriceUpdate: new Date(lastUpdate.getTime() + 1_000) })
        .where(eq(securities.id, sharedSecurity));
      await priceAlertService.checkStalePrices();
      await priceAlertService.checkStalePrices();
      expect((await recipients(sharedSecurity)).filter(id => id === recipient)).toHaveLength(2);
      expect(email).toHaveBeenCalledTimes(1);
    } finally {
      preferences.mockRestore();
      email.mockRestore();
    }
  });

  it.each(["custody", "membership"] as const)("suppresses a previously eligible recipient when %s changes before publication", async change => {
    const originalPreferences = notificationService.getUserPreferences.bind(notificationService);
    const recipient = userId("member");
    let changed = false;
    const preferences = vi.spyOn(notificationService, "getUserPreferences").mockImplementation(async (id, type) => {
      if (id !== recipient || type !== NOTIFICATION_TYPES.STALE_PRICE) return originalPreferences(id, type);
      if (!changed) {
        if (change === "custody") {
          await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, ids.sharedAccount));
        } else {
          await db.update(householdMembers).set({ role: "view_only" }).where(and(
            eq(householdMembers.householdId, a), eq(householdMembers.userId, recipient),
          ));
        }
        changed = true;
      }
      // Membership case has only external channels, so it exercises the
      // final transport gate independently of the in-app transaction.
      return change === "custody"
        ? { inAppEnabled: true, emailEnabled: false, pushEnabled: false }
        : { inAppEnabled: false, emailEnabled: true, pushEnabled: true };
    });
    const email = vi.spyOn(emailChannel, "sendNotificationEmail").mockResolvedValue({ status: "sent" });
    const push = vi.spyOn(pushNotificationService, "sendPushDetailed").mockResolvedValue({ status: "sent" });
    try {
      await priceAlertService.checkStalePrices();
      expect(changed).toBe(true);
      expect(await recipients(sharedSecurity)).not.toContain(recipient);
      expect(await recipients(sharedSecurity)).toContain(userId("owner"));
      expect(email).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    } finally {
      preferences.mockRestore();
      email.mockRestore();
      push.mockRestore();
    }
  });
});
