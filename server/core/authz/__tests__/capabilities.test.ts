import { describe, expect, it } from "vitest";
import { can, isHouseholdRole } from "../capabilities";

// These literal expectations are independent of the production capability map.
const matrix = [
  ["financial.read", true, true, true, true, true],
  ["financial.write", true, true, true, false, false],
  ["financial.export", true, true, true, false, false],
  ["household.policy.write", true, true, false, false, false],
  ["personal.settings", true, true, true, true, true],
  ["personal.export", true, true, true, true, true],
  ["ai.read", true, true, true, true, true],
] as const;
const roles = ["owner", "admin", "member", "view_only", "professional"] as const;

describe("R04 named capability contract", () => {
  for (const [capability, ...expected] of matrix) {
    it.each(roles.map((role, index) => [role, expected[index]] as const))(
      `${capability} for %s is %s`, (role, permitted) => {
        expect(isHouseholdRole(role)).toBe(true);
        expect(can(role, capability)).toBe(permitted);
      },
    );
  }

  it.each(["", "OWNER", "operator", "__proto__", "constructor", null, undefined, 1])(
    "unknown role %s has no capability", (role) => {
      expect(isHouseholdRole(role)).toBe(false);
      for (const [capability] of matrix) expect(can(role, capability)).toBe(false);
    },
  );

  it("does not authorize undeclared capabilities", () => {
    expect(can("owner", "operator.market.write" as never)).toBe(false);
    expect(can("owner", "__proto__" as never)).toBe(false);
  });
});
