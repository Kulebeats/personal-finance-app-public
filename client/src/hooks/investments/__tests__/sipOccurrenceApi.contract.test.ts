import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken, registerStepUpHandler } from "@/lib/api";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import {
  confirmSipOccurrence,
  configureSipHouseholdCalendar,
  listSipOccurrences,
  readSipConfirmationAcknowledgment,
  readSipOccurrenceList,
} from "../sipOccurrenceApi";
import {
  acknowledgment, actualFills, cacheText, closedFence, closedOccurrence, confirmationBody, ids,
  jsonResponse, listEnvelope, pendingOccurrence, privateReference, scheduledDate,
} from "./sipOccurrenceTestFixtures";

// Test-first source preparation: future production module is intentionally absent
// at the test-only commit. No execution/RED result is claimed. Real API helper and
// apiCall are exercised; only fetch is controlled. This is mocked client evidence.
const path = `/api/investments/recurring/${ids.plan}/occurrences`;
let operation: ReturnType<typeof createOperationLifetime>;
let calls: Array<{ url: string; init?: RequestInit }>;
let serve: (url: string, init?: RequestInit) => Promise<Response>;
beforeEach(() => {
  calls = [];
  clearCsrfToken();
  registerStepUpHandler(null);
  operation = createOperationLifetime({ subject: ids.subject, household: ids.household });
  activateOperationLifetime(operation);
  serve = async (_url, init) => jsonResponse(init?.method === "POST" ? acknowledgment() : listEnvelope());
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/csrf-token") return jsonResponse({ csrfToken: "synthetic-csrf" });
    calls.push({ url, init });
    return serve(url, init);
  }));
});
afterEach(() => {
  retireOperationLifetime(operation);
  registerStepUpHandler(null);
  clearCsrfToken();
  vi.unstubAllGlobals();
});
const expected = () => ({ planId: ids.plan, scheduledDate, operationId: ids.operation, request: confirmationBody() });

