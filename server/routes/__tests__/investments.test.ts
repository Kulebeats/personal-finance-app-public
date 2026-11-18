import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";
import {
  investmentTransactions,
  taxLotDisposals,
  taxLots,
} from "@shared/schema";

// Define mock structure in vi.mock factory to avoid hoisting issues
vi.mock("../../db", () => {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      transaction: vi.fn(),
      query: {
        holdings: { findFirst: vi.fn() },
        securities: { findFirst: vi.fn() },
        households: { findFirst: vi.fn() },
      },
    },
  };
});

vi.mock("../../middleware/validateEntity", () => ({
  requireRole: () => (_req: Request, _res: Response, next: () => void) =>
    next(),
}));

vi.mock("../../services/GoalAccountAssignmentService", () => ({
  goalAccountAssignmentService: {
    syncGoalsForAccount: vi.fn(),
  },
}));

// Import the mocked db to get reference to mock functions
import { db } from "../../db";
const mockDb = db as any;

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
  const next = async (err?: unknown) => {
    if (err) throw err;
    const handler = handlers[index++];
    if (!handler) return;
    return handler(req, res, next);
  };

  await next();
  await res.waitForJson();
  return res;
}

function createSelectQuery(
  result: any,
  options: { limitTerminal?: boolean; orderByTerminal?: boolean } = {},
) {
  const query: any = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };

  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);

  if (options.orderByTerminal) {
    query.orderBy.mockResolvedValue(result);
  } else {
    query.orderBy.mockReturnValue(query);
  }

  if (options.limitTerminal) {
    query.limit.mockResolvedValue(result);
  } else {
    query.limit.mockReturnValue(query);
  }

  return query;
}

function createMockTransaction(options: {
  returningByTable?: Map<any, any[]>;
  selectResult?: any[];
  selectResults?: any[][];
}) {
  const insertCalls: Array<{ table: any; values: any }> = [];
  const updateCalls: Array<{ table: any; set: any }> = [];

  const insert = vi.fn((table: any) => ({
    values: vi.fn((values: any) => {
      insertCalls.push({ table, values });
      return {
        returning: vi
          .fn()
          .mockResolvedValueOnce(options.returningByTable?.get(table) ?? []),
      };
    }),
  }));

  const update = vi.fn((table: any) => ({
    set: vi.fn((values: any) => {
      updateCalls.push({ table, set: values });
      return { where: vi.fn().mockResolvedValue(undefined) };
    }),
  }));

  const del = vi.fn(() => ({
    where: vi.fn().mockResolvedValue(undefined),
  }));

  let selectCallIndex = 0;
  const select = vi.fn(() => {
    const query: any = {
      from: vi.fn(),
      where: vi.fn(),
      for: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    };

    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.for.mockReturnValue(query);

    const defaultResult = options.selectResult ?? [];
    const resultForThisCall =
      options.selectResults?.[selectCallIndex] ?? defaultResult;
    selectCallIndex += 1;

    query.orderBy.mockResolvedValue(resultForThisCall);
    query.limit.mockResolvedValue(resultForThisCall);

    return query;
  });

  return {
    tx: { insert, update, delete: del, select },
    insertCalls,
    updateCalls,
  };
}

