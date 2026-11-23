import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { digestSipAuthorizationTerms } from "../sipAuthorizationContract";
import { digestSipFillProofTerms, normalizeSipFillProofTerms, serializeSipFillProofTerms } from "../sipFillProofContract";

// New v2 fixture preparation; no historical v1 purchase/grant is relabelled.
const terms = () => ({
  contractVersion: 2,
  contractType: "record_only_sip_actual_fill",
  accountId: "11111111-1111-4111-8111-111111111111",
  securityId: "22222222-2222-4222-8222-222222222222",
  quantity: "2",
  price: "3.125",
  fees: "0.25",
  amount: "6.50",
  currency: "zmw",
  executionDate: "2026-11-13",
  authorizedFrequency: "monthly",
  authorizedInitialDate: "2026-08-31",
  fxRate: null,
  amountZmw: null,
});
const canonical = '[2,"record_only_sip_actual_fill","11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","2.00000000","3.1250","0.25","6.50","ZMW","2026-11-13","monthly","2026-08-31",null,null]';

describe("C3-06 retained actual-fill proof v2", () => {
  it("has a fixed compact-JSON tuple with explicit decimal scales and literal null FX", () => {
    expect(serializeSipFillProofTerms(terms())).toBe(canonical);
    expect(digestSipFillProofTerms(terms())).toBe(createHash("sha256").update(canonical, "utf8").digest("hex"));
    expect(digestSipFillProofTerms(terms())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes aliases without mutating retained source facts", () => {
    const source = terms();
    const before = structuredClone(source);
    expect(normalizeSipFillProofTerms(source)).toMatchObject({ quantity: "2.00000000", price: "3.1250", fees: "0.25", amount: "6.50", currency: "ZMW", fxRate: null, amountZmw: null });
    expect(source).toEqual(before);
    expect(digestSipFillProofTerms({ ...source, quantity: "2.00000000", price: "3.1250", currency: "ZMW" }))
      .toBe(digestSipFillProofTerms(source));
  });

  it("can be recomputed after all operational confirmation/broker data is absent", () => {
    const purchase = {
      accountId: terms().accountId, securityId: terms().securityId,
      quantity: "2.00000000", price: "3.1250", fees: "0.25", amount: "6.50",
      currency: "ZMW", transactionDate: "2026-11-13", fxRate: null, amountZmw: null,
    };
    const retainedProof = { purchaseId: "33333333-3333-4333-8333-333333333333",
      authorUserId: "44444444-4444-4444-8444-444444444444", authorizedAt: "2026-11-14T12:34:56.123456Z",
      authorizationContractVersion: 2, authorizedFrequency: "monthly", authorizedInitialDate: "2026-08-31",
      authorizedTermsDigest: digestSipFillProofTerms(terms()) };
    expect(digestSipFillProofTerms({ accountId: purchase.accountId, securityId: purchase.securityId,
      quantity: purchase.quantity, price: purchase.price, fees: purchase.fees, amount: purchase.amount,
      currency: purchase.currency, fxRate: purchase.fxRate, amountZmw: purchase.amountZmw, executionDate: purchase.transactionDate,
      contractVersion: retainedProof.authorizationContractVersion, contractType: "record_only_sip_actual_fill",
      authorizedFrequency: retainedProof.authorizedFrequency, authorizedInitialDate: retainedProof.authorizedInitialDate }))
      .toBe(retainedProof.authorizedTermsDigest);
    expect(Object.keys(retainedProof)).toHaveLength(7);
  });

  it.each([
    { fxRate: "1" }, { amountZmw: "6.50" }, { fxRate: undefined }, { amountZmw: undefined },
    { contractVersion: 1 }, { contractType: "record_only_sip" },
    { amount: "6.25" }, { authorizedFrequency: "custom" },
    { executionDate: "2026-02-30" }, { authorizedInitialDate: "0000-01-01" },
    { quantity: "2.000000001" }, { price: "3.12501" }, { fees: "0.251" },
  ])("rejects unsupported or inconsistent purported retained facts %#", patch => {
    expect(() => normalizeSipFillProofTerms({ ...terms(), ...patch })).toThrow();
  });

  it("binds a foreign fill's dated conversion pair into the same tuple slots (#236 F1)", () => {
    const foreign = { ...terms(), currency: "USD", fxRate: "26.50000000", amountZmw: "172.25" };
    expect(serializeSipFillProofTerms(foreign)).toBe(canonical.replace('"ZMW"', '"USD"').replace("null,null]", '"26.50000000","172.25"]'));
    // 6.50 x 26.6 = 172.90: a different dated rate with its own base is a different digest.
    expect(digestSipFillProofTerms(foreign)).not.toBe(digestSipFillProofTerms({ ...foreign, fxRate: "26.60000000", amountZmw: "172.90" }));
  });

  it.each([
    { currency: "ZMW", fxRate: "1.00000000", amountZmw: "6.50" },
    { currency: "USD", fxRate: "26.5000", amountZmw: "172.25" },
    { currency: "USD", fxRate: "0.00000000", amountZmw: "0.00" },
    { currency: "USD", fxRate: "26.50000000", amountZmw: "172.250" },
    { currency: "USD", fxRate: "26.50000000", amountZmw: null },
    // #242 P2-3: well-formed but not the fill amount at the rate (172.25 is right).
    { currency: "USD", fxRate: "26.50000000", amountZmw: "172.26" },
    { currency: "USD", fxRate: "26.60000000", amountZmw: "172.25" },
  ])("rejects a conversion pair that is half-present, mis-scaled, zero, on a ZMW fill or off its equation %#", patch => {
    expect(() => normalizeSipFillProofTerms({ ...terms(), ...patch })).toThrow();
  });

  it("rejects operational/reference fields rather than hiding them behind a digest", () => {
    for (const key of ["brokerReference", "brokerReferenceHash", "operationId", "planId", "occurrenceId", "confirmationId", "requestDigest", "securityGeneration", "sessionId"]) {
      expect(() => digestSipFillProofTerms({ ...terms(), [key]: "must-not-be-retained" })).toThrow();
    }
  });

  it("binds every retained economic/date/cadence fact independently of planned amount", () => {
    const original = digestSipFillProofTerms(terms());
    for (const patch of [
      { accountId: "55555555-5555-4555-8555-555555555555" },
      { securityId: "66666666-6666-4666-8666-666666666666" },
      { quantity: "3", amount: "9.63" },
      { price: "4", amount: "8.25" },
      { fees: "0.50", amount: "6.75" },
      { currency: "USD" },
      { executionDate: "2026-11-12" },
      { authorizedFrequency: "quarterly" },
      { authorizedInitialDate: "2026-08-30" },
    ]) expect(digestSipFillProofTerms({ ...terms(), ...patch })).not.toBe(original);
  });

  it("leaves the separate standing v1 serializer and semantics intact", () => {
    expect(() => digestSipAuthorizationTerms({ ...terms(), contractVersion: 2 })).toThrow();
    expect(digestSipAuthorizationTerms({ contractVersion: 1, contractType: "record_only_sip",
      accountId: terms().accountId, securityId: terms().securityId, amount: "10.00", currency: "ZMW",
      frequency: "monthly", initialDate: "2026-08-31" })).not.toBe(digestSipFillProofTerms(terms()));
  });
});
