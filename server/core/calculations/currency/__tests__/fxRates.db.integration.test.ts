/**
 * FX Rate Repository - Database Integration Tests (date-boundary correctness)
 *
 * Guards a money-path off-by-one regression (CLAUDE.md Rule 1). The repository's
 * `getRateForDate` / `getMostRecentRateBefore` previously built a JS `Date` from the
 * incoming "YYYY-MM-DD" string and compared it against the `fx_rates.date` column (a
 * Postgres `date`, i.e. a calendar day with no time/zone). node-postgres serialises a
 * `Date` using the *local* timezone offset, so in any negative-UTC-offset timezone the
 * instant `2026-03-15T00:00:00Z` is sent as the prior evening and Postgres casts it to
 * `2026-03-14` - shifting the comparison by one day. The fix passes the "YYYY-MM-DD"
 * string straight through, which is timezone-independent.
 *
 * To make the regression deterministic on any machine, this suite pins the process
 * timezone to Etc/GMT+12 (POSIX inverts the sign, so this is UTC-12) for its lifetime.
 * Under the buggy code that forces the off-by-one; under the fix the string comparison
 * is unaffected by the pin and every assertion passes regardless of timezone.
 *
 * Uses the ISO 4217 reserved test/no-currency codes XTS -> XXX so it never collides with
 * real FX data, and scopes all cleanup to that pair.
 *
 * @module core/calculations/currency/__tests__/fxRates.db.integration
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { fxRates } from "@shared/schema";
import {
  createFXRateRepository,
  createFXRateService,
  DEFAULT_FX_CONFIG,
  type FXRateRepository,
  type FXRateService,
} from "../fxRates";
import { toMoney } from "../../types";

const FROM = "XTS"; // ISO 4217: code reserved for testing
const TO = "XXX"; // ISO 4217: no currency
const SOURCE = "__fxtest_integration__";

// Calendar days used by the fixtures (stored as plain "YYYY-MM-DD" strings).
const D_10 = "2026-03-10";
const D_15 = "2026-03-15";
const D_20 = "2026-03-20";

// DB integration suite: skip when no database is configured (e.g. the quick
// Definition-of-Done Stop gate runs core/calculations under the root vitest
// config, which does not load DATABASE_URL). The `db` module throws at import
// time when DATABASE_URL is unset, so it is imported lazily inside beforeAll -
// which never runs when the suite is skipped. This suite still runs in CI
// (Postgres service) and the full server suite (server/vitest.config loads .env).
describe.skipIf(!process.env.DATABASE_URL)(
  "FXRateRepository (real DB) - date-boundary correctness",
  () => {
  let db: (typeof import("../../../../db"))["db"];
  let repo: FXRateRepository;
  let service: FXRateService;
  let originalTz: string | undefined;

  const deletePair = () =>
    db
      .delete(fxRates)
      .where(and(eq(fxRates.fromCurrency, FROM), eq(fxRates.toCurrency, TO)));

  beforeAll(async () => {
    ({ db } = await import("../../../../db"));
    repo = createFXRateRepository(db, fxRates);
    service = createFXRateService(repo, DEFAULT_FX_CONFIG);

    // Seed with plain "YYYY-MM-DD" strings - the insert path is timezone-independent.
    // Clean slate for the test pair first (defends against a prior crashed run).
    await deletePair();
    await db.insert(fxRates).values([
      { fromCurrency: FROM, toCurrency: TO, rate: "10.0000", date: D_10, source: SOURCE },
      { fromCurrency: FROM, toCurrency: TO, rate: "15.0000", date: D_15, source: SOURCE },
      { fromCurrency: FROM, toCurrency: TO, rate: "20.0000", date: D_20, source: SOURCE },
    ]);

    // Pin the timezone LAST, after the throw-prone DB work, so a seed failure can
    // never leave TZ dirty. Node (V8) honors runtime TZ changes, and vitest's
    // default forks pool isolates each test file in its own process, so this does
    // not leak to other suites; afterAll restores it regardless.
    originalTz = process.env.TZ;
    process.env.TZ = "Etc/GMT+12"; // UTC-12 (POSIX inverts the sign)
  });

  afterAll(async () => {
    await deletePair();
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  });

  it("(precondition) the pinned timezone produces a negative UTC offset", () => {
    // Self-check: the off-by-one only manifests behind UTC. If Node ever stopped
    // honoring a runtime TZ change, this fails loudly here instead of letting the
    // boundary assertions silently pass against buggy code. getTimezoneOffset()
    // is positive for zones behind UTC (Etc/GMT+12 == UTC-12 => 720).
    expect(new Date(`${D_15}T00:00:00Z`).getTimezoneOffset()).toBeGreaterThan(0);
  });

  describe("getRateForDate", () => {
    it("returns the exact row on a boundary date (no off-by-one)", async () => {
      const result = await repo.getRateForDate(FROM, TO, D_15);

      expect(result).not.toBeNull();
      expect(result!.rate).toBe(15);
      // date is always returned as the exact "YYYY-MM-DD" string.
      expect(typeof result!.date).toBe("string");
      expect(result!.date).toBe(D_15);
    });

    it("returns null for a date with no stored rate", async () => {
      const result = await repo.getRateForDate(FROM, TO, "2026-03-12");
      expect(result).toBeNull();
    });
  });

  describe("getMostRecentRateBefore", () => {
    it("includes the boundary date itself (lte is inclusive, no off-by-one)", async () => {
      // The exact-date row is <= target and is the most recent; the bug returns D_10 instead.
      const result = await repo.getMostRecentRateBefore(FROM, TO, D_15);

      expect(result).not.toBeNull();
      expect(result!.date).toBe(D_15);
      expect(result!.rate).toBe(15);
    });

    it("returns the most recent rate strictly before a gap date", async () => {
      const result = await repo.getMostRecentRateBefore(FROM, TO, "2026-03-17");

      // Most recent on/before the 17th is the 15th - never the future 20th.
      expect(result).not.toBeNull();
      expect(result!.date).toBe(D_15);
      expect(result!.rate).toBe(15);
    });

    it("falls back to an earlier rate when none exists on the target day", async () => {
      const result = await repo.getMostRecentRateBefore(FROM, TO, "2026-03-12");

      expect(result).not.toBeNull();
      expect(result!.date).toBe(D_10);
      expect(result!.rate).toBe(10);
    });

    it("returns null when no rate exists on or before the date", async () => {
      const result = await repo.getMostRecentRateBefore(FROM, TO, "2026-03-09");
      expect(result).toBeNull();
    });
  });

  describe("service end-to-end (getHistoricalRate / convert)", () => {
    it("resolves the historical rate for an exact date to the cent", async () => {
      const rate = await service.getHistoricalRate(FROM, TO, D_15);
      expect(rate).toBe(15);

      const converted = await service.convert(toMoney(100), FROM, TO, D_15);
      expect(converted).toBeCloseTo(1500, 2);
    });

    it("falls back through the repository to the most recent prior rate", async () => {
      // 2026-03-12 has no exact row; service falls back to getMostRecentRateBefore -> D_10.
      const rate = await service.getHistoricalRate(FROM, TO, "2026-03-12");
      expect(rate).toBe(10);
    });
  });
});
