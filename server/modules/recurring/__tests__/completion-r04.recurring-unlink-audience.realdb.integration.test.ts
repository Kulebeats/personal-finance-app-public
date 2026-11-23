import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, outboxEvents, recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, b, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const targetId = randomUUID(), survivorId = randomUUID(), selectedId = randomUUID(), otherSourceId = randomUUID(), originalAccountId = randomUUID();
const selectedLinkId = randomUUID();
type Subject = "target" | "survivor";
type Origin = "different contributor" | "original account";
function unlink() {
  return request(app).delete(`/api/recurring/${targetId}/link/${selectedLinkId}`).set("Cookie", actors.get("member")!.cookie);
}
async function state() {
  return {
    rules: await db.select().from(recurringTransactions).where(inArray(recurringTransactions.id, [targetId, survivorId])).orderBy(recurringTransactions.id),
    links: await db.select().from(recurringTransactionLinks).where(inArray(recurringTransactionLinks.recurringTransactionId, [targetId, survivorId])).orderBy(recurringTransactionLinks.id),
    history: await db.select().from(recurringTransactionHistory).where(inArray(recurringTransactionHistory.recurringTransactionId, [targetId, survivorId])).orderBy(recurringTransactionHistory.id),
    transactions: await db.select().from(transactions).where(inArray(transactions.householdId, [a, b])).orderBy(transactions.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, [a, b])).orderBy(accounts.id),
    audit: await db.select().from(auditLogs).where(eq(auditLogs.householdId, a)).orderBy(auditLogs.id),
    outbox: await db.select().from(outboxEvents).where(eq(outboxEvents.householdId, a)).orderBy(outboxEvents.id),
  };
}
async function clean() {
  await db.delete(recurringTransactions).where(inArray(recurringTransactions.id, [targetId, survivorId]));
  await db.delete(transactions).where(inArray(transactions.id, [selectedId, otherSourceId]));
  await db.delete(accounts).where(eq(accounts.id, originalAccountId));
  await db.delete(auditLogs).where(eq(auditLogs.householdId, a));
  await db.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
}
async function seed(subject: Subject, origin: Origin) {
  const protectedId = subject === "target" ? targetId : survivorId;
  await db.insert(accounts).values({ id: originalAccountId, householdId: a, ownerUserId: actors.get("owner")!.id,
    name: "UNLINK_ORIGINAL_ACCOUNT_SECRET", type: "checking", currency: "ZMW", balance: "1000.00", isPrivate: false });
  await db.insert(recurringTransactions).values([targetId, ...(subject === "survivor" ? [survivorId] : [])].map(id => ({
    id, householdId: a, accountId: ids.sharedAccount, name: "Unlink public rule", amount: "7.25", type: "expense" as const,
    frequency: "monthly" as const, startDate: "2026-08-10", nextDueDate: "2026-12-10", detectionMethod: "manual",
  })));
  await db.insert(transactions).values([
    { id: selectedId, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
      date: "2026-10-10", name: "Unlink selected public source", amount: "7.25", currency: "ZMW", type: "expense", isPrivate: false,
      isRecurring: true, recurringTransactionId: targetId },
    { id: otherSourceId, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
      date: "2026-09-10", name: "UNLINK_DIFFERENT_SOURCE_SECRET", amount: "7.25", currency: "ZMW", type: "expense", isPrivate: false,
      isRecurring: true, recurringTransactionId: protectedId },
  ]);
  await db.insert(recurringTransactionLinks).values([
    { id: selectedLinkId, recurringTransactionId: targetId, transactionId: selectedId },
    { recurringTransactionId: protectedId, transactionId: otherSourceId },
    ...(subject === "survivor" ? [{ recurringTransactionId: survivorId, transactionId: selectedId }] : []),
  ]);
  if (origin === "original account") await db.insert(recurringTransactionHistory).values({ recurringTransactionId: protectedId,
    action: "updated", previousState: { accountId: originalAccountId }, newState: { accountId: ids.sharedAccount } });
}

describe("signed unlink holds the complete target and survivor audience", () => {
  beforeAll(start, 20_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  for (const subject of ["target", "survivor"] as const) {
    it.each(["different contributor", "original account"] as const)(`refuses a ${subject} whose %s became private, without any effects`, async origin => {
      await seed(subject, origin);
      if (origin === "different contributor") await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, otherSourceId));
      else await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, originalAccountId));
      const before = await state();
      const response = await unlink().expect(404);
      expect(JSON.stringify(response.body)).not.toMatch(/UNLINK_DIFFERENT_SOURCE_SECRET|UNLINK_ORIGINAL_ACCOUNT_SECRET/);
      expect(await state()).toEqual(before);
    });

    it.each(["different contributor", "original account"] as const)(`waits for the ${subject}'s %s privacy writer and denies after it commits`, async origin => {
      await seed(subject, origin);
      const before = await state(), blocker = await pool.connect();
      let pending: Promise<request.Response> | undefined, waiting = false;
      try {
        await blocker.query("BEGIN");
        const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
        if (origin === "different contributor") await blocker.query("UPDATE transactions SET is_private=true WHERE id=$1", [otherSourceId]);
        else await blocker.query("UPDATE accounts SET is_private=true WHERE id=$1", [originalAccountId]);
        let settled = false;
        pending = unlink().timeout(10_000).then(response => { settled = true; return response; });
        void pending.catch(() => { settled = true; });
        const deadline = Date.now() + 5_000;
        while (!waiting && !settled && Date.now() < deadline) {
          const { rows } = await pool.query<{ blocked: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [pid]);
          waiting = rows[0].blocked;
          if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
        }
        await blocker.query("COMMIT");
      } finally {
        try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
        if (pending) await Promise.allSettled([pending]);
      }
      expect.soft(waiting).toBe(true);
      expect.soft((await pending!).status).toBe(404);
      expect(await state()).toEqual({ ...before,
        transactions: before.transactions.map(source => origin === "different contributor" && source.id === otherSourceId ? { ...source, isPrivate: true } : source),
        accounts: before.accounts.map(account => origin === "original account" && account.id === originalAccountId ? { ...account, isPrivate: true } : account),
      });
    });

    it(`retains authorized public ${subject} unlink, pointer selection and one audit`, async () => {
      await seed(subject, "different contributor");
      const before = await state();
      await unlink().expect(200);
      const after = await state();
      expect(after.links.some(link => link.id === selectedLinkId)).toBe(false);
      expect(after.transactions.find(source => source.id === selectedId)).toMatchObject({ recurringTransactionId: subject === "survivor" ? survivorId : null });
      expect(after.accounts).toEqual(before.accounts);
      expect(after.audit.filter(row => row.action === "UNLINK")).toHaveLength(1);
      expect(after.history.filter(row => row.action === "unlinked")).toHaveLength(1);
    });
  }
});
