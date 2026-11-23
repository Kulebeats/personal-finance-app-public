/**
 * A-49: which address the erased user held between e-mail changes, from the
 * registered address, each change's notice recipients and the current address.
 * An address that cannot be proved stays unknown, so nothing is rewritten on a guess.
 */
import { describe, expect, it } from "vitest";
import { orientAddresses } from "../settings.account-deletion.address-periods";

const change = (...recipients: string[]) => ({ at: "2026-11-23 10:00:00", recipients: new Set(recipients) });

describe("orientAddresses", () => {
  it("follows each change from the registered address to the current one", () => {
    expect(orientAddresses("a@example.invalid", [change("a@example.invalid", "b@example.invalid"),
      change("b@example.invalid", "c@example.invalid")], "c@example.invalid"))
      .toEqual(["a@example.invalid", "b@example.invalid", "c@example.invalid"]);
  });

  it("takes a lone recipient as the new address (the old one was unverified, so not notified)", () => {
    expect(orientAddresses("a@example.invalid", [change("b@example.invalid"), change("b@example.invalid", "c@example.invalid")],
      "c@example.invalid")).toEqual(["a@example.invalid", "b@example.invalid", "c@example.invalid"]);
  });

  it("works back from the current address when there is no registration row", () => {
    expect(orientAddresses(undefined, [change("a@example.invalid", "b@example.invalid")], "B@Example.invalid"))
      .toEqual(["a@example.invalid", "B@Example.invalid"]);
  });

  it("leaves a span unknown when its change has no notices left", () => {
    expect(orientAddresses("a@example.invalid", [change(), change()], "c@example.invalid"))
      .toEqual(["a@example.invalid", undefined, "c@example.invalid"]);
  });
});
