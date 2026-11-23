import { db } from "../db";
import { holdings, priceAlerts, securities, securityPrices } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { notificationService } from "./NotificationService";
import { NOTIFICATION_TYPES } from "@shared/notificationTypes";
import { withTransaction } from "../utils/withTransaction";
import { businessAuditService } from "./BusinessAuditService";
import { securityHoldingAudience, stalePriceDispatchHold } from "./notification/audience";

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

      // NEW-32: the trigger stamp and its system audit row commit together.
      // The notification above is deduplicated by its key, so a rolled-back
      // stamp re-notifies nothing on the next run.
      await withTransaction(async (tx) => {
        const triggeredAt = new Date();
        await tx
          .update(priceAlerts)
          .set({ lastTriggered: triggeredAt, updatedAt: triggeredAt })
          .where(eq(priceAlerts.id, alert.id));
        await businessAuditService.logUpdate({
          tx,
          userId: null,
          householdId: alert.householdId,
          entityType: "price_alert",
          entityId: alert.id,
          oldValue: { lastTriggered: alert.lastTriggered ? new Date(alert.lastTriggered).toISOString() : null },
          newValue: { lastTriggered: triggeredAt.toISOString() },
          metadata: { securityId: security.id, alertType: alert.alertType, source: "price_alert_check" },
        });
      });

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
        // A-57: the notice names the security, so only members who can see a holding of it.
        const recipients = await securityHoldingAudience(householdId, security.id);
        if (!recipients.length) continue;
        for (const userId of recipients) {
          await notificationService.notifyDetailed(userId, householdId, NOTIFICATION_TYPES.STALE_PRICE, {
            title: `Stale price: ${security.symbol || security.name}`,
            body: `${security.name} price is ${diffDays} days old`,
            actionUrl: "/investments",
            metadata: {
              securityId: security.id,
              lastPriceUpdate: security.lastPriceUpdate,
              diffDays,
            },
            // Epoch milliseconds fit the 150-character inbox key and are independent of the process time zone.
            dedupeKey: `stale_price:${householdId}:${security.id}:${lastUpdate.getTime()}:user:${userId}`,
            // The old inbox insert overflowed, but the wider ledger could hold an external-only delivery.
            legacyDeliveryEventKey: `stale_price:${householdId}:${security.id}:${security.lastPriceUpdate}:user:${userId}`,
            dispatchHold: tx => stalePriceDispatchHold(householdId, userId, security.id, lastUpdate, tx),
          });
        }

        triggered++;
      }
    }

    return { triggered };
  }
}

export const priceAlertService = new PriceAlertService();
