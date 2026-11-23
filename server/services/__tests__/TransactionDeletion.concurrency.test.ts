/**
 * §4b (production-readiness reconciliation 2026-07-03): deletion and
 * balance-adjustment concurrency — REAL DB.
 *
 * Three balance-mutation paths raced after PR #58 locked create/update/transfer-update:
 *  1. TransactionRepository.softDelete read the transaction OUTSIDE the
 *     transaction with no FOR UPDATE, then reversed the balance from that stale
 *     snapshot — a concurrent amount edit corrupted the balance permanently.
 *  2. Transfer deletion ran as two sequential softDelete transactions — a crash
 *     or concurrent edit between them half-reversed the pair.
 *  3. AccountCoreService.adjustBalance wrote the balance with no FOR UPDATE and
 *     no overdraft guard, bypassing the locked create path.
 *
 * The fixes lock the transaction row(s) FOR UPDATE first, then the account(s)
 * (consistent id order), inside ONE transaction. These tests run genuinely
 * concurrent service/repository calls against real Postgres so the locks are
 * actually exercised — a mocked tx would prove nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import { accounts, transactions, users, households, householdMembers } from "@shared/schema";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { transactionService } from "../TransactionService";
import { transferService } from "../TransferService";
import { accountService } from "../AccountService";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { createTestUser, createTestHousehold } from "../../__tests__/fixtures";

describe("Deletion / balance-adjustment concurrency (§4b)", () => {
  let householdId: string;
  let userId: string;

  beforeAll(async () => {
    const user = createTestUser({
      email: `sec4b-${Date.now()}@example.com`,
      username: `sec4b-${Date.now()}`,
    });
    const hh = createTestHousehold(user.id, { name: `sec4b-${Date.now()}` });
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
    try {
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("§4b cleanup error", error);
    }
  });

  /** Seed a single account for one scenario. */
  async function seedAccount(opts: {
    balance: string;
    isAsset?: boolean;
  }): Promise<string> {
    const id = randomUUID();
    await db.insert(accounts).values({
      id,
      householdId,
      name: `acc-${id.slice(0, 8)}`,
      type: "checking",
      balance: opts.balance,
      currency: "ZMW",
      isAsset: opts.isAsset ?? true,
    });
    return id;
  }

  const balanceOf = async (id: string): Promise<string> => {
    const [row] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, id))
      .limit(1);
    return row.balance;
  };

  const today = (): string => new Date().toISOString().split("T")[0];

  /** Create a plain expense via the locked repository path. */
  async function seedExpense(
    accountId: string,
    amount: string,
  ): Promise<string> {
    const { transaction } = await transactionRepository.create({
      householdId,
      accountId,
      ownerUserId: userId,
      date: today(),
      name: `expense-${amount}`,
      amount,
      currency: "ZMW",
      type: "expense",
      source: "manual",
    });
    return transaction.id;
  }

  it("reverses the COMMITTED amount when a delete races an amount update", async () => {
    // Balance 1000, expense 100 → 900. An update to 300 and a delete race.
    // Serialized either way, the final balance must be exactly 1000: either the
    // update applies (700) and the delete reverses the NEW amount (+300), or
    // the delete lands first and the update no-ops on the deleted row.
    // Pre-fix, the delete could reverse the STALE amount (+100 → 800).
    const accountId = await seedAccount({ balance: "1000.00" });
    const txnId = await seedExpense(accountId, "100.00");
    expect(await balanceOf(accountId)).toBe("900.00");

    const results = await Promise.allSettled([
      transactionRepository.update(txnId, householdId, { amount: "300.00" }),
      transactionRepository.softDelete(txnId, householdId),
    ]);

    // Neither leg may crash — a no-op result is fine, an exception is not.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    expect(await balanceOf(accountId)).toBe("1000.00");

    const [row] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, txnId))
      .limit(1);
    expect(row.deletedAt).not.toBeNull();
  });

  it("reverses the balance exactly once when two deletes race", async () => {
    const accountId = await seedAccount({ balance: "1000.00" });
    const txnId = await seedExpense(accountId, "100.00");
    expect(await balanceOf(accountId)).toBe("900.00");

    const results = await Promise.all([
      transactionRepository.softDelete(txnId, householdId),
      transactionRepository.softDelete(txnId, householdId),
    ]);

    // Exactly one delete wins; the loser sees the already-deleted row.
    expect(results.filter((deleted) => deleted)).toHaveLength(1);
    expect(results.filter((deleted) => !deleted)).toHaveLength(1);

    // Single reversal: 900 + 100, NOT 900 + 200.
    expect(await balanceOf(accountId)).toBe("1000.00");
  });

  it("restores both balances exactly when a transfer delete races a transfer update", async () => {
    const fromId = await seedAccount({ balance: "500.00" });
    const toId = await seedAccount({ balance: "0.00" });

    const created = await transferService.createTransfer(
      fromId,
      toId,
      "100.00",
      householdId,
      userId,
      { name: "race-delete-vs-update" },
    );
    expect(await balanceOf(fromId)).toBe("400.00");
    expect(await balanceOf(toId)).toBe("100.00");

    const results = await Promise.allSettled([
      transactionService.deleteTransaction(
        created.outflow.id,
        householdId,
        userId,
      ),
      transferService.updateTransfer(
        created.outflow.id,
        { fromAccountId: fromId, toAccountId: toId, amount: "200.00" },
        householdId,
        userId,
      ),
    ]);

    // The delete always wins eventually (an update never removes the pair);
    // the update either applied first (then was fully reversed) or lost the
    // race and failed with NotFoundError on the deleted pair.
    expect(results[0].status).toBe("fulfilled");
    if (results[1].status === "rejected") {
      expect(
        (results[1] as PromiseRejectedResult).reason,
      ).toBeInstanceOf(NotFoundError);
    }

    // Fully reversed in EVERY interleaving — pre-fix, an update committing
    // between the two softDelete legs half-reversed the pair permanently.
    expect(await balanceOf(fromId)).toBe("500.00");
    expect(await balanceOf(toId)).toBe("0.00");

    const legs = await db
      .select()
      .from(transactions)
      .where(
        eq(
          transactions.transferTransactionId,
          created.outflow.transferTransactionId!,
        ),
      );
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      expect(leg.deletedAt).not.toBeNull();
    }
  });

  it("reverses the pair exactly once when both legs are deleted concurrently", async () => {
    const fromId = await seedAccount({ balance: "500.00" });
    const toId = await seedAccount({ balance: "0.00" });

    const created = await transferService.createTransfer(
      fromId,
      toId,
      "100.00",
      householdId,
      userId,
      { name: "race-double-delete" },
    );
    expect(await balanceOf(fromId)).toBe("400.00");

    const results = await Promise.allSettled([
      transactionService.deleteTransaction(
        created.outflow.id,
        householdId,
        userId,
      ),
      transactionService.deleteTransaction(
        created.inflow.id,
        householdId,
        userId,
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      (rejected[0] as PromiseRejectedResult).reason,
    ).toBeInstanceOf(NotFoundError);

    // Single reversal of the whole pair — not double.
    expect(await balanceOf(fromId)).toBe("500.00");
    expect(await balanceOf(toId)).toBe("0.00");
  });

  it("prevents an overdraft when two balance-adjustment decreases race", async () => {
    // Pre-fix, adjustBalance wrote the balance with no lock and no guard: both
    // decreases would read 100 and both would commit → balance -100.
    const accountId = await seedAccount({ balance: "100.00" });

    const results = await Promise.allSettled([
      accountService.adjustBalance(
        accountId,
        "100.00",
        false,
        householdId,
        userId,
      ),
      accountService.adjustBalance(
        accountId,
        "100.00",
        false,
        householdId,
        userId,
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      (rejected[0] as PromiseRejectedResult).reason,
    ).toBeInstanceOf(ValidationError);

    expect(await balanceOf(accountId)).toBe("0.00");

    // Exactly one balance_adjustment transaction persisted.
    const adjustments = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          eq(transactions.type, "balance_adjustment"),
        ),
      );
    expect(adjustments).toHaveLength(1);
  });

  it("allows an increase adjustment on an already-negative asset balance", async () => {
    // The overdraft guard must only fire when the delta is NEGATIVE. An
    // account whose stored balance drifted below zero (legacy data) must still
    // accept a correcting increase — the delta moves it toward zero.
    const accountId = await seedAccount({ balance: "-50.00" });

    const result = await accountService.adjustBalance(
      accountId,
      "20.00",
      true,
      householdId,
      userId,
    );

    expect(result.transactionId).toBeDefined();
    expect(await balanceOf(accountId)).toBe("-30.00");
  });

  it("allows a decrease on a liability account (isAsset=false) to go negative", async () => {
    const accountId = await seedAccount({ balance: "50.00", isAsset: false });

    await accountService.adjustBalance(
      accountId,
      "100.00",
      false,
      householdId,
      userId,
    );

    expect(await balanceOf(accountId)).toBe("-50.00");
  });
});