describe("Investment tax lot handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a tax lot on buy transactions", async () => {
    const accountId = "11111111-1111-1111-1111-111111111111";
    const holdingId = "22222222-2222-2222-2222-222222222222";
    const securityId = "33333333-3333-3333-3333-333333333333";
    const txId = "44444444-4444-4444-4444-444444444444";
    const houseId = "55555555-5555-5555-5555-555555555555";

    const accountQuery = createSelectQuery(
      [{ id: accountId, currency: "ZMW", householdId: houseId }],
      { limitTerminal: true },
    );
    const holdingOwnershipQuery = createSelectQuery([{ id: holdingId }], {
      limitTerminal: true,
    });

    mockDb.select
      .mockReturnValueOnce(accountQuery)
      .mockReturnValueOnce(holdingOwnershipQuery);
    mockDb.query.holdings.findFirst.mockResolvedValueOnce({
      id: holdingId,
      householdId: houseId,
      accountId: accountId,
      securityId: securityId,
      quantity: "5",
      costBasis: "50.00",
      costBasisZmw: "50.00",
      acquisitionFxRate: null,
      security: {
        id: securityId,
        name: "Example Security",
        currency: "ZMW",
      },
    });

    const investmentTx = { id: txId };
    const { tx, insertCalls } = createMockTransaction({
      returningByTable: new Map([[investmentTransactions, [investmentTx]]]),
    });

    mockDb.transaction.mockImplementation(async (callback: any) =>
      callback(tx),
    );

    const res = await runRoute("post", "/transactions", {
      householdContext: {
        householdId: houseId,
        userId: "user-1",
        role: "member",
      },
      body: {
        accountId: accountId,
        holdingId: holdingId,
        securityId: securityId,
        type: "buy",
        quantity: 10,
        price: 5,
        fees: 1,
        currency: "ZMW",
        transactionDate: "2024-01-01",
        amount: 51, // quantity * price + fees
      },
    });

    expect(res.statusCode).toBe(201);

    const taxLotInsert = insertCalls.find((call) => call.table === taxLots);
    expect(taxLotInsert?.values).toMatchObject({
      householdId: houseId,
      holdingId: holdingId,
      transactionId: txId,
      quantity: "10.00000000",
      costBasis: "51.00",
      costBasisZmw: null,
      acquiredDate: "2024-01-01",
      acquisitionFxRate: null,
      remainingQuantity: "10.00000000",
    });
  });

  it("consumes tax lots on sell transactions", async () => {
    const accountId = "11111111-1111-1111-1111-111111111111";
    const holdingId = "22222222-2222-2222-2222-222222222222";
    const securityId = "33333333-3333-3333-3333-333333333333";
    const txId = "44444444-4444-4444-4444-444444444444";
    const houseId = "55555555-5555-5555-5555-555555555555";
    const lot1Id = "66666666-6666-6666-6666-666666666666";
    const lot2Id = "77777777-7777-7777-7777-777777777777";

    const accountQuery = createSelectQuery(
      [{ id: accountId, currency: "ZMW", householdId: houseId }],
      { limitTerminal: true },
    );
    const holdingOwnershipQuery = createSelectQuery([{ id: holdingId }], {
      limitTerminal: true,
    });

    mockDb.select
      .mockReturnValueOnce(accountQuery)
      .mockReturnValueOnce(holdingOwnershipQuery);
    mockDb.query.holdings.findFirst.mockResolvedValueOnce({
      id: holdingId,
      householdId: houseId,
      accountId: accountId,
      securityId: securityId,
      quantity: "10",
      costBasis: "110.00",
      costBasisZmw: "110.00",
      acquisitionFxRate: null,
      security: {
        id: securityId,
        name: "Example Security",
        currency: "ZMW",
      },
    });

    const lots = [
      {
        id: lot1Id,
        householdId: houseId,
        holdingId: holdingId,
        quantity: "5",
        remainingQuantity: "5",
        costBasis: "50.00",
        costBasisZmw: "50.00",
        acquiredDate: "2023-01-01",
        createdAt: new Date("2023-01-01"),
      },
      {
        id: lot2Id,
        householdId: houseId,
        holdingId: holdingId,
        quantity: "5",
        remainingQuantity: "5",
        costBasis: "60.00",
        costBasisZmw: "60.00",
        acquiredDate: "2023-06-01",
        createdAt: new Date("2023-06-01"),
      },
    ];

    const investmentTx = { id: txId };
    const { tx, insertCalls, updateCalls } = createMockTransaction({
      returningByTable: new Map([[investmentTransactions, [investmentTx]]]),
      selectResults: [
        [{ id: holdingId, quantity: "10" }],
        lots,
      ],
    });

    mockDb.transaction.mockImplementation(async (callback: any) =>
      callback(tx),
    );

    const res = await runRoute("post", "/transactions", {
      householdContext: {
        householdId: houseId,
        userId: "user-1",
        role: "member",
      },
      body: {
        accountId: accountId,
        holdingId: holdingId,
        securityId: securityId,
        type: "sell",
        quantity: 8,
        price: 20,
        fees: 0,
        currency: "ZMW",
        transactionDate: "2024-02-01",
        amount: 160, // quantity * price
      },
    });

    expect(res.statusCode).toBe(201);

    const disposalCalls = insertCalls.filter(
      (call) => call.table === taxLotDisposals,
    );
    expect(disposalCalls).toHaveLength(2);
    expect(disposalCalls[0].values).toMatchObject({
      taxLotId: lot1Id,
      quantity: "5.00000000",
      proceeds: "100.00",
      costBasis: "50.00",
      realizedGain: "50.00",
      disposedDate: "2024-02-01",
    });
    expect(disposalCalls[1].values).toMatchObject({
      taxLotId: lot2Id,
      quantity: "3.00000000",
      proceeds: "60.00",
      costBasis: "36.00",
      realizedGain: "24.00",
      disposedDate: "2024-02-01",
    });

    const taxLotUpdates = updateCalls.filter((call) => call.table === taxLots);
    expect(taxLotUpdates).toHaveLength(2);
    expect(taxLotUpdates[0].set).toMatchObject({
      remainingQuantity: "0.00000000",
    });
    expect(taxLotUpdates[1].set).toMatchObject({
      remainingQuantity: "2.00000000",
    });
  });
});

describe("Tax lot routes", () => {
  beforeEach(() => {
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

    const lotsQuery = createSelectQuery(
      [
        {
          lot: {
            id: lotId,
            holdingId: holdingId,
            acquiredDate: "2024-01-01",
            createdAt: new Date("2024-01-01"),
          },
          holding: { id: holdingId, securityId: securityId },
          security: { id: securityId, symbol: "ABC", currency: "ZMW" },
        },
      ],
      { limitTerminal: true },
    );
    const disposalsQuery = createSelectQuery(
      [
        {
          id: dispId,
          taxLotId: lotId,
          quantity: "1.00000000",
          disposedDate: "2024-02-01",
        },
      ],
      { orderByTerminal: true },
    );

    mockDb.select
      .mockReturnValueOnce(lotsQuery)
      .mockReturnValueOnce(disposalsQuery);

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
    expect(res.body.data[0].disposals).toEqual([
      {
        id: dispId,
        taxLotId: lotId,
        quantity: "1.00000000",
        disposedDate: "2024-02-01",
      },
    ]);
  });
});
