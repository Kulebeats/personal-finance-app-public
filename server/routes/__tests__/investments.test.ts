import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";
import { investmentService } from "../../modules/investments/investments.service";

vi.mock("../../db", () => ({ db: {} }));

vi.mock("../../middleware/validateEntity", () => ({
  requireRole: () => (_req: Request, _res: Response, next: () => void) =>
    next(),
}));

import router from "../../modules/investments/investments.routes";

function createMockResponse() {
  let resolveJson: (payload: unknown) => void;
  const jsonPromise = new Promise((resolve) => {
    resolveJson = resolve;
  });

  const res = {
    statusCode: 200,
    body: undefined as any,
    status: vi.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function json(this: any, payload: unknown) {
      this.body = payload;
      resolveJson(payload);
      return this;
    }),
    waitForJson: () => jsonPromise,
  };

  return res;
}

async function runRoute(
  method: "get" | "post",
  path: string,
  reqOverrides: Partial<Request>,
) {
  const layer = router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods[method],
  );

  if (!layer || !layer.route) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }

  const handlers = layer.route.stack.map((entry: any) => entry.handle);
  const req = {
    method: method.toUpperCase(),
    path,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    ...reqOverrides,
  } as Request;
  const res = createMockResponse();

  let index = 0;
  let reportFailure!: (error: unknown) => void;
  const failure = new Promise<never>((_resolve, reject) => { reportFailure = reject; });
  const next = (err?: unknown): Promise<unknown> | undefined => {
    if (err) { reportFailure(err); return; }
    const handler = handlers[index++];
    if (!handler) return;
    try { return Promise.resolve(handler(req, res, next)).catch(reportFailure); }
    catch (error) { reportFailure(error); return; }
  };

  await Promise.race([Promise.resolve().then(() => next()).then(() => res.waitForJson()), failure]);
  return res;
}

describe("Investment trade routes", () => {
  it.each([
    { type: "buy" as const, quantity: 10, price: 5, amount: 51, fees: 1 },
    { type: "sell" as const, quantity: 8, price: 20, amount: 160, fees: 0 },
  ])("passes the signed actor and the parsed $type settlement to the FIFO writer", async (trade) => {
    const actor = { householdId: "house-1", userId: "user-1", role: "member" as const };
    const source = {
      accountId: "11111111-1111-4111-8111-111111111111", holdingId: "22222222-2222-4222-8222-222222222222",
      securityId: "33333333-3333-4333-8333-333333333333", transactionDate: "2024-01-01", currency: "ZMW",
    };
    const parsed = { ...source, type: trade.type, quantity: String(trade.quantity), price: String(trade.price),
      amount: String(trade.amount), fees: String(trade.fees) };
    const stored = { ...parsed, id: "44444444-4444-4444-8444-444444444444", householdId: actor.householdId,
      fxRate: null, amountZmw: null, withholdingTax: null, linkedTransactionId: null, notes: null, createdAt: null };
    const write = vi.spyOn(investmentService, "createTransaction").mockResolvedValueOnce(stored);
    try {
      const response = await runRoute("post", "/transactions", { householdContext: actor, body: { ...source, ...trade } });
      expect(response.statusCode).toBe(201);
      expect(response.body.data).toEqual(stored);
      expect(write).toHaveBeenCalledWith(parsed, actor, "127.0.0.1");
    } finally { write.mockRestore(); }
  });
});

describe("Tax lot routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("validates tax lot query params", async () => {
    const res = await runRoute("get", "/tax-lots", {
      householdContext: {
        householdId: "house-1",
        userId: "user-1",
        role: "member",
      },
      query: { limit: "0" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.error?.message).toBe("Invalid tax lot query");
  });

  it("returns tax lots with disposals when requested", async () => {
    const lotId = "66666666-6666-6666-6666-666666666666";
    const holdingId = "22222222-2222-2222-2222-222222222222";
    const securityId = "33333333-3333-3333-3333-333333333333";
    const dispId = "88888888-8888-8888-8888-888888888888";

    const at = new Date("2024-01-01T00:00:00.000Z");
    const data = [{
      id: lotId, householdId: "house-1", holdingId, transactionId: "11111111-1111-1111-1111-111111111111",
      quantity: "1.00000000", costBasis: "50.00", costBasisZmw: null, acquiredDate: "2024-01-01", acquisitionFxRate: null,
      remainingQuantity: "0.00000000", createdAt: at, updatedAt: at,
      holding: { id: holdingId, householdId: "house-1", accountId: "44444444-4444-4444-4444-444444444444", securityId,
        quantity: "0.00000000", costBasis: "0.00", costBasisZmw: null, acquiredDate: "2024-01-01", acquisitionFxRate: null, createdAt: at, updatedAt: at },
      security: { id: securityId, symbol: "ABC", name: "ABC holding", type: "stock" as const, currency: "ZMW", exchange: null,
        isOffshore: false, sector: null, cusipIsin: null, currentPrice: null, lastPriceUpdate: null, withholdingTaxRate: null, ownerHouseholdId: null, createdAt: at, updatedAt: at },
      disposals: [{ id: dispId, householdId: "house-1", holdingId, taxLotId: lotId, transactionId: "77777777-7777-7777-7777-777777777777",
        quantity: "1.00000000", proceeds: "60.00", proceedsZmw: null, costBasis: "50.00", costBasisZmw: null, realizedGain: "10.00", realizedGainZmw: null,
        disposedDate: "2024-02-01", createdAt: at }],
    }];
    const read = vi.spyOn(investmentService, "getTaxLots").mockResolvedValueOnce(data);

    const res = await runRoute("get", "/tax-lots", {
      householdContext: {
        householdId: "house-1",
        userId: "user-1",
        role: "member",
      },
      query: { includeDisposals: "true" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data).toEqual(data);
    expect(read).toHaveBeenCalledWith({ householdId: "house-1", userId: "user-1", role: "member" }, { includeDisposals: true, limit: 100 });
    read.mockRestore();
  });
  it("propagates a protected reader rejection instead of waiting indefinitely for JSON", async () => {
    const read = vi.spyOn(investmentService, "getTaxLots").mockRejectedValueOnce(new Error("Synthetic protected reader failure"));
    try {
      await expect(runRoute("get", "/tax-lots", {
        householdContext: { householdId: "house-1", userId: "user-1", role: "member" }, query: {},
      })).rejects.toThrow("Synthetic protected reader failure");
    } finally { read.mockRestore(); }
  });
});
