import { db } from "../db";
import { holdings, priceAlerts, securities, securityPrices } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { notificationService } from "./NotificationService";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";

const STALE_PRICE_THRESHOLDS: Record<string, number> = {
  stock: 7,
  bond: 30,
  tbill: 30,
  etf: 7,
  mutual_fund: 30,
  unit_trust: 30,
  forex: 2,
  crypto: 1,
};

export class PriceAlertService {
  async checkPriceAlerts() {
    const alerts = await db
      .select({
        alert: priceAlerts,
        security: securities,
      })
      .from(priceAlerts)
      .innerJoin(securities, eq(priceAlerts.securityId, securities.id))
      .where(eq(priceAlerts.isActive, true));

    let triggered = 0;

    for (const { alert, security } of alerts) {
      const currentPrice = Number(security.currentPrice);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        continue;
      }

      const lastPriceUpdate = security.lastPriceUpdate
        ? new Date(security.lastPriceUpdate)
        : null;
      const lastTriggered = alert.lastTriggered
        ? new Date(alert.lastTriggered)
        : null;

      if (
        lastTriggered &&
        lastPriceUpdate &&
        lastTriggered >= lastPriceUpdate
      ) {
        continue;
      }

      let shouldTrigger = false;
      let context: Record<string, unknown> = {};

      if (alert.alertType === "above") {
        shouldTrigger = currentPrice >= Number(alert.threshold);
        context = { currentPrice, threshold: Number(alert.threshold) };
      } else if (alert.alertType === "below") {
        shouldTrigger = currentPrice <= Number(alert.threshold);
        context = { currentPrice, threshold: Number(alert.threshold) };
      } else if (alert.alertType === "change_pct") {
        const history = await db
          .select()
          .from(securityPrices)
          .where(eq(securityPrices.securityId, security.id))
          .orderBy(desc(securityPrices.date))
          .limit(2);

        if (history.length >= 2) {
          const previous = Number(history[1].price);
          const changePct = previous
            ? ((currentPrice - previous) / previous) * 100
            : 0;
          shouldTrigger = Math.abs(changePct) >= Number(alert.threshold);
          context = {
            currentPrice,
            previousPrice: previous,
            changePct,
            threshold: Number(alert.threshold),
          };
        }
      }

      if (!shouldTrigger) {
        continue;
      }

      await notificationService.notifyHousehold(
        alert.householdId,
        NOTIFICATION_TYPES.PRICE_ALERT,
        {
          title: `Price alert: ${security.symbol || security.name}`,
          body: `${security.name} is ${alert.alertType.replace("_", " ")} ${
            alert.threshold
          }`,
          actionUrl: "/investments",
          metadata: {
            securityId: security.id,
            alertId: alert.id,
            ...context,
          },
          dedupeKey: `price_alert:${alert.id}:${lastPriceUpdate?.toISOString() || "manual"}`,
        }
      );

      await db
        .update(priceAlerts)
        .set({ lastTriggered: new Date(), updatedAt: new Date() })
        .where(eq(priceAlerts.id, alert.id));

      triggered++;
    }

    return { triggered };
  }

  async checkStalePrices() {
    const holdingsWithSecurity = await db
      .select({
        householdId: holdings.householdId,
        security: securities,
      })
      .from(holdings)
      .innerJoin(securities, eq(holdings.securityId, securities.id));

    const now = new Date();
    let triggered = 0;

    const grouped = new Map<
      string,
      { security: (typeof holdingsWithSecurity)[number]["security"]; households: Set<string> }
    >();

    for (const row of holdingsWithSecurity) {
      const entry = grouped.get(row.security.id) || {
        security: row.security,
        households: new Set<string>(),
      };
      entry.households.add(row.householdId);
      grouped.set(row.security.id, entry);
    }

    for (const { security, households: householdIds } of grouped.values()) {
      const lastUpdate = security.lastPriceUpdate
        ? new Date(security.lastPriceUpdate)
        : null;
      const thresholdDays = STALE_PRICE_THRESHOLDS[security.type] ?? 30;

      if (!lastUpdate) {
        continue;
      }

      const diffDays = Math.floor(
        (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diffDays < thresholdDays) {
        continue;
      }

      for (const householdId of householdIds) {
        await notificationService.notifyHousehold(
          householdId,
          NOTIFICATION_TYPES.STALE_PRICE,
          {
            title: `Stale price: ${security.symbol || security.name}`,
            body: `${security.name} price is ${diffDays} days old`,
            actionUrl: "/investments",
            metadata: {
              securityId: security.id,
              lastPriceUpdate: security.lastPriceUpdate,
              diffDays,
            },
            dedupeKey: `stale_price:${householdId}:${security.id}:${security.lastPriceUpdate}`,
          }
        );

        triggered++;
      }
    }

    return { triggered };
  }
}

export const priceAlertService = new PriceAlertService();
