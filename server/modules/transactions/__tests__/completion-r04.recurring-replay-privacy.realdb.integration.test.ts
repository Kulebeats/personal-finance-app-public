import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  accounts, auditLogs, householdMembers, merchantAliases, merchants, outboxEvents,
  recurringTransactionLinks, recurringTransactions, transactions,
} from "@shared/schema";
import { db } from "../../../db";
import { transactionRepository } from "../../../repositories/TransactionRepository";
import { transactionService } from "../../../services/TransactionService";
import { isPostgresError } from "../../../utils/postgresError";
import { a, actors, app, b, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const ruleId = randomUUID(), otherRuleId = randomUUID(), destinationId = randomUUID(), merchantId = randomUUID();
const merchantName = "Replay Stored Merchant";
type Path = "pre-hit" | "collision";

function payload(key: string, pointer: string | null) {
  return {
    accountId: destinationId, merchantId, name: "Replay Original Branch", date: "2026-11-02", type: "expense",
    amount: { amount: "7.25", currency: "ZMW" }, recurringTransactionId: pointer ?? undefined, idempotencyKey: key,
  };
}
function post(body: ReturnType<typeof payload>, viewer: Role = "member") {
  return request(app).post("/api/transactions").set("Cookie", actors.get(viewer)!.cookie).send(body);
}
async function createStored(viewer: Role = "member", pointer: string | null = ruleId) {
  const key = randomUUID();
  const body = payload(key, pointer);
  const response = await post(body, viewer).expect(201);
  for (let attempt = 0; attempt < 40; attempt++) {
    const events = await db.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.aggregateId, response.body.data.id));
    if (events.length) return { key, id: response.body.data.id as string, body };
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Expected original create event before replay");
}
async function replay(path: Path, body: ReturnType<typeof payload>, viewer: Role = "member") {
  const lookup = vi.spyOn(transactionRepository, "findByIdempotencyKey");
  const insert = vi.spyOn(transactionRepository, "create");
  // Model a winner committing between the initial lookup and insert. The insert
  // and PostgreSQL unique violation remain real, as does the fallback lookup.
  if (path === "collision") lookup.mockResolvedValueOnce(undefined);
  try {
    const response = await post(body, viewer);
    if (path === "collision") {
      expect(insert).toHaveBeenCalledTimes(1);
      let uniqueViolation = false;
      try { await insert.mock.results[0].value; }
      catch (error) { uniqueViolation = isPostgresError(error, "23505"); }
      expect(uniqueViolation).toBe(true);
      expect(lookup).toHaveBeenCalledTimes(2);
    } else {
      expect(insert).not.toHaveBeenCalled();
    }
    return response;
  } finally {
    lookup.mockRestore();
    insert.mockRestore();
  }
}
async function state() {
  return {
    accounts: await db.select().from(accounts).where(inArray(accounts.id, [destinationId, ids.sharedAccount])).orderBy(accounts.id),
    transactions: await db.select().from(transactions).where(eq(transactions.householdId, a)).orderBy(transactions.id),
    aliases: await db.select().from(merchantAliases).where(eq(merchantAliases.merchantId, merchantId)).orderBy(merchantAliases.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.householdId, a)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(eq(outboxEvents.householdId, a)).orderBy(outboxEvents.id),
    links: await db.select().from(recurringTransactionLinks).where(inArray(recurringTransactionLinks.recurringTransactionId, [ruleId, otherRuleId])).orderBy(recurringTransactionLinks.id),
  };
}
async function clean() {
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, [ruleId, otherRuleId]));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, a));
  await db.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
  await db.delete(merchants).where(eq(merchants.id, merchantId));
  await db.delete(accounts).where(eq(accounts.id, destinationId));
}

