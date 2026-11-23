import { describe, expect, it } from "vitest";
import { canonicalJson, validatePolicy, validateRequest } from "../contracts";
import { REQUIRED_JOB_CATALOG, snapshotDefinitions, unsupportedRequiredJobs } from "../catalog";
import { FIXTURE_NAME, requestFor, syntheticDefinition } from "./fixtures";

describe("R14 closed storage contract", () => {
  it("lists every mapped required producer as explicitly unsupported", () => {
    const names = REQUIRED_JOB_CATALOG.map(entry => entry.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["recurring.materialize", "recurring.remind", "budget.rollover", "budget.alerts",
      "goals.status", "goals.deadlines", "goals.weekly-report", "snapshots.daily", "market.fx-refresh", "market.price-refresh",
      "market.price-alerts", "market.stale-price-alerts", "investments.recurring-purchase", "investments.tbill-maturity",
      "grz.coupon-due", "grz.bond-maturity", "outbox.dispatch", "receipts.match", "receipts.retry", "recap.weekly",
      "security.daily-report", "cleanup.notifications", "cleanup.other-retention"]));
    expect(new Set(REQUIRED_JOB_CATALOG.map(entry => entry.family))).toEqual(new Set(["recurring", "budgets", "goals", "snapshots", "market", "investments", "grz", "outbox", "receipts", "recap", "security", "cleanup"]));
    expect(unsupportedRequiredJobs()).toHaveLength(23);
    for (const entry of REQUIRED_JOB_CATALOG) {
      expect(entry.integration).toBe("unsupported");
      expect(entry.duePolicy).toBeNull();
      expect(entry.storageDefinition).toBeNull();
      expect(entry.blockers).toContain("fence-not-integrated");
    }
    expect(REQUIRED_JOB_CATALOG.filter(entry => entry.trigger === "/market-data")).toHaveLength(4);
    expect(REQUIRED_JOB_CATALOG.filter(entry => entry.trigger === "/investment-automation")).toHaveLength(2);
  });

  it("snapshots synthetic policy and rejects production name collision", () => {
    const definition = syntheticDefinition();
    const registry = snapshotDefinitions([definition]);
    (definition.policy.retryDelaysMs as number[])[0] = 99;
    (definition.knownFailureCodes as string[])[0] = "MUTATED_FAILURE";
    expect(registry.get(FIXTURE_NAME)?.policy.retryDelaysMs).toEqual([0, 0]);
    expect(registry.get(FIXTURE_NAME)?.knownFailureCodes).toContain("KNOWN_TEST_FAILURE");
    expect(registry.get(FIXTURE_NAME)?.knownFailureCodes).not.toContain("MUTATED_FAILURE");
    expect(() => snapshotDefinitions([{ ...syntheticDefinition(), name: "recurring.materialize" }])).toThrow("UNSUPPORTED_DEFINITION");
    expect(() => snapshotDefinitions([syntheticDefinition(), syntheticDefinition()])).toThrow("UNSUPPORTED_DEFINITION");
    expect(() => snapshotDefinitions([{ ...syntheticDefinition(), knownFailureCodes: ["INVALID CODE"] }])).toThrow("INVALID_DEFINITION");
    expect(() => validatePolicy({ leaseMs: 10, maxClaimLifetimeMs: 1000, retryFailureLimit: 1, retryDelaysMs: [] })).toThrow("INVALID_POLICY");
    expect(() => validatePolicy({ leaseMs: 1000, maxClaimLifetimeMs: 1000, retryFailureLimit: 2, retryDelaysMs: [] })).toThrow("INVALID_POLICY");
  });

  it("uses fixed-field scope and strict canonical JSON without dropping bad values", () => {
    const request = requestFor("event:one", 1, { kind: "household", householdId: "123e4567-e89b-42d3-a456-426614174000" });
    const validated = validateRequest(request, ["synthetic"]);
    expect(validated.scopeKey).toBe('["household","123e4567-e89b-42d3-a456-426614174000"]');
    expect(canonicalJson({ z: 1, a: [3, 2] }, 100)).toBe('{"a":[3,2],"z":1}');
    expect(() => canonicalJson({ a: undefined }, 100)).toThrow("INVALID_JSON");
    expect(() => canonicalJson({ a: Infinity }, 100)).toThrow("INVALID_JSON");
    expect(() => canonicalJson([, 1], 100)).toThrow("INVALID_JSON");
    expect(() => canonicalJson(-0, 100)).toThrow("INVALID_JSON");
    expect(() => canonicalJson(new Date(), 100)).toThrow("INVALID_JSON");
    expect(() => validateRequest({ ...request, scope: { ...request.scope, extra: "x" } as unknown as typeof request.scope }, ["synthetic"])).toThrow("INVALID_SCOPE");
    expect(() => validateRequest({ ...request, dueAt: "2026-01-01T00:00:00Z" }, ["synthetic"])).toThrow("INVALID_DUE_AT");
    expect(() => validateRequest({ ...request, scope: { kind: "household", householdId: "123E4567-E89B-42D3-A456-426614174000" } }, ["synthetic"])).toThrow("INVALID_SCOPE");
  });
});