describe("frozen occurrence response union", () => {
  it("decodes pending, separate actual fills, and the minimal closed fence", () => {
    const data = [pendingOccurrence(), { ...closedOccurrence(), scheduledDate: "2029-12-20" },
      { ...closedFence(), scheduledDate: "2029-11-20" }];
    expect(readSipOccurrenceList(listEnvelope(data), ids.plan)).toEqual(listEnvelope(data));
  });

  it("keeps a purged fence minimal without manufacturing empty purchases or zero totals", () => {
    const result = readSipOccurrenceList(listEnvelope([closedFence()]), ids.plan);
    expect(result.data[0]).toEqual(closedFence());
    expect(Object.keys(result.data[0]).sort()).toEqual(["detailsAvailable", "planId", "scheduledDate", "state"]);
  });

  it.each([
    ["foreign plan", { ...pendingOccurrence(), planId: ids.otherPlan }],
    ["impossible due date", { ...pendingOccurrence(), scheduledDate: "2030-02-30" }],
    ["year zero", { ...pendingOccurrence(), scheduledDate: "0000-01-20" }],
    ["pending revision one", { ...pendingOccurrence(), occurrenceRevision: 1 }],
    ["closed reference echo", { ...closedOccurrence(), brokerReference: privateReference }],
    ["fence with receipt", { ...closedFence(), result: closedOccurrence().result }],
  ])("rejects an unverifiable %s row", (_name, row) => {
    expect(() => readSipOccurrenceList(listEnvelope([row]), ids.plan)).toThrow();
  });

  it("rejects duplicate natural identities and ascending or inconsistent pagination", () => {
    expect(() => readSipOccurrenceList(listEnvelope([pendingOccurrence(), closedFence()]), ids.plan)).toThrow();
    expect(() => readSipOccurrenceList(listEnvelope([
      { ...closedFence(), scheduledDate: "2029-01-20" }, pendingOccurrence(),
    ]), ids.plan)).toThrow();
    expect(() => readSipOccurrenceList({ ...listEnvelope(), pagination: { hasMore: true, nextBefore: null } }, ids.plan)).toThrow();
  });

  it("binds an acknowledgment to the original operation, natural identity and separate fill economics", () => {
    expect(readSipConfirmationAcknowledgment(acknowledgment(), expected())).toEqual(acknowledgment());
    expect(() => readSipConfirmationAcknowledgment(acknowledgment(ids.otherPlan), expected())).toThrow();
    expect(() => readSipConfirmationAcknowledgment(acknowledgment(ids.operation, {
      ...closedOccurrence(), scheduledDate: "2030-02-20",
    }), expected())).toThrow();
    const altered = closedOccurrence();
    altered.result.fills[1].executionDate = "2030-01-22";
    expect(() => readSipConfirmationAcknowledgment(acknowledgment(ids.operation, altered), expected())).toThrow();
  });

  const mutations: Array<{ name: string; change: (row: ReturnType<typeof closedOccurrence>) => void }> = [
    { name: "amount", change: row => { row.result.fills[0].amount = "3.11"; } },
    { name: "totals", change: row => { row.result.totals.amount = "5.23"; } },
    { name: "quantity with coherent changed totals", change: row => {
      row.result.fills[0].quantity = "2.25000000";
      row.result.fills[0].amount = "5.50";
      row.result.totals = { grossAmount: "7.50", fees: "0.12", amount: "7.62" };
    } },
    { name: "price with coherent changed totals", change: row => {
      row.result.fills[0].price = "3.4000";
      row.result.fills[0].amount = "4.35";
      row.result.totals = { grossAmount: "6.35", fees: "0.12", amount: "6.47" };
    } },
    { name: "fees with coherent changed totals", change: row => {
      row.result.fills[0].fees = "0.11";
      row.result.fills[0].amount = "3.11";
      row.result.totals = { grossAmount: "5.10", fees: "0.13", amount: "5.23" };
    } },
    { name: "reordered real fills", change: row => {
      row.result.fills.reverse();
      row.result.fills.forEach((fill, index) => { fill.fillIndex = index; });
    } },
    { name: "duplicate fill indices", change: row => { row.result.fills[1].fillIndex = 0; } },
    { name: "duplicate purchase identities", change: row => { row.result.fills[1].purchaseId = row.result.fills[0].purchaseId; } },
    { name: "case-variant duplicate purchase identities", change: row => {
      row.result.fills[1].purchaseId = row.result.fills[0].purchaseId.toUpperCase();
    } },
    { name: "wrong explicit outcome", change: row => { row.result.outcome = "filled"; } },
    { name: "foreign plan", change: row => { row.planId = ids.otherPlan; } },
  ];
  it.each(mutations)("independently rejects an acknowledgment with changed $name", ({ change }) => {
    expect(readSipConfirmationAcknowledgment(acknowledgment(), expected())).toEqual(acknowledgment());
    const changed = closedOccurrence();
    change(changed);
    expect(() => readSipConfirmationAcknowledgment(acknowledgment(ids.operation, changed), expected())).toThrow();
  });

  it("checks exact aggregate quantity on a coherent closed GET at and just below the storage boundary", () => {
    const closed = closedOccurrence();
    closed.result = {
      outcome: "filled",
      fills: closed.result.fills.map(fill => ({ ...fill, quantity: "5000000000.00000000", price: "0.0001", fees: "0.00", amount: "500000.00" })),
      totals: { grossAmount: "1000000.00", fees: "0.00", amount: "1000000.00" },
    };
    expect(() => readSipOccurrenceList(listEnvelope([closed]), ids.plan)).toThrow();
    closed.result.fills[0].quantity = "4999999999.99999999";
    expect(readSipOccurrenceList(listEnvelope([closed]), ids.plan).data).toEqual([closed]);
  });
});