describe("idempotent replay authorizes the stored posting and recurring parent", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => {
    await clean();
    await reset();
    await db.insert(accounts).values({ id: destinationId, householdId: a, ownerUserId: actors.get("owner")!.id,
      name: "Replay destination", type: "checking", currency: "ZMW", balance: "1000.00" });
    await db.insert(merchants).values({ id: merchantId, householdId: a, name: merchantName });
    await db.insert(recurringTransactions).values([ruleId, otherRuleId].map(id => ({
      id, householdId: a, accountId: ids.sharedAccount, name: "Replay parent", amount: "12.34", type: "expense" as const,
      frequency: "monthly" as const, startDate: "2026-11-01", nextDueDate: "2026-12-01",
    })));
  });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  for (const path of ["pre-hit", "collision"] as const) {
    it.each(["transaction", "account", "parent", "parent source"] as const)(`${path} conceals a now-private %s when the retry changes or omits its pointer`, async kind => {
      const stored = await createStored();
      if (kind === "transaction") {
        await db.update(transactions).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(transactions.id, stored.id));
      } else if (kind === "account") {
        await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, destinationId));
      } else if (kind === "parent") {
        await db.update(recurringTransactions).set({ accountId: ids.privateAccount }).where(eq(recurringTransactions.id, ruleId));
      } else {
        await db.insert(recurringTransactionLinks).values({ recurringTransactionId: ruleId, transactionId: ids.privateTx });
      }
      const before = await state();
      for (const viewer of ["member", "admin"] as const) {
        for (const pointer of [undefined, otherRuleId]) {
          const body = { ...stored.body, accountId: ids.sharedAccount, name: "Replay Unwanted Alias", recurringTransactionId: pointer };
          const denied = await replay(path, body, viewer);
          expect(denied.status).toBe(404);
          const timestamp = denied.body.error.timestamp;
          expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
          expect(denied.body).toEqual({ success: false, error: {
            code: "NOT_FOUND", message: expect.any(String), timestamp,
          } });
          for (const secret of [stored.id, merchantName, "7.25", ruleId]) expect(denied.body.error.message).not.toContain(secret);
          expect(await state()).toEqual(before);
        }
      }
    });

    it(`${path} returns an unchanged authorized posting without learning retry aliases`, async () => {
      const stored = await createStored();
      const before = await state();
      const body = { ...stored.body, name: "Replay Unwanted Alias", recurringTransactionId: undefined };
      expect((await replay(path, body)).status).toBe(409);
      expect(await state()).toEqual(before);
      const response = await replay(path, stored.body);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ isDuplicate: true, data: { id: stored.id, name: merchantName, recurringTransactionId: ruleId } });
      expect(await state()).toEqual(before);
    });

    it(`${path} still allows the data owner's private account and posting`, async () => {
      const stored = await createStored("owner");
      await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, destinationId));
      await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, stored.id));
      const before = await state();
      expect((await replay(path, { ...stored.body, name: "Replay Unwanted Alias", recurringTransactionId: undefined }, "owner")).status).toBe(409);
      expect(await state()).toEqual(before);
      const response = await replay(path, stored.body, "owner");
      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(stored.id);
      expect(await state()).toEqual(before);
    });
  }

  it.each(["transaction", "account"] as const)("does not replay a soft-deleted %s", async kind => {
    const stored = await createStored();
    if (kind === "transaction") await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, stored.id));
    else await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, destinationId));
    const before = await state();
    expect((await replay("pre-hit", { ...stored.body, accountId: ids.sharedAccount, recurringTransactionId: undefined })).status).toBe(404);
    expect(await state()).toEqual(before);
  });

  it("checks current membership for a service caller while preserving an authorized direct repeat", async () => {
    const stored = await createStored();
    const data = { accountId: destinationId, merchantId, name: stored.body.name, type: "expense" as const,
      date: stored.body.date, amount: "7.25", currency: "ZMW", recurringTransactionId: ruleId };
    const before = await state();
    await expect(transactionService.createTransaction({ ...data, name: "Direct repeat" }, a, actors.get("member")!.id, stored.key))
      .rejects.toMatchObject({ statusCode: 409 });
    const repeated = await transactionService.createTransaction(data, a, actors.get("member")!.id, stored.key);
    expect(repeated).toMatchObject({ isDuplicate: true, transaction: { id: stored.id } });
    expect(await transactionService.createTransaction({ ...data, isRecurring: true }, a, actors.get("member")!.id, stored.key))
      .toMatchObject({ isDuplicate: true, transaction: { id: stored.id, isRecurring: true } });
    await db.delete(householdMembers).where(eq(householdMembers.userId, actors.get("member")!.id));
    await expect(transactionService.createTransaction(data, a, actors.get("member")!.id, stored.key)).rejects.toMatchObject({ statusCode: 404 });
    expect(await state()).toEqual(before);
  });

  it("keeps an authorized ordinary repeat whose stored posting has no recurring parent", async () => {
    const stored = await createStored("member", null);
    const before = await state();
    const response = await replay("pre-hit", stored.body);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ isDuplicate: true, data: { id: stored.id } });
    expect(response.body.data.recurringTransactionId).toBeNull();
    expect(await state()).toEqual(before);
  });

  it("conceals an ordinary key's private recurring parent on the signed transfer route", async () => {
    const stored = await createStored();
    const member = actors.get("member")!;
    await request(app).post("/api/settings/security/step-up").set("Cookie", member.cookie)
      .set("X-Capital-Subject", member.id).set("X-Capital-Household", a).send({ password: "SyntheticR04Tags123!" }).expect(200);
    const transfer = () => request(app).post("/api/transactions/transfer").set("Cookie", member.cookie)
      .set("X-Capital-Subject", member.id).set("X-Capital-Household", a).send({ fromAccountId: ids.sharedAccount,
        toAccountId: destinationId, amount: { amount: "3.00", currency: "ZMW" }, idempotencyKey: stored.key });
    const before = await state();
    await transfer().expect(409);
    expect(await state()).toEqual(before);
    await db.update(recurringTransactions).set({ accountId: ids.privateAccount }).where(eq(recurringTransactions.id, ruleId));
    await transfer().expect(404);
    expect(await state()).toEqual(before);
  });
});
