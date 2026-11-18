/**
 * NetWorth report — FX fail-closed (real DB)
 *
 * Regression test for the silent `rate = 1` fallback in the snapshot
 * conversion path (`NetWorthReportRepository.getNetWorth`). The fallback
 * lived in two layers: `buildFxRateExpr` COALESCEs a missing rate to 1 in
 * SQL, and the JS side applied `snapshot.fxRate ?? 1`. A snapshot in a
 * currency with NO stored FX rate must fail closed (SCP-321), never convert
 * at 1:1 and silently corrupt the net-worth series.
 *
 * Run against the test DB ONLY (never finance_app):
 *   DATABASE_URL=...finance_app_test npx vitest run \
 *     --config server/vitest.config.ts \
 *     server/repositories/reports/__tests__/NetWorthReportRepository.fxfailclosed.db.integration.test.ts
 *
 * @module repositories/reports/__tests__/NetWorthReportRepository.fxfailclosed.db.integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { households, netWorthSnapshots, fxRates } from "@shared/schema";
import { NetWorthReportRepository } from "../NetWorthReportRepository";

const FX_TEST_SOURCE = "fxfailclosed-test";

describe("NetWorthReportRepository — FX fail-closed (real DB)", () => {
  const repository = new NetWorthReportRepository();

  const usdHouseholdId = randomUUID();
  const zmwHouseholdId = randomUUID();

  beforeAll(async () => {
    await db.insert(households).values([
      {
        id: usdHouseholdId,
        name: "FX fail-closed USD household",
        currency: "USD",
      },
      {
        id: zmwHouseholdId,
        name: "FX fail-closed ZMW household",
        currency: "ZMW",
      },
    ]);

    // USD household holding a ZMW snapshot with NO ZMW->USD rate stored:
    // conversion is required and impossible, so the report must fail closed.
    await db.insert(netWorthSnapshots).values({
      householdId: usdHouseholdId,
      date: "2024-03-01",
      totalAssets: "1500.00",
      totalLiabilities: "500.00",
      netWorth: "1000.00",
      currency: "ZMW",
    });

    // Same-currency control: no conversion needed, so no rate is required.
    await db.insert(netWorthSnapshots).values({
      householdId: zmwHouseholdId,
      date: "2024-03-01",
      totalAssets: "1500.00",
      totalLiabilities: "500.00",
      netWorth: "1000.00",
      currency: "ZMW",
    });
  });

  afterAll(async () => {
    await db
      .delete(netWorthSnapshots)
      .where(eq(netWorthSnapshots.householdId, usdHouseholdId));
    await db
      .delete(netWorthSnapshots)
      .where(eq(netWorthSnapshots.householdId, zmwHouseholdId));
    await db.delete(fxRates).where(eq(fxRates.source, FX_TEST_SOURCE));
    await db.delete(households).where(eq(households.id, usdHouseholdId));
    await db.delete(households).where(eq(households.id, zmwHouseholdId));
  });

  it("fails closed when a snapshot currency has no stored FX rate", async () => {
    await expect(
      repository.getNetWorth(usdHouseholdId, {
        from: "2024-03-01",
        to: "2024-03-31",
        interval: "month",
      }),
    ).rejects.toThrow(/Exchange rate unavailable/);
  });

  it("converts with the stored rate once one exists", async () => {
    await db.insert(fxRates).values({
      fromCurrency: "ZMW",
      toCurrency: "USD",
      rate: "0.0400",
      date: "2024-02-15",
      source: FX_TEST_SOURCE,
    });

    const result = await repository.getNetWorth(usdHouseholdId, {
      from: "2024-03-01",
      to: "2024-03-31",
      interval: "month",
    });

    const point = result.series[0]?.data.find((d) =>
      String(d.x).startsWith("2024-03"),
    );
    expect(point?.y).toEqual({ amount: "40.00", currency: "USD" });
  });

  it("does not throw for same-currency snapshots with no rates stored", async () => {
    const result = await repository.getNetWorth(zmwHouseholdId, {
      from: "2024-03-01",
      to: "2024-03-31",
      interval: "month",
    });

    const point = result.series[0]?.data.find((d) =>
      String(d.x).startsWith("2024-03"),
    );
    expect(point?.y).toEqual({ amount: "1000.00", currency: "ZMW" });
  });
});
