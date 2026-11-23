/**
 * SCP-320: Transfer concurrency, overdraft, and idempotency — REAL DB.
 *
 * The transfer write path previously (a) checked idempotency OUTSIDE any
 * transaction, (b) acquired NO row locks, and (c) had NO overdraft guard. Two
 * concurrent transfers from the same account could therefore both read the same
 * balance and both succeed — a double-spend — and a retried request with the same
 * idempotency key could race past the out-of-txn check and create a second pair.
 *
 * The fix locks BOTH accounts FOR UPDATE (consistent id order, deadlock-safe),
 * runs the idempotency check and overdraft guard INSIDE that transaction, and
 * returns `isDuplicate` from the repository.
 *
 * These tests run two genuinely concurrent service calls against real Postgres,
 * so the row locks are actually exercised — a mocked tx would prove nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { db, pool } from "../../db";
import { eq } from "drizzle-orm";
import {
  accounts,
  transactions,
  users,
  households,
  householdMembers,
} from "@shared/schema";
import { transactionService } from "../TransactionService";
import { transferService } from "../TransferService";
import { TransferCreateRequest } from "../TransferCreateRequest";
import { Money } from "../../core/money";
import { transactionTransferRepository } from "../../repositories/TransactionTransferRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { transactionCreateOwnerIntents } from "@shared/schema";
import { ValidationError } from "../../utils/errorHandler";
import {
  createTestUser,
  createTestHousehold,
} from "../../__tests__/fixtures";

describe("Transfer concurrency / overdraft / idempotency (SCP-320)", () => {
  let householdId: string;
  let userId: string;

  beforeAll(async () => {
    const user = createTestUser({
      email: `scp320-${Date.now()}@example.com`,
      username: `scp320-${Date.now()}`,
    });
    const hh = createTestHousehold(user.id, { name: `scp320-${Date.now()}` });
    householdId = hh.id;
    userId = user.id;

    await db.insert(households).values({
      id: hh.id,
      name: hh.name,
      currency: hh.currency,
    });
    await db.insert(users).values({
      id: user.id,
      email: user.email,
      username: user.username,
      passwordHash: user.passwordHash,
      fullName: user.fullName,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      if (householdId) {
        await tx.delete(transactions).where(eq(transactions.householdId, householdId));
        await tx.delete(accounts).where(eq(accounts.householdId, householdId));
      }
      if (userId) await tx.delete(users).where(eq(users.id, userId));
      if (householdId) await tx.delete(households).where(eq(households.id, householdId));
    });
  });

  /** Seed a fresh source/dest account pair for one scenario. */
  async function seedPair(opts: {
    sourceBalance: string;
    sourceIsAsset?: boolean;
  }): Promise<{ fromId: string; toId: string }> {
    const fromId = randomUUID();
    const toId = randomUUID();
    await db.insert(accounts).values([
      {
        id: fromId,
        householdId,
        name: `src-${fromId.slice(0, 8)}`,
        type: opts.sourceIsAsset === false ? "credit" : "checking",
        balance: opts.sourceBalance,
        currency: "ZMW",
        isAsset: opts.sourceIsAsset ?? true,
      },
      {
        id: toId,
        householdId,
        name: `dst-${toId.slice(0, 8)}`,
        type: "checking",
        balance: "0.00",
        currency: "ZMW",
        isAsset: true,
      },
    ]);
    return { fromId, toId };
  }

  const balanceOf = async (id: string): Promise<string> => {
    const [row] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    return row.balance;
  };

  const transferRowCount = async (accountId: string): Promise<number> =>
    (
      await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, accountId))
    ).length;

  const transferRowsForAccount = async (accountId: string) =>
    await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, accountId));

  it("prevents a double-spend when two transfers race an insufficient balance", async () => {
    // Source has exactly 100; two concurrent transfers of 100 each are attempted.
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });

    const results = await Promise.allSettled([
      transferService.createTransfer(fromId, toId, "100.00", householdId, userId, {
        name: "race-A",
      }),
      transferService.createTransfer(fromId, toId, "100.00", householdId, userId, {
        name: "race-B",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one succeeds; the other is rejected for insufficient funds.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectedReason).toBeInstanceOf(ValidationError);

    // No double-spend: source drained to exactly 0, destination got exactly 100.
    expect(await balanceOf(fromId)).toBe("0.00");
    expect(await balanceOf(toId)).toBe("100.00");

    // Only ONE transfer pair was persisted (one outflow row on the source).
    expect(await transferRowCount(fromId)).toBe(1);
    expect(await transferRowCount(toId)).toBe(1);
  });

  it("R08 zero-debt credit funding creates positive debt and one linked transfer pair", async () => {
    const { fromId, toId } = await seedPair({
      sourceBalance: "0.00",
      sourceIsAsset: false,
    });

    const result = await transferService.createTransfer(
      fromId,
      toId,
      "100.00",
      householdId,
      userId,
      { name: "credit-draw" },
    );

    expect(result.isDuplicate).toBe(false);
    expect.soft(await balanceOf(fromId)).toBe("100.00");
    expect.soft(await balanceOf(toId)).toBe("100.00");

    const fromRows = await transferRowsForAccount(fromId);
    const toRows = await transferRowsForAccount(toId);
    expect(fromRows).toHaveLength(1);
    expect(toRows).toHaveLength(1);
    expect(result.outflow.id).not.toBe(result.inflow.id);
    expect(result.outflow.transferTransactionId).toEqual(expect.any(String));
    expect(fromRows[0]).toMatchObject({
      id: result.outflow.id,
      householdId,
      accountId: fromId,
      transferAccountId: toId,
      transferTransactionId: result.outflow.transferTransactionId,
      type: "transfer",
      isTransferIn: false,
      amount: "100.00",
      currency: "ZMW",
      deletedAt: null,
    });
    expect(toRows[0]).toMatchObject({
      id: result.inflow.id,
      householdId,
      accountId: toId,
      transferAccountId: fromId,
      transferTransactionId: result.outflow.transferTransactionId,
      type: "transfer",
      isTransferIn: true,
      amount: "100.00",
      currency: "ZMW",
      deletedAt: null,
    });
  });

  it("records and reverses an FX debt repayment in each locked account’s own currency", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
    await db.update(accounts).set({ type: "credit", isAsset: false, currency: "USD", balance: "30.00" }).where(eq(accounts.id, toId));
    const pair = await transferService.createTransfer(fromId, toId, "10.00", householdId, userId, { currency: "ZMW", fxRate: "2" });
    expect(pair.outflow).toMatchObject({ currency: "ZMW", postedBalanceDelta: "-10.00", postedAccountIsAsset: true });
    expect(pair.inflow).toMatchObject({ currency: "USD", amount: "20.00", postedBalanceDelta: "-20.00", postedAccountIsAsset: false });
    expect(await balanceOf(fromId)).toBe("90.00");
    expect(await balanceOf(toId)).toBe("10.00");
    const changed = await transferService.updateTransfer(pair.outflow.id,
      { fromAccountId: fromId, toAccountId: toId, amount: "15.00", fxRate: 2 }, householdId, userId);
    expect(changed.outflow.postedBalanceDelta).toBe("-15.00");
    expect(changed.inflow.postedBalanceDelta).toBe("-30.00");
    expect(await balanceOf(fromId)).toBe("85.00");
    expect(await balanceOf(toId)).toBe("0.00");
    await transactionTransferRepository.softDeleteTransferPair(pair.outflow.transferTransactionId!, householdId);
    expect(await balanceOf(fromId)).toBe("100.00");
    expect(await balanceOf(toId)).toBe("30.00");
  });

  it.each(["missing receipt", "spent inflow", "broken pair"] as const)("cannot partially reverse a transfer with %s", async problem => {
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
    const pair = await transferService.createTransfer(fromId, toId, "20.00", householdId, userId);
    if (problem === "missing receipt") {
      await db.update(transactions).set({ postingMode: null, postedAccountIsAsset: null, postedBalanceDelta: null })
        .where(eq(transactions.id, pair.inflow.id));
    } else if (problem === "spent inflow") {
      await db.update(accounts).set({ balance: "5.00" }).where(eq(accounts.id, toId));
    } else {
      await db.update(transactions).set({ transferAccountId: null }).where(eq(transactions.id, pair.outflow.id));
    }
    const state = async () => ({ accounts: [await balanceOf(fromId), await balanceOf(toId)],
      legs: [...await transferRowsForAccount(fromId), ...await transferRowsForAccount(toId)] });
    const before = await state();
    await expect(transactionTransferRepository.softDeleteTransferPair(pair.outflow.transferTransactionId!, householdId)).rejects.toThrow();
    expect(await state()).toEqual(before);
    await expect(transferService.updateTransfer(pair.outflow.id, { fromAccountId: fromId, toAccountId: toId, amount: "1.00" },
      householdId, userId)).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it("treats a concurrent retry with the same idempotency key as one transfer", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "1000.00" });
    // transactions.idempotencyKey is a uuid column — the key must be a bare UUID.
    const idempotencyKey = randomUUID();

    const results = await Promise.all([
      transferService.createTransfer(fromId, toId, "100.00", householdId, userId, {
        name: "same request",
        idempotencyKey,
      }),
      transferService.createTransfer(fromId, toId, "100.00", householdId, userId, {
        name: "same request",
        idempotencyKey,
      }),
    ]);

    // One genuine create, one idempotent replay; both resolve to the same pair.
    const duplicates = results.filter((r) => r.isDuplicate);
    const originals = results.filter((r) => !r.isDuplicate);
    expect(originals).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
    expect(results[0].outflow.transferTransactionId).toBe(
      results[1].outflow.transferTransactionId,
    );

    // The balance moved exactly once (100, not 200), proving no second pair.
    expect(await balanceOf(fromId)).toBe("900.00");
    expect(await balanceOf(toId)).toBe("100.00");
    expect(await transferRowCount(fromId)).toBe(1);
  });

  it("refuses a peer's read, replay, edit and delete through the visible end of a private transfer", async () => {
    const peer = randomUUID();
    await db.insert(users).values({ id: peer, username: "r08-" + peer, email: peer + "@example.invalid", passwordHash: "synthetic" });
    try {
      await db.insert(householdMembers).values({ householdId, userId: peer, role: "member" });
      const pair = await seedPair({ sourceBalance: "100.00" });
      const publicPair = await seedPair({ sourceBalance: "100.00" });
      await db.update(accounts).set({ isPrivate: true, ownerUserId: userId }).where(eq(accounts.id, pair.toId));
      const key = randomUUID();
      const saved = await transferService.createTransfer(pair.fromId, pair.toId, "10.00", householdId, userId, { idempotencyKey: key });
      const before = await Promise.all([pair.fromId, pair.toId, publicPair.toId].map(balanceOf));
      await expect(transactionService.getTransferPair(saved.outflow.id, householdId, peer)).rejects.toMatchObject({ statusCode: 404 });
      await expect(transferService.createTransfer(publicPair.fromId, publicPair.toId, "10.00", householdId, peer,
        { idempotencyKey: key })).rejects.toMatchObject({ statusCode: 404 });
      await expect(transferService.updateTransfer(saved.outflow.id, { fromAccountId: pair.fromId, toAccountId: publicPair.toId,
        amount: "20.00" }, householdId, peer)).rejects.toMatchObject({ statusCode: 404 });
      await expect(transactionService.deleteTransaction(saved.outflow.id, householdId, peer)).rejects.toMatchObject({ statusCode: 404 });
      expect(await Promise.all([pair.fromId, pair.toId, publicPair.toId].map(balanceOf))).toEqual(before);
      expect((await transactionService.getTransferPair(saved.outflow.id, householdId, userId)).inflow.id).toBe(saved.inflow.id);
    } finally { await db.delete(users).where(eq(users.id, peer)); }
  });

  it("rejects same-key replays with a changed source account or amount without changing either balance", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
    const other = await seedPair({ sourceBalance: "100.00" });
    const key = randomUUID();
    await transferService.createTransfer(fromId, toId, "10.00", householdId, userId, { idempotencyKey: key });
    const snapshot = () => Promise.all([fromId, toId, other.fromId, other.toId].map(balanceOf));
    const before = await snapshot();
    expect(before).toEqual(["90.00", "10.00", "100.00", "0.00"]);
    await expect(transferService.createTransfer(other.fromId, other.toId, "10.00", householdId, userId,
      { idempotencyKey: key })).rejects.toMatchObject({ statusCode: 409 });
    await expect(transferService.createTransfer(fromId, toId, "20.00", householdId, userId,
      { idempotencyKey: key })).rejects.toMatchObject({ statusCode: 409 });
    expect(await snapshot()).toEqual(before);
    expect(await transferRowCount(other.fromId)).toBe(0);
  });

  it("checks the stored FX pair before requiring a quote on an existing key", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
    await db.update(accounts).set({ currency: "USD" }).where(eq(accounts.id, fromId));
    const key = randomUUID();
    const create = (rate?: string, source = "manual") => transferService.createTransfer(
      fromId, toId, "1.00", householdId, userId, { idempotencyKey: key, fxRate: rate, fxSource: source });
    const first = await create("20.001");
    expect((await create("20.0010")).inflow.id).toBe(first.inflow.id);
    // Both rates round this one-dollar destination leg to the same amount.
    await expect(create("20.002")).rejects.toMatchObject({ statusCode: 409 });
    await expect(create("20.001", "different quote")).rejects.toMatchObject({ statusCode: 409 });
    await expect(create()).rejects.toMatchObject({ statusCode: 409 });
    expect(await balanceOf(toId)).toBe("20.00");
    await db.update(accounts).set({ isPrivate: true, ownerUserId: null }).where(eq(accounts.id, toId));
    await expect(create()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuses a USD request prepared as a same-currency ZMW pair", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
    const key = randomUUID();
    await db.update(accounts).set({ currency: "USD" }).where(eq(accounts.id, fromId));
    const post = async () => {
      const prepared = await TransferCreateRequest.prepare(fromId, toId, new Money("10.00"), householdId, userId,
        "ZMW", "ZMW", { currency: "USD", fxRate: "20", idempotencyKey: key });
      return transactionRepository.createTransfer(fromId, toId, "10.00", prepared);
    };
    await expect(post()).rejects.toMatchObject({ statusCode: 400 });
    expect(await Promise.all([fromId, toId].map(balanceOf))).toEqual(["100.00", "0.00"]);
    expect(await transferRowCount(fromId)).toBe(0);
    expect(await db.select().from(transactionCreateOwnerIntents).where(eq(transactionCreateOwnerIntents.idempotencyKey, key))).toEqual([]);
  });

  it("rejects unsupported transfer amount spellings before creating or recognizing a key", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
    const key = randomUUID();
    const create = (amount: string) => transferService.createTransfer(fromId, toId, amount, householdId, userId, { idempotencyKey: key });
    for (const amount of ["10.001", "1e1"]) await expect(create(amount)).rejects.toMatchObject({ statusCode: 400 });
    expect(await transferRowCount(fromId)).toBe(0);
    const first = await create("10.00");
    expect((await create("010.0")).outflow.id).toBe(first.outflow.id);
    for (const amount of ["10.001", "1e1"]) await expect(create(amount)).rejects.toMatchObject({ statusCode: 400 });
    expect(await balanceOf(fromId)).toBe("90.00");
  });

  it("requires a positive FX rate representable as numeric(18,8) on both transfer entry points", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "2000000000.00" });
    await db.update(accounts).set({ currency: "USD" }).where(eq(accounts.id, fromId));
    const key = randomUUID();
    for (const fxRate of ["0.000000001", "10000000000", "0"]) {
      await expect(transferService.createTransfer(fromId, toId, "1000000000.00", householdId, userId,
        { fxRate, idempotencyKey: key })).rejects.toMatchObject({ statusCode: 400 });
      await expect(transactionRepository.createTransfer(fromId, toId, "1000000000.00",
        { householdId, ownerUserId: userId, date: "2026-02-12", currency: "USD", destinationCurrency: "ZMW",
          destinationAmount: "1.00", fxRate, idempotencyKey: key })).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(await transferRowCount(fromId)).toBe(0);
    const first = await transferService.createTransfer(fromId, toId, "1000000000.00", householdId, userId,
      { fxRate: "0.00000001", idempotencyKey: key });
    expect(first.inflow).toMatchObject({ amount: "10.00", fxRate: "0.00000001" });
    expect(await Promise.all([fromId, toId].map(balanceOf))).toEqual(["1000000000.00", "10.00"]);
  });

  it.each([false, true])("checks both visible accounts together before a quote (keyed=%s)", async keyed => {
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
    await db.update(accounts).set({ currency: "USD" }).where(eq(accounts.id, fromId));
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [[fromId, toId]]);
      const { rows: [backend] } = await locker.query("SELECT pg_backend_pid() AS pid");
      const pending = transferService.createTransfer(fromId, toId, "10.00", householdId, userId,
        keyed ? { idempotencyKey: randomUUID() } : undefined).then(() => 201, (error: { statusCode: number }) => error.statusCode);
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        const { rows: [row] } = await pool.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting", [backend.pid]);
        waiting = row.waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      await locker.query("UPDATE accounts SET is_private=true,owner_user_id=NULL WHERE id=$1", [fromId]);
      await locker.query("COMMIT");
      expect(await pending).toBe(404);
      expect(waiting).toBe(true);
      expect(await transferRowCount(fromId)).toBe(0);
    } finally {
      try { await locker.query("ROLLBACK"); } finally { locker.release(); }
    }
  });

  it("recognizes the same private transfer actor across UUID spellings", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
    await db.update(accounts).set({ isPrivate: true, ownerUserId: userId }).where(eq(accounts.id, fromId));
    const key = randomUUID();
    const first = await transferService.createTransfer(fromId, toId, "10.00", householdId, userId, { idempotencyKey: key });
    expect(await transferService.createTransfer(fromId.toUpperCase(), toId.toUpperCase(), "10", householdId.toUpperCase(),
      userId.toUpperCase(), { idempotencyKey: key.toUpperCase() })).toMatchObject({ isDuplicate: true, outflow: { id: first.outflow.id } });
    const raw = { householdId: householdId.toUpperCase(), ownerUserId: userId.toUpperCase(), date: "2026-02-12", idempotencyKey: randomUUID() };
    expect((await transactionRepository.createTransfer(fromId, toId, "1.00", raw)).isDuplicate).toBe(false);
    expect((await transactionRepository.createTransfer(fromId, toId, "1.00", { ...raw, ownerUserId: userId })).isDuplicate).toBe(true);
    expect(await balanceOf(fromId)).toBe("89.00");
  });

  it("keeps the original request after a transfer changes accounts and checks visibility of the new pair", async () => {
    const original = await seedPair({ sourceBalance: "100.00" }), moved = await seedPair({ sourceBalance: "200.00" });
    const options = { idempotencyKey: randomUUID(), date: "2026-02-12" };
    const create = () => transferService.createTransfer(original.fromId, original.toId, "10.00", householdId, userId, options);
    const first = await create();
    await transferService.updateTransfer(first.outflow.id, { fromAccountId: moved.fromId, toAccountId: moved.toId,
      amount: "15.00" }, householdId, userId);
    expect(await create()).toMatchObject({ isDuplicate: true, outflow: { id: first.outflow.id, accountId: moved.fromId },
      inflow: { id: first.inflow.id, accountId: moved.toId } });
    expect(await Promise.all([original.fromId, original.toId, moved.fromId, moved.toId].map(balanceOf)))
      .toEqual(["100.00", "0.00", "185.00", "15.00"]);
    await db.update(accounts).set({ isPrivate: true, ownerUserId: null }).where(eq(accounts.id, moved.toId));
    await expect(create()).rejects.toMatchObject({ statusCode: 404 });
  });

  it("snapshots direct repository terms and rejects a malformed equivalent amount", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
    const args = { householdId, ownerUserId: userId, date: "2026-02-12", idempotencyKey: randomUUID(), notes: "original" };
    const first = transactionRepository.createTransfer(fromId, toId, "10.00", args);
    args.notes = "changed";
    expect((await first).outflow.notes).toBe("original");
    await expect(transactionRepository.createTransfer(fromId, toId, "10.00", args)).rejects.toMatchObject({ statusCode: 409 });
    args.notes = "original";
    expect((await transactionRepository.createTransfer(fromId, toId, "10.0", args)).isDuplicate).toBe(true);
    await expect(transactionRepository.createTransfer(fromId, toId, "1e1", args)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("retains legacy amount and account replay without attaching original terms", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
    const first = await transferService.createTransfer(fromId, toId, "9.00", householdId, userId);
    const key = randomUUID();
    await db.update(transactions).set({ idempotencyKey: key }).where(eq(transactions.id, first.outflow.id));
    expect(await transferService.createTransfer(fromId, toId, "9.00", householdId, userId,
      { idempotencyKey: key, name: "Older clients could change metadata" })).toMatchObject({ isDuplicate: true, outflow: { id: first.outflow.id } });
    await expect(transferService.createTransfer(fromId, toId, "10.00", householdId, userId, { idempotencyKey: key }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await db.select().from(transactionCreateOwnerIntents).where(eq(transactionCreateOwnerIntents.transactionId, first.outflow.id))).toEqual([]);
    await transferService.updateTransfer(first.outflow.id, { fromAccountId: fromId, toAccountId: toId, amount: "12.00" }, householdId, userId);
    for (const amount of ["9.00", "12.00"]) {
      await expect(transferService.createTransfer(fromId, toId, amount, householdId, userId, { idempotencyKey: key }))
        .rejects.toMatchObject({ statusCode: 409 });
    }
    expect(await Promise.all([fromId, toId].map(balanceOf))).toEqual(["88.00", "12.00"]);
  });

  it.each(["missing", "nonreciprocal", "other transaction", "refresh foreign row", "foreign accounts", "temp lock shadow"] as const)(
    "rejects a raw transfer reservation with a %s inflow", async scenario => {
      const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
      const key = randomUUID(), outflow = randomUUID(), inflow = randomUUID(), group = randomUUID();
      const foreign = scenario === "foreign accounts" ? randomUUID() : undefined;
      if (foreign) {
        await db.insert(households).values({ id: foreign, name: "Transfer evidence foreign household" });
        await db.update(accounts).set({ householdId: foreign }).where(eq(accounts.id, fromId));
        await db.update(accounts).set({ householdId: foreign }).where(eq(accounts.id, toId));
      }
      const writer = await pool.connect(), other = await pool.connect();
      const insertLeg = (client: typeof writer, incoming: boolean) => client.query(
        `INSERT INTO transactions (id, household_id, owner_user_id, account_id, transfer_account_id,
          transfer_transaction_id, is_transfer_in, idempotency_key, type, name, date, amount, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'transfer','Raw pair','2026-01-10','1.00','ZMW')`,
        [incoming ? inflow : outflow, householdId, userId, incoming ? toId : fromId,
          incoming && scenario !== "nonreciprocal" ? fromId : toId, group, incoming, incoming ? null : key]);
      try {
        await writer.query("BEGIN");
        await writer.query(`INSERT INTO transaction_create_owner_intents
          (transaction_id,idempotency_key,household_id,actor_user_id,owner_selected,operation,request_digest,transfer_group_id,transfer_inflow_id)
          VALUES ($1,$2,$3,$4,false,'transfer',$5,$6,$7)`, [outflow,key,householdId,userId,"t1:"+"0".repeat(64),group,inflow]);
        await insertLeg(writer, false);
        if (scenario === "nonreciprocal" || scenario === "foreign accounts") await insertLeg(writer, true);
        if (scenario === "other transaction" || scenario === "refresh foreign row" || scenario === "temp lock shadow") await insertLeg(other, true);
        if (scenario === "temp lock shadow") {
          await writer.query("CREATE TEMP TABLE pg_locks ON COMMIT DROP AS SELECT * FROM pg_catalog.pg_locks WITH NO DATA");
          await writer.query(`INSERT INTO pg_temp.pg_locks (locktype,transactionid,pid,mode,granted)
            SELECT 'transactionid', xmin, pg_backend_pid(), 'ExclusiveLock', true FROM public.transactions WHERE id=$1`, [inflow]);
        }
        if (scenario === "refresh foreign row") {
          await expect(writer.query("UPDATE transactions SET name='refreshed' WHERE id=$1", [inflow])).rejects.toMatchObject({ code: "23514" });
        } else {
          await expect(writer.query("COMMIT")).rejects.toMatchObject({
            code: scenario === "missing" || scenario === "foreign accounts" ? expect.stringMatching(/^235(03|14)$/) : "23514" });
        }
      } finally {
        try { await writer.query("ROLLBACK"); }
        finally {
          writer.release(); other.release();
          if (foreign) {
            await db.update(accounts).set({ householdId }).where(eq(accounts.householdId, foreign));
            await db.delete(households).where(eq(households.id, foreign));
          }
        }
      }
      expect((await pool.query("SELECT id FROM transactions WHERE id=$1", [outflow])).rows).toEqual([]);
      expect((await pool.query("SELECT transaction_id FROM transaction_create_owner_intents WHERE transaction_id=$1", [outflow])).rows).toEqual([]);
      expect(await Promise.all([fromId, toId].map(balanceOf))).toEqual(["100.00", "0.00"]);
    });

  it("rejects third grouped rows on a second connection before the reserved pair commits", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "100.00" });
    const key = randomUUID(), outflow = randomUUID(), inflow = randomUUID(), group = randomUUID();
    const writer = await pool.connect(), third = await pool.connect();
    const insert = (client: typeof writer, id: string, kind: string, incoming: boolean | null) => client.query(
      `INSERT INTO transactions (id,household_id,owner_user_id,account_id,transfer_account_id,transfer_transaction_id,
        is_transfer_in,idempotency_key,type,name,date,amount,currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Concurrent raw row','2026-01-10','1.00','ZMW')`,
      [id,householdId,userId,incoming ? toId : fromId,incoming ? fromId : toId,group,incoming,id === outflow ? key : null,kind]);
    try {
      await writer.query("BEGIN");
      await writer.query(`INSERT INTO transaction_create_owner_intents
        (transaction_id,idempotency_key,household_id,actor_user_id,owner_selected,operation,request_digest,transfer_group_id,transfer_inflow_id)
        VALUES ($1,$2,$3,$4,false,'transfer',$5,$6,$7)`, [outflow,key,householdId,userId,"t1:"+"0".repeat(64),group,inflow]);
      await writer.query("SELECT pg_current_xact_id()");
      await writer.query("SAVEPOINT transfer_legs");
      await insert(writer, outflow, "transfer", false);
      await insert(writer, inflow, "transfer", true);
      await writer.query("RELEASE SAVEPOINT transfer_legs");
      // This connection cannot see the pending reservation.
      await expect(insert(third, randomUUID(), "transfer", null)).rejects.toMatchObject({ code: "23514" });
      await expect(insert(third, randomUUID(), "expense", false)).rejects.toMatchObject({ code: "23514" });
      await writer.query("SET CONSTRAINTS ALL IMMEDIATE");
      await writer.query("SAVEPOINT reject_account_move");
      const otherHousehold = randomUUID();
      await writer.query("INSERT INTO households(id,name) VALUES ($1,'Temporary household')", [otherHousehold]);
      await expect(writer.query("UPDATE accounts SET household_id=$1 WHERE id=$2", [otherHousehold, fromId]))
        .rejects.toMatchObject({ code: "23503" });
      await writer.query("ROLLBACK TO SAVEPOINT reject_account_move");
      await writer.query("COMMIT");
      expect((await third.query("SELECT id FROM transactions WHERE household_id=$1 AND transfer_transaction_id=$2",
        [householdId, group])).rowCount).toBe(2);
    } finally {
      try { await writer.query("ROLLBACK"); }
      finally { writer.release(); third.release(); }
    }
  });

  it("prevents a double-spend when two transfer updates race the same source balance", async () => {
    const fromId = randomUUID();
    const toAId = randomUUID();
    const toBId = randomUUID();
    await db.insert(accounts).values([
      {
        id: fromId,
        householdId,
        name: `update-src-${fromId.slice(0, 8)}`,
        type: "checking",
        balance: "150.00",
        currency: "ZMW",
        isAsset: true,
      },
      {
        id: toAId,
        householdId,
        name: `update-dst-a-${toAId.slice(0, 8)}`,
        type: "checking",
        balance: "0.00",
        currency: "ZMW",
        isAsset: true,
      },
      {
        id: toBId,
        householdId,
        name: `update-dst-b-${toBId.slice(0, 8)}`,
        type: "checking",
        balance: "0.00",
        currency: "ZMW",
        isAsset: true,
      },
    ]);

    const transferA = await transferService.createTransfer(
      fromId,
      toAId,
      "50.00",
      householdId,
      userId,
      { name: "update-race-A" },
    );
    const transferB = await transferService.createTransfer(
      fromId,
      toBId,
      "50.00",
      householdId,
      userId,
      { name: "update-race-B" },
    );

    expect(await balanceOf(fromId)).toBe("50.00");

    const results = await Promise.allSettled([
      transferService.updateTransfer(
        transferA.outflow.id,
        {
          fromAccountId: fromId,
          toAccountId: toAId,
          amount: "100.00",
        },
        householdId,
        userId,
      ),
      transferService.updateTransfer(
        transferB.outflow.id,
        {
          fromAccountId: fromId,
          toAccountId: toBId,
          amount: "100.00",
        },
        householdId,
        userId,
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ValidationError,
    );

    expect(await balanceOf(fromId)).toBe("0.00");
    expect(["50.00", "100.00"]).toContain(await balanceOf(toAId));
    expect(["50.00", "100.00"]).toContain(await balanceOf(toBId));
    expect(await balanceOf(toAId)).not.toBe(await balanceOf(toBId));

    const sourceRows = await transferRowsForAccount(fromId);
    expect(new Set(sourceRows.map((row) => row.amount))).toEqual(
      new Set(["50.00", "100.00"]),
    );
  });
});
