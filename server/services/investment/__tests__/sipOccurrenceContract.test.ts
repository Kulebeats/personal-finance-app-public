import { describe, expect, it } from "vitest";
import {
  calculateSipFillEconomics,
  normalizeSipOccurrenceConfirmation,
  serializeSipOccurrenceIntent,
} from "@shared/sip-occurrence-contract";

// Source-first fixtures for the reviewed C3-06 wire. Execution belongs to Main.
// Date-policy selection is deliberately absent: no user/device/UTC fallback.
const context = {
  householdId: "11111111-1111-4111-8111-111111111111",
  planId: "22222222-2222-4222-8222-222222222222",
  scheduledDate: "2026-11-14",
  currency: "ZMW",
};
const operationId = "33333333-3333-4333-8333-333333333333";
const fill = { executionDate: "2026-11-13", quantity: "2", price: "3.125", fees: "0.25" };
const command = () => ({
  operationId,
  expectedRevision: 0,
  finalStatement: true,
  outcome: "partially_filled",
  fills: [{ ...fill }],
});

describe("C3-06 occurrence confirmation command contract", () => {
  it("normalizes exact input scales without changing the caller's draft", () => {
    const draft = command();
    const before = structuredClone(draft);
    expect(normalizeSipOccurrenceConfirmation(draft)).toEqual({
      ...draft,
      fills: [{ executionDate: "2026-11-13", quantity: "2.00000000", price: "3.1250", fees: "0.25" }],
    });
    expect(draft).toEqual(before);
  });

  it("uses existing BUY settlement and supports positive sub-cent fills", () => {
    expect(calculateSipFillEconomics(fill)).toEqual({ grossAmount: "6.25", fees: "0.25", amount: "6.50" });
    expect(calculateSipFillEconomics({ ...fill, quantity: "0.00000001", price: "0.0001", fees: "0" }))
      .toEqual({ grossAmount: "0.00", fees: "0.00", amount: "0.00" });
    expect(calculateSipFillEconomics({ ...fill, quantity: "1", price: "0.005", fees: "0" }).amount)
      .toBe("0.01");
  });

  it("preserves separate identical real fills and explicit outcome", () => {
    const parsed = normalizeSipOccurrenceConfirmation({ ...command(), fills: [{ ...fill }, { ...fill }] });
    expect(parsed.fills).toHaveLength(2);
    expect(parsed.fills[0]).toEqual(parsed.fills[1]);
    expect(parsed.outcome).toBe("partially_filled");
  });

  it("accepts final unfilled closure with no purchases", () => {
    expect(normalizeSipOccurrenceConfirmation({ ...command(), outcome: "unfilled", fills: [] }).fills).toEqual([]);
  });

  it.each([
    { outcome: "unfilled", fills: [fill] },
    { outcome: "filled", fills: [] },
    { outcome: "partially_filled", fills: [] },
    { outcome: "pending", fills: [] },
  ])("rejects contradictory or nonfinal closure %#", patch => {
    expect(() => normalizeSipOccurrenceConfirmation({ ...command(), ...patch })).toThrow();
  });

  it("allows exactly 100 fills and rejects the whole 101-fill draft without mutation", () => {
    expect(normalizeSipOccurrenceConfirmation({ ...command(), fills: Array.from({ length: 100 }, () => ({ ...fill })) }).fills).toHaveLength(100);
    const draft = { ...command(), fills: Array.from({ length: 101 }, () => ({ ...fill })) };
    const before = structuredClone(draft);
    expect(() => normalizeSipOccurrenceConfirmation(draft)).toThrow();
    expect(draft).toEqual(before);
  });

  it.each([
    { finalStatement: false },
    { finalStatement: undefined },
    { expectedRevision: -1 },
    { expectedRevision: 0.5 },
    { operationId: "not-a-uuid" },
    { accountId: context.planId },
    { fxRate: "1" },
    { amountZmw: "6.50" },
  ])("rejects missing authority acknowledgment or unsupported wire fields %#", patch => {
    expect(() => normalizeSipOccurrenceConfirmation({ ...command(), ...patch })).toThrow();
  });

  it.each([
    { executionDate: "2026-02-30" },
    { executionDate: "0000-01-01" },
    { executionDate: "2026-1-01" },
    { executionDate: "2026-11-13T00:00:00Z" },
    { quantity: "0" },
    { quantity: "-1" },
    { quantity: "1e2" },
    { quantity: "1.000000001" },
    { quantity: "10000000000" },
    { price: "0" },
    { price: "3.12501" },
    { price: "100000000000" },
    { fees: "" },
    { fees: undefined },
    { fees: "-0.01" },
    { fees: "0.001" },
    { fees: "10000000000000" },
    { fees: "NaN" },
    { price: "3.125\n" },
    { amount: "6.50" },
  ])("rejects malformed, invented, unsupported or overflowing fill input %#", patch => {
    expect(() => normalizeSipOccurrenceConfirmation({ ...command(), fills: [{ ...fill, ...patch }] })).toThrow();
  });

  it("rejects aggregate custody quantity and basis overflow before posting", () => {
    expect(() => normalizeSipOccurrenceConfirmation({ ...command(), fills: [
      { ...fill, quantity: "6000000000", price: "0.0001", fees: "0" },
      { ...fill, quantity: "6000000000", price: "0.0001", fees: "0" },
    ] })).toThrow();
    expect(() => normalizeSipOccurrenceConfirmation({ ...command(), fills: [
      { ...fill, quantity: "1", price: "1", fees: "6000000000000" },
      { ...fill, quantity: "1", price: "1", fees: "6000000000000" },
    ] })).toThrow();
  });

  it.each([
    { quantity: "9999999999.99999999", price: "0.0001", fees: "0", expectedAmount: "1000000.00" },
    { quantity: "0.00000001", price: "99999999999.9999", fees: "0", expectedAmount: "1000.00" },
    { quantity: "0.00000001", price: "0.0001", fees: "9999999999999.99", expectedAmount: "9999999999999.99" },
  ])("accepts a maximum boundary with independently compatible operands %#", boundary => {
    const source = { executionDate: fill.executionDate, quantity: boundary.quantity, price: boundary.price, fees: boundary.fees };
    const accepted = normalizeSipOccurrenceConfirmation({ ...command(), fills: [source] });
    expect(calculateSipFillEconomics(accepted.fills[0]).amount).toBe(boundary.expectedAmount);
  });

  it("rejects one-cent per-fill and aggregate overflow despite individually valid inputs", () => {
    const maximum = { ...fill, quantity: "0.00000001", price: "0.0001", fees: "9999999999999.99" };
    const cent = { ...fill, quantity: "1", price: "0.01", fees: "0" };
    expect(() => normalizeSipOccurrenceConfirmation({ ...command(), fills: [{ ...cent, fees: maximum.fees }] })).toThrow();
    expect(() => normalizeSipOccurrenceConfirmation({ ...command(), fills: [maximum, cent] })).toThrow();
  });

  it("accepts evidenced pre-due dates without guessing a calendar cutoff", () => {
    expect(normalizeSipOccurrenceConfirmation({ ...command(), fills: [{ ...fill, executionDate: "2000-02-29" }] }).fills[0].executionDate)
      .toBe("2000-02-29");
  });

  it("preserves a supplied optional reference exactly and does not require one", () => {
    expect(normalizeSipOccurrenceConfirmation(command())).not.toHaveProperty("brokerReference");
    expect(normalizeSipOccurrenceConfirmation({ ...command(), brokerReference: "  statement-é  " }).brokerReference)
      .toBe("  statement-é  ");
    expect(normalizeSipOccurrenceConfirmation({ ...command(), brokerReference: "🧾".repeat(200) }).brokerReference)
      .toBe("🧾".repeat(200));
  });

  it.each([null, "", " \t\n", "\u0000", "\ud800", "\udfff", "🧾".repeat(201)])(
    "rejects invalid optional reference without exposing it in errors %#", brokerReference => {
      let caught: unknown;
      try {
        normalizeSipOccurrenceConfirmation({ ...command(), brokerReference });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      if (typeof brokerReference === "string" && brokerReference.length > 5) {
        expect(String(caught)).not.toContain(brokerReference);
      }
    },
  );

  it.each(["\u0000", "\ud800", "\udfff"])("never echoes raw or escaped short malformed references %#", brokerReference => {
    let caught: unknown;
    try {
      normalizeSipOccurrenceConfirmation({ ...command(), brokerReference });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const diagnostic = JSON.stringify({ message: (caught as Error).message,
      fields: (caught as { fields?: unknown }).fields });
    expect(diagnostic).not.toContain(brokerReference);
    expect(diagnostic).not.toContain(JSON.stringify(brokerReference).slice(1, -1));
  });

  it("serializes complete canonical intent while excluding raw reference and operation key", () => {
    const expected = '[1,"confirm_record_only_sip_occurrence","11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","2026-11-14",0,true,"partially_filled","ZMW",[["2026-11-13","2.00000000","3.1250","0.25"]]]';
    expect(serializeSipOccurrenceIntent(context, { ...command(), brokerReference: "private broker statement" })).toBe(expected);
    expect(serializeSipOccurrenceIntent(context, { ...command(), operationId: "44444444-4444-4444-8444-444444444444" })).toBe(expected);
    expect(serializeSipOccurrenceIntent(context, { ...command(), brokerReference: "different raw reference" })).toBe(expected);
  });

  it("binds path, household, revision, closure and ordered individual facts", () => {
    const original = { ...command(), fills: [fill, { ...fill, executionDate: "2026-11-14", price: "4" }] };
    const before = serializeSipOccurrenceIntent(context, original);
    for (const changed of [
      { ...context, householdId: "55555555-5555-4555-8555-555555555555" },
      { ...context, planId: "66666666-6666-4666-8666-666666666666" },
      { ...context, scheduledDate: "2026-11-15" },
      { ...context, currency: "USD" },
    ]) expect(serializeSipOccurrenceIntent(changed, original)).not.toBe(before);
    expect(serializeSipOccurrenceIntent(context, { ...original, expectedRevision: 1 })).not.toBe(before);
    expect(serializeSipOccurrenceIntent(context, { ...original, outcome: "filled" })).not.toBe(before);
    expect(serializeSipOccurrenceIntent(context, { ...original, fills: [...original.fills].reverse() })).not.toBe(before);
  });
});
