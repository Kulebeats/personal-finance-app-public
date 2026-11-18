/**
 * Pins the CURRENT, honest state of MFA enforcement.
 *
 * MFA is optional for everyone, including owners and admins:
 * `checkMfaPolicy` computes a `required` verdict that no caller reads, so
 * `authService.login` completes regardless. These tests exist so that state is
 * asserted rather than assumed, and so the day someone implements enforcement
 * they get a RED test telling them exactly which expectations to update — not a
 * silent behaviour change on an auth path.
 *
 * If you are here because a test failed: enforcement landing is the ONLY
 * legitimate reason. Update these assertions deliberately, and make sure an
 * enrollment grace flow exists so privileged users are not locked out.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const policySource = readFileSync(
  path.resolve(__dirname, "../auth.mfa-policy.ts"),
  "utf8",
);
const loginSource = readFileSync(
  path.resolve(__dirname, "../auth.service.ts"),
  "utf8",
);

describe("MFA enforcement gap (documented, not a defect to silently fix)", () => {
  it("has no re-introduced MFA_ENFORCEMENT_ENABLED switch", () => {
    // The old flag read "Set to true to enforce" but was wired to nothing.
    // A switch that looks load-bearing and is not invites a false audit
    // attestation, so it must not come back without real enforcement.
    const declaration = /const\s+MFA_ENFORCEMENT_ENABLED\s*=/;
    expect(declaration.test(policySource)).toBe(false);
  });

  it("never returns required: true from the policy", () => {
    // Every `required:` occurrence must be either the interface's type
    // annotation (`boolean`) or a literal `false` value — never `true`, and
    // never an identifier that could carry a truthy value at runtime.
    const values = [...policySource.matchAll(/required:\s*([A-Za-z_][\w.]*)/g)].map(
      (m) => m[1],
    );
    expect(values.length).toBeGreaterThan(0);
    expect([...new Set(values)].sort()).toEqual(["boolean", "false"]);
  });

  it("login does not consume the required verdict", () => {
    // The single behavioural fact that makes MFA optional: login reads
    // suggestEnrollment and nothing else off the policy result.
    expect(loginSource).toContain("suggestMfa: mfaPolicy.suggestEnrollment");
    expect(loginSource).not.toMatch(/mfaPolicy\.required/);
  });

  it("documents the gap in the module header so the name cannot mislead", () => {
    expect(policySource).toMatch(/ENFORCEMENT IS NOT IMPLEMENTED/);
  });
});
