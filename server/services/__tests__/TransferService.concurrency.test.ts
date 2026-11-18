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
import { db } from "../../db";
import { eq } from "drizzle-orm";
import {
  accounts,
  transactions,
  users,
  households,
} from "@shared/schema";
import { transferService } from "../TransferService";
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
  });

  afterAll(async () => {
    try {
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      // users link to households via householdMembers, not a users.householdId
      // column — delete this scenario's user by id.
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-320 cleanup error", error);
    }
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
        type: "checking",
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

  it("allows a credit/loan source (isAsset=false) to go negative", async () => {
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
    expect(await balanceOf(fromId)).toBe("-100.00");
    expect(await balanceOf(toId)).toBe("100.00");
  });

  it("treats a concurrent retry with the same idempotency key as one transfer", async () => {
    const { fromId, toId } = await seedPair({ sourceBalance: "1000.00" });
    // transactions.idempotencyKey is a uuid column — the key must be a bare UUID.
    const idempotencyKey = randomUUID();

    const results = await Promise.all([
      transferService.createTransfer(fromId, toId, "100.00", householdId, userId, {
        name: "idem-A",
        idempotencyKey,
      }),
      transferService.createTransfer(fromId, toId, "100.00", householdId, userId, {
        name: "idem-B",
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
