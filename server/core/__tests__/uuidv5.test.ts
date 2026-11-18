import { describe, it, expect } from "vitest";
import { uuidv5 } from "../uuidv5";
import { recurringOccurrenceKey } from "../../services/recurring/materializationKey";

const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv5", () => {
  it("matches the canonical RFC 4122 vector (example.com in the DNS namespace)", () => {
    // Well-known published value; proves the SHA-1 + version/variant bit-twiddle
    // is correct, not just internally consistent.
    expect(uuidv5("example.com", DNS_NAMESPACE)).toBe(
      "cfbff0d1-9375-5685-968c-48ce8b15ae17",
    );
  });

  it("is deterministic for the same (name, namespace)", () => {
    const a = uuidv5("recurring:rule-1:2024-02-01", DNS_NAMESPACE);
    const b = uuidv5("recurring:rule-1:2024-02-01", DNS_NAMESPACE);
    expect(a).toBe(b);
  });

  it("produces distinct UUIDs for different names", () => {
    const a = uuidv5("recurring:rule-1:2024-02-01", DNS_NAMESPACE);
    const b = uuidv5("recurring:rule-1:2024-03-01", DNS_NAMESPACE);
    const c = uuidv5("recurring:rule-2:2024-02-01", DNS_NAMESPACE);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("emits a well-formed version-5 UUID", () => {
    expect(uuidv5("anything", DNS_NAMESPACE)).toMatch(UUID_RE);
  });

  it("rejects a malformed namespace", () => {
    expect(() => uuidv5("x", "not-a-uuid")).toThrow();
  });
});

describe("recurringOccurrenceKey", () => {
  it("is stable per (ruleId, occurrenceDate) and a valid v5 UUID", () => {
    const ruleId = "11111111-2222-3333-4444-555555555555";
    const key1 = recurringOccurrenceKey(ruleId, "2024-02-01");
    const key2 = recurringOccurrenceKey(ruleId, "2024-02-01");
    expect(key1).toBe(key2);
    expect(key1).toMatch(UUID_RE);
  });

  it("differs across occurrence dates and across rules", () => {
    const ruleA = "11111111-2222-3333-4444-555555555555";
    const ruleB = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const keys = new Set([
      recurringOccurrenceKey(ruleA, "2024-02-01"),
      recurringOccurrenceKey(ruleA, "2024-03-01"),
      recurringOccurrenceKey(ruleB, "2024-02-01"),
    ]);
    expect(keys.size).toBe(3);
  });
});