describe("real occurrence API adapter with controlled transport", () => {
  it("sends only the accepted natural-date confirmation route and exact optional-reference payload", async () => {
    const request = confirmationBody();
    await confirmSipOccurrence(ids.plan, scheduledDate, request, operation);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${path}/${scheduledDate}/confirm`);
    expect(calls[0].init).toMatchObject({ method: "POST", credentials: "include", body: JSON.stringify(request) });
    expect(calls[0].init?.headers).toMatchObject({ "x-csrf-token": "synthetic-csrf" });
    expect(JSON.parse(String(calls[0].init?.body))).not.toHaveProperty("fxRate");
    expect(JSON.parse(String(calls[0].init?.body))).not.toHaveProperty("amountZmw");
  });

  it("omits an absent broker reference without substituting text or null", async () => {
    const { brokerReference: _reference, ...request } = confirmationBody();
    await confirmSipOccurrence(ids.plan, scheduledDate, request, operation);
    expect(JSON.parse(String(calls[0].init?.body))).not.toHaveProperty("brokerReference");
  });

  it("preserves 200 supplied Unicode code points byte-for-byte", async () => {
    const request = { ...confirmationBody(), brokerReference: ` ${"🧾".repeat(198)} ` };
    await confirmSipOccurrence(ids.plan, scheduledDate, request, operation);
    expect(calls[0].init?.body).toBe(JSON.stringify(request));
  });

  it.each([null, "", " \t\n", "x".repeat(201), "\ud800", "\udc00", "x\u0000y"])(
    "rejects an invalid supplied reference before POST without echoing it", async reference => {
      const request = { ...confirmationBody(), brokerReference: reference };
      const caught: unknown = await confirmSipOccurrence(ids.plan, scheduledDate,
        request as Parameters<typeof confirmSipOccurrence>[2], operation).catch(error => error);
      expect(caught).toBeInstanceOf(Error);
      const error = caught as Error & { fields?: unknown; details?: unknown; cause?: unknown };
      const exposed = cacheText({ name: error.name, message: error.message, stack: error.stack,
        fields: error.fields, details: error.details, cause: error.cause });
      if (typeof reference === "string" && reference.length > 0) {
        expect(exposed).not.toContain(reference);
        expect(exposed).not.toContain(JSON.stringify(reference).slice(1, -1));
      }
      expect(calls).toHaveLength(0);
    },
  );

  it("uses keyset pagination without exposing a count or changing the date boundary", async () => {
    serve = async () => jsonResponse(listEnvelope([{ ...closedFence(), scheduledDate: "2029-12-20" }]));
    await listSipOccurrences(ids.plan, { state: "closed", limit: 25, before: "2030-01-01" }, operation);
    const url = new URL(calls[0].url, "https://synthetic.invalid");
    expect(url.pathname).toBe(path);
    expect(Object.fromEntries(url.searchParams)).toEqual({ state: "closed", limit: "25", before: "2030-01-01" });
  });

  it.each(["2030-02-30", "0000-01-20", "2030-1-20", "2030-01-20T00:00:00Z"])(
    "rejects a noncanonical natural date path %s without transport", async date => {
      await expect(confirmSipOccurrence(ids.plan, date, confirmationBody(), operation)).rejects.toThrow();
      expect(calls).toHaveLength(0);
    },
  );

  it("accepts actual dates before the scheduled date without inventing a date cutoff", async () => {
    expect(actualFills[0].executionDate < scheduledDate).toBe(true);
    await expect(confirmSipOccurrence(ids.plan, scheduledDate, confirmationBody(), operation)).resolves.toEqual(acknowledgment());
  });

  it.each([
    ["impossible fill date", { executionDate: "2030-02-30" }],
    ["zero quantity", { quantity: "0.00000000" }],
    ["negative quantity", { quantity: "-1.00000000" }],
    ["excess quantity precision", { quantity: "1.000000001" }],
    ["quantity overflow", { quantity: "10000000000.00000000" }],
    ["zero price", { price: "0.0000" }],
    ["excess price precision", { price: "1.00001" }],
    ["price overflow", { price: "100000000000.0000" }],
    ["blank fees", { fees: "" }],
    ["negative fees", { fees: "-0.01" }],
    ["excess fee precision", { fees: "0.001" }],
  ])("rejects %s without posting any fill", async (_name, change) => {
    const request = confirmationBody();
    request.fills[0] = { ...request.fills[0], ...change };
    await expect(confirmSipOccurrence(ids.plan, scheduledDate, request, operation)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("accepts 100 separate positive sub-cent fills with explicit zero fees and zero rounded amount", async () => {
    const fill = { executionDate: "2030-01-19", quantity: "0.00000001", price: "0.0001", fees: "0.00" };
    const request = { ...confirmationBody(), outcome: "filled" as const, fills: Array.from({ length: 100 }, () => ({ ...fill })) };
    const closed = closedOccurrence();
    closed.result = { outcome: "filled", fills: request.fills.map((entry, fillIndex) => ({
      ...entry, fillIndex, purchaseId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(fillIndex + 1).padStart(12, "0")}`, amount: "0.00",
    })), totals: { grossAmount: "0.00", fees: "0.00", amount: "0.00" } };
    serve = async () => jsonResponse(acknowledgment(ids.operation, closed));
    const result = await confirmSipOccurrence(ids.plan, scheduledDate, request, operation);
    expect(JSON.parse(String(calls[0].init?.body)).fills).toEqual(request.fills);
    expect(result.data.occurrence.result.outcome).toBe("filled");
    expect(result.data.occurrence.result.fills).toHaveLength(100);
  });

  it("rejects 101 fills as one unchanged request instead of truncating or splitting", async () => {
    const request = { ...confirmationBody(), fills: Array.from({ length: 101 }, () => ({ ...actualFills[0] })) };
    const original = JSON.stringify(request);
    await expect(confirmSipOccurrence(ids.plan, scheduledDate, request, operation)).rejects.toThrow();
    expect(JSON.stringify(request)).toBe(original);
    expect(calls).toHaveLength(0);
  });

  it("accepts explicit final unfilled closure with zero purchases", async () => {
    const request = { ...confirmationBody(), outcome: "unfilled" as const, fills: [] };
    const closed = closedOccurrence();
    closed.result = { outcome: "unfilled", fills: [], totals: { grossAmount: "0.00", fees: "0.00", amount: "0.00" } };
    serve = async () => jsonResponse(acknowledgment(ids.operation, closed));
    await expect(confirmSipOccurrence(ids.plan, scheduledDate, request, operation)).resolves.toEqual(acknowledgment(ids.operation, closed));
  });

  it.each([
    { outcome: "unfilled", fills: actualFills },
    { outcome: "filled", fills: [] },
    { outcome: "partially_filled", fills: [] },
    { finalStatement: false },
  ])("rejects contradictory or nonfinal closure intent %j", async change => {
    const request = { ...confirmationBody(), ...change };
    await expect(confirmSipOccurrence(ids.plan, scheduledDate,
      request as Parameters<typeof confirmSipOccurrence>[2], operation)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("preserves the same serialized command through CSRF and step-up resends", async () => {
    let attempt = 0;
    registerStepUpHandler(async () => true);
    serve = async () => {
      attempt++;
      if (attempt === 1) return jsonResponse({ success: false, error: { code: "CSRF_INVALID", message: "Refresh credentials" } }, 403);
      if (attempt === 2) return jsonResponse({ success: false, error: { code: "STEP_UP_REQUIRED", message: "Verify identity" } }, 401);
      return jsonResponse(acknowledgment());
    };
    await confirmSipOccurrence(ids.plan, scheduledDate, confirmationBody(), operation);
    expect(calls).toHaveLength(3);
    expect(calls.map(call => call.init?.body)).toEqual(Array(3).fill(JSON.stringify(confirmationBody())));
  });

  it("exposes safe indexed server validation without reference echo", async () => {
    serve = async () => jsonResponse({ success: false, error: { code: "VALIDATION_ERROR", message: "Review fill inputs",
      fields: { "fills.1.quantity": ["Enter a positive quantity"] } } }, 400);
    await expect(confirmSipOccurrence(ids.plan, scheduledDate, confirmationBody(), operation)).rejects.toMatchObject({
      status: 400, code: "VALIDATION_ERROR", fields: { "fills.1.quantity": ["Enter a positive quantity"] },
    });
  });

  it("decodes the mounted backend's validation descriptors without exposing their messages or unknown fields", async () => {
    serve = async () => jsonResponse({ success: false, error: {
      code: "VALIDATION_ERROR", message: privateReference,
      fields: [
        { field: "fills.1.executionDate", message: privateReference, code: "custom" },
        { field: "fills.1.quantity", message: privateReference },
        { field: "brokerReference", message: privateReference },
        { field: "debugToken", message: privateReference }, { field: 123 }, null,
      ],
      details: { reference: privateReference },
    } }, 400);
    const caught: unknown = await confirmSipOccurrence(ids.plan, scheduledDate,
      confirmationBody(), operation).catch(error => error);
    expect(caught).toMatchObject({ status: 400, code: "VALIDATION_ERROR", fields: {
      "fills.1.executionDate": ["Enter a real execution date in YYYY-MM-DD format"],
      "fills.1.quantity": ["Enter a positive quantity"],
      brokerReference: ["Review the optional reference"],
    } });
    expect((caught as { fields: object }).fields).not.toHaveProperty("debugToken");
    expect(cacheText(caught)).not.toContain(privateReference);
    expect(caught).not.toHaveProperty("details");
    expect(caught).not.toHaveProperty("cause");
  });

  it("retains safe calendar feedback from the backend's descriptor array", async () => {
    serve = async () => jsonResponse({ success: false, error: { code: "VALIDATION_ERROR",
      message: privateReference, fields: [{ field: "timeZone", message: privateReference, code: "custom" }],
    } }, 400);
    const caught: unknown = await configureSipHouseholdCalendar("Europe/London", operation).catch(error => error);
    expect(caught).toMatchObject({ status: 400, code: "VALIDATION_ERROR",
      fields: { timeZone: ["Select a supported named household time zone"] } });
    expect(cacheText(caught)).not.toContain(privateReference);
  });

  it("projects nonenumerable Error message, stack and nested cause in the privacy oracle", () => {
    const error = new Error(privateReference);
    Object.defineProperty(error, "cause", { value: new Error(`${privateReference}-CAUSE`), enumerable: false });
    const exposed = cacheText(error);
    expect(exposed).toContain(privateReference);
    expect(exposed).toContain(`${privateReference}-CAUSE`);
    expect(exposed).toContain("stack");
  });

  it("sanitizes reference-bearing structured server errors before the caller can cache or announce them", async () => {
    const reference = 'SYNTHETIC-🧾-"-\\-PRIVATE';
    const escaped = JSON.stringify(reference).slice(1, -1);
    serve = async () => jsonResponse({ success: false, error: {
      code: "VALIDATION_ERROR", message: `Rejected ${reference} ${escaped}`,
      fields: { "fills.1.quantity": [reference, escaped] }, details: { reference, escaped },
    } }, 400);
    const caught: unknown = await confirmSipOccurrence(ids.plan, scheduledDate,
      { ...confirmationBody(), brokerReference: reference }, operation).catch(error => error);
    expect(caught).toMatchObject({ status: 400, code: "VALIDATION_ERROR",
      fields: { "fills.1.quantity": ["Enter a positive quantity"] } });
    const exposed = cacheText(caught);
    expect(exposed).not.toContain(reference);
    expect(exposed).not.toContain(escaped);
    expect(caught).not.toHaveProperty("details");
    expect(caught).not.toHaveProperty("cause");
  });

  it("replaces reference-bearing transport errors and nonenumerable causes without retaining the original error", async () => {
    serve = async () => {
      const error = new Error(privateReference);
      Object.defineProperty(error, "cause", { value: new Error(privateReference), enumerable: false });
      throw error;
    };
    const caught: unknown = await confirmSipOccurrence(ids.plan, scheduledDate, confirmationBody(), operation).catch(error => error);
    expect(caught).toBeInstanceOf(Error);
    expect(cacheText(caught)).not.toContain(privateReference);
    expect(caught).not.toHaveProperty("cause");
  });
});
