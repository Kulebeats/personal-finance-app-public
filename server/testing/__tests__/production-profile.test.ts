import { describe, expect, it } from "vitest";
import { applyProductionProfile, isProductionProfile } from "../production-profile";

/** The environment prepareTestEnvironment leaves for a database-mode browser run. */
const prepared = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "test", PFA_TEST_MODE: "database", PFA_TEST_OUTBOUND: "deny", TEST_BROWSER_CLIENT: "built",
  PFA_BROWSER_PROFILE: "production", TRUST_PROXY: "false",
});

describe("R20.3 production-mode browser profile", () => {
  it("leaves test mode so CSRF and the limiters are live, behind one trusted proxy hop", () => {
    const env = prepared();
    expect(isProductionProfile(env)).toBe(true);
    expect(applyProductionProfile(env)).toEqual({ profile: "production", nodeEnv: "development", client: "built", trustProxy: "1" });
    expect(env).toMatchObject({ NODE_ENV: "development", DATABASE_SSL: "false", TRUST_PROXY: "1", SCHEDULER_ENABLED: "false" });
  });

  it.each<[string, NodeJS.ProcessEnv]>([
    ["an unprotected process", { NODE_ENV: "development" }],
    ["unit mode", { PFA_TEST_MODE: "unit" }],
    ["open outbound egress", { PFA_TEST_OUTBOUND: "allow" }],
    ["the Vite dev client", { TEST_BROWSER_CLIENT: undefined }],
  ])("refuses to start from %s", (_case, overrides) => {
    const env = { ...prepared(), ...overrides };
    expect(() => applyProductionProfile(env)).toThrow(/production-mode profile/);
    expect(env.NODE_ENV).toBe(overrides.NODE_ENV ?? "test");
  });

  it("is off unless asked for", () => {
    expect(isProductionProfile({ ...prepared(), PFA_BROWSER_PROFILE: undefined })).toBe(false);
  });
});
