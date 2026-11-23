import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { accounts, auditLogs, categories, householdMembers, households, outboxEvents, pendingReceipts, transactions, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { outboxEventService } from "../../../core/events";
import { transactionService } from "../../TransactionService";
import { transactionRepository } from "../../../repositories/TransactionRepository";
import { receiptRepository } from "../../../repositories/ReceiptRepository";
import { buildMatchCriteria, calculateMatchScore } from "../../receipt/matching";
import { ReceiptTransactionService, receiptTransactionService } from "../../receipt/transaction.service";

describe("R08 existing posting callers and historical evidence", () => {
  const householdId = randomUUID(), userId = randomUUID();

  beforeAll(async () => {
    await db.insert(households).values({ id: householdId, name: "Synthetic posting evidence", currency: "ZMW" });
    await db.insert(users).values({ id: userId, username: "r08-" + userId, email: userId + "@example.invalid", passwordHash: await hashPassword("SyntheticReceipt123!"), emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM "session" WHERE sess->>'userId'=$1`, [userId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id=$1", [userId]);
    // Household deletion cascades the synthetic receipt evidence with its parents.
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(users).where(eq(users.id, userId));
  });

  async function account(isAsset: boolean) {
    const [row] = await db.insert(accounts).values({ householdId, name: "Synthetic USD account", currency: "USD",
      type: isAsset ? "checking" : "credit", ownerUserId: userId, isAsset, balance: "100.00", initialBalance: "100.00" }).returning();
    return row.id;
  }
  async function state(accountId: string) {
    return {
      accounts: await db.select().from(accounts).where(eq(accounts.id, accountId)),
      transactions: await db.select().from(transactions).where(eq(transactions.accountId, accountId)),
    };
  }

  it("guards conversion evidence against truncate and temporary-table shadowing", async () => {
    const client = await pool.connect();
    const receiptId = randomUUID(), postingId = randomUUID(), accountId = await account(true);
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO public.pending_receipts (id,household_id,uploaded_by,filename,original_filename,mime_type,size,storage_path) VALUES ($1,$2,$3,'a','a','image/png',1,'synthetic')", [receiptId, householdId, userId]);
      await client.query("INSERT INTO public.transactions (id,household_id,account_id,name,date,type,amount) VALUES ($1,$2,$3,'Synthetic',CURRENT_DATE,'expense',1)", [postingId, householdId, accountId]);
      await client.query("INSERT INTO public.receipt_conversion_records(receipt_id,household_id,transaction_id,request_version,request_hash) VALUES ($1,$2,$3,1,repeat('a',64))", [receiptId, householdId, postingId]);
      await client.query("CREATE TEMP TABLE households (id uuid); CREATE TEMP TABLE household_members (household_id uuid); CREATE TEMP TABLE receipt_conversion_records (receipt_id uuid)");
      await client.query("SELECT set_config('app.erasing_household',$1,true)", [householdId]);
      for (const statement of [
        "DELETE FROM public.receipt_conversion_records WHERE receipt_id=$1",
        "UPDATE public.pending_receipts SET image_hash=repeat('b',64) WHERE id=$1",
        "TRUNCATE public.receipt_conversion_records",
      ]) {
        await client.query("SAVEPOINT attempt");
        await expect(client.query(statement, statement.includes("$1") ? [receiptId] : [])).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT attempt");
      }
      expect((await client.query("SELECT receipt_id FROM public.receipt_conversion_records WHERE receipt_id=$1", [receiptId])).rows).toEqual([{ receipt_id: receiptId }]);
    } finally {
      try { await client.query("ROLLBACK"); } finally { client.release(); }
    }
  });

  it("refuses a foreign receipt category before posting or linking the receipt", async () => {
    const foreignHouseholdId = randomUUID();
    const accountId = await account(true);
    await db.insert(households).values({ id: foreignHouseholdId, name: "Foreign receipt category owner", currency: "USD" });
    try {
      const [category] = await db.insert(categories).values({
        householdId: foreignHouseholdId, groupId: null, name: "Foreign receipt category", displayOrder: 0,
      }).returning();
      const [receipt] = await db.insert(pendingReceipts).values({
        householdId, uploadedBy: userId, filename: "scope.png", originalFilename: "scope.png",
        mimeType: "image/png", size: 1, storagePath: "synthetic/unused",
      }).returning();
      const before = await state(accountId);
      await expect(new ReceiptTransactionService().createTransactionFromReceipt(receipt.id, householdId, userId, {
        accountId, categoryId: category.id, name: "Synthetic receipt", amount: "12.35", date: "2026-02-01",
      })).rejects.toMatchObject({ statusCode: 404 });
      expect(await state(accountId)).toEqual(before);
      const [after] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, receipt.id));
      expect(after).toEqual(receipt);
    } finally {
      await db.delete(households).where(eq(households.id, foreignHouseholdId));
    }
  });

  it.each(["sequential", "concurrent"] as const)("posts a receipt once across %s conversion attempts", async mode => {
    const accountId = await account(true);
    const [receipt] = await db.insert(pendingReceipts).values({
      householdId, uploadedBy: userId, filename: "retry.png", originalFilename: "retry.png",
      mimeType: "image/png", size: 1, storagePath: "synthetic/unused",
    }).returning();
    const convert = (amount = "12.35") => new ReceiptTransactionService().createTransactionFromReceipt(receipt.id, householdId, userId, {
      accountId, name: "Synthetic repeated receipt", amount, date: "2026-02-01",
    });
    const attempts = mode === "concurrent"
      ? await Promise.allSettled([convert(), convert()])
      : [...await Promise.allSettled([convert()]), ...await Promise.allSettled([convert()])];
    const saved = await state(accountId);
    expect(saved.accounts[0].balance).toBe("87.65");
    expect(saved.transactions).toHaveLength(1);
    const transactionId = saved.transactions[0].id;
    const [linked] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, receipt.id));
    expect(linked).toMatchObject({ matchStatus: "matched", matchedTransactionId: transactionId });
    const effects = await pool.query(
      `SELECT (SELECT count(*)::int FROM audit_logs WHERE entity_id=$1 AND action='CREATE') AS creates,
        (SELECT count(*)::int FROM audit_logs WHERE entity_id=$2 AND action='LINK') AS links,
        (SELECT count(*)::int FROM outbox_events WHERE aggregate_id=$1 AND event_type='transaction.created') AS events,
        (SELECT count(*)::int FROM receipt_conversion_records WHERE receipt_id=$2) AS records`,
      [transactionId, receipt.id],
    );
    expect(effects.rows).toEqual([{ creates: 1, links: 1, events: 1, records: 1 }]);
    expect(attempts).toEqual([
      { status: "fulfilled", value: expect.objectContaining({ transactionId }) },
      { status: "fulfilled", value: expect.objectContaining({ transactionId }) },
    ]);
    await expect(convert("15.00")).rejects.toMatchObject({ statusCode: 409 });
    expect(await state(accountId)).toEqual(saved);
    const [unchanged] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, receipt.id));
    expect(unchanged).toEqual(linked);
  });

  it("replays the original input after an edit and conceals the deleted posting", async () => {
    const accountId = await account(true);
    const [receipt] = await db.insert(pendingReceipts).values({ householdId, uploadedBy: userId,
      filename: "edit.png", originalFilename: "edit.png", mimeType: "image/png", size: 1, storagePath: "synthetic" }).returning();
    const convert = (amount: string) => new ReceiptTransactionService().createTransactionFromReceipt(receipt.id, householdId, userId,
      { accountId, name: "Original request", amount, date: "2026-02-01" });
    const { transactionId } = await convert("12.35");
    await transactionService.updateTransaction(transactionId, { amount: "15.00" }, householdId, userId);
    const edited = await state(accountId);
    expect(edited.accounts[0].balance).toBe("85.00");
    expect(await convert("012.35")).toEqual({ transactionId, replayed: true });
    await expect(convert("15.00")).rejects.toMatchObject({ statusCode: 409 });
    expect(await state(accountId)).toEqual(edited);
    await transactionService.deleteTransaction(transactionId, householdId, userId);
    const deleted = await state(accountId);
    await expect(convert("12.35")).rejects.toMatchObject({ statusCode: 404 });
    expect(await state(accountId)).toEqual(deleted);
  });

  it("prevents a second conversion of one image even after a mutable receipt link is cleared", async () => {
    const accountId = await account(true);
    const receipts = await db.insert(pendingReceipts).values(["source", "duplicate"].map(name => ({
      householdId, uploadedBy: userId, filename: name, originalFilename: name, mimeType: "image/png",
      size: 1, storagePath: "synthetic", imageHash: "a".repeat(64),
    }))).returning();
    const convert = (id: string) => new ReceiptTransactionService().createTransactionFromReceipt(id, householdId, userId,
      { accountId, name: "Same image", amount: "12.35", date: "2026-02-01" });
    await convert(receipts[0].id);
    const before = await state(accountId);
    await expect(convert(receipts[1].id)).rejects.toMatchObject({ statusCode: 409 });
    expect(await state(accountId)).toEqual(before);
    await db.update(pendingReceipts).set({ matchStatus: "pending", matchedTransactionId: null }).where(eq(pendingReceipts.id, receipts[0].id));
    await expect(convert(receipts[0].id)).rejects.toMatchObject({ statusCode: 409 });
    const { receiptRepository } = await import("../../../repositories/ReceiptRepository");
    await expect(receiptRepository.deleteVisible({ householdId, userId, role: "owner" }, receipts[0].id))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(await state(accountId)).toEqual(before);
  });

  it("rechecks visibility on the signed route before reporting a conflicting retry", async () => {
    const app = await getTestApp(), accountId = await account(true), secondUser = randomUUID();
    await db.insert(users).values({ id: secondUser, username: "r08-" + secondUser, email: secondUser + "@example.invalid",
      passwordHash: await hashPassword("SyntheticReceipt123!"), emailVerified: true });
    try {
      await db.insert(householdMembers).values({ householdId, userId: secondUser, role: "member" });
      const login = await request(app).post("/api/auth/login").send({ email: secondUser + "@example.invalid", password: "SyntheticReceipt123!" }).expect(200);
      const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
      const [receipt] = await db.insert(pendingReceipts).values({ householdId, uploadedBy: userId,
        filename: "signed.png", originalFilename: "signed.png", mimeType: "image/png", size: 1, storagePath: "synthetic" }).returning();
      await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, accountId));
      const body = { accountId, amount: "8.00", date: "2026-02-01", name: "Signed receipt" };
      const post = (amount: string) => request(app).post(`/api/receipts/${receipt.id}/create-transaction`)
        .set("Cookie", cookie).set("X-Capital-Subject", secondUser).set("X-Capital-Household", householdId).send({ ...body, amount });
      const created = await post("8.00").expect(201);
      const transactionId = created.body.data.transactionId;
      expect(created.body.data).toEqual({ transactionId: expect.any(String), receiptId: receipt.id });
      const fresh = await state(accountId);
      const replay = await post("8.0").expect(200);
      expect(replay.body.data.transactionId).toBe(transactionId);
      await post("9.00").expect(409);
      expect(await state(accountId)).toEqual(fresh);
      expect(fresh.accounts[0].balance).toBe("92.00");
      expect(fresh.transactions).toHaveLength(1);
      await db.update(transactions).set({ isPrivate: true, ownerUserId: userId }).where(eq(transactions.id, transactionId));
      const before = await state(accountId);
      for (const amount of ["8.00", "9.00"]) {
        const hidden = await post(amount).expect(404);
        expect(JSON.stringify(hidden.body)).not.toContain(transactionId);
      }
      expect(await state(accountId)).toEqual(before);
    } finally {
      await pool.query(`DELETE FROM "session" WHERE sess->>'userId'=$1`, [secondUser]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id=$1", [secondUser]);
      await db.delete(users).where(eq(users.id, secondUser));
    }
  });

  it.each(["after conversion", "during conversion"] as const)("preserves the signed receipt link when OCR finishes %s", async order => {
    const app = await getTestApp(), accountId = await account(true);
    const [receipt] = await db.insert(pendingReceipts).values({ householdId, uploadedBy: userId,
      filename: "ocr.png", originalFilename: "ocr.png", mimeType: "image/png", size: 1, storagePath: "synthetic",
      matchAttempts: 4 }).returning();
    const login = await request(app).post("/api/auth/login").send({ email: userId + "@example.invalid", password: "SyntheticReceipt123!" }).expect(200);
    const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    const post = (action: string) => request(app).post(`/api/receipts/${receipt.id}/${action}`)
      .set("Cookie", cookie).set("X-Capital-Subject", userId).set("X-Capital-Household", householdId);
    const body = { accountId, amount: "8.00", date: "2026-02-01", name: "OCR race receipt" };
    const ocr = { confidence: 0.9, merchantName: "Synthetic" };
    let transactionId: string;
    if (order === "after conversion") {
      transactionId = (await post("create-transaction").send(body).expect(201)).body.data.transactionId;
      await post("ocr-results").send(ocr).expect(200);
    } else {
      let resume!: () => void, reached!: () => void;
      const gate = new Promise<void>(resolve => { resume = resolve; });
      const searching = new Promise<void>(resolve => { reached = resolve; });
      const realSearch = receiptRepository.findTransactionsForMatch.bind(receiptRepository);
      const search = vi.spyOn(receiptRepository, "findTransactionsForMatch").mockImplementationOnce(async (...args) => {
        const candidates = await realSearch(...args);
        reached();
        await gate;
        return candidates;
      });
      const pending = post("ocr-results").send({ ...ocr, date: "2066-01-01" }).expect(200).then(response => response);
      try {
        await Promise.race([searching, pending.then(() => { throw new Error("Matcher did not reach its candidate read"); })]);
        transactionId = (await post("create-transaction").send(body).expect(201)).body.data.transactionId;
      } finally { resume(); search.mockRestore(); await pending; }
    }
    const [receiptAfter] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, receipt.id));
    expect(receiptAfter).toMatchObject({ matchStatus: "matched", matchedTransactionId: transactionId });
    const replay = await post("create-transaction").send(body).expect(200);
    expect(replay.body.data.transactionId).toBe(transactionId);
    const otherAccount = await account(true);
    const other = await transactionService.createTransaction({ accountId: otherAccount, name: "Alternative",
      date: "2026-02-01", amount: "8.00", currency: "USD", type: "expense" }, householdId, userId);
    await post("match").send({ transactionId: other.transaction.id }).expect(409);
    expect((await receiptRepository.findById(receipt.id))?.matchedTransactionId).toBe(transactionId);
    const saved = await state(accountId);
    expect(saved.accounts[0].balance).toBe("92.00");
    expect(saved.transactions).toHaveLength(1);
  });

  it.each([true, false])("publishes no candidate when conversion wins the OCR search (private account %s)", async isPrivate => {
    const app = await getTestApp(), accountId = await account(true), member = randomUUID();
    await db.update(accounts).set({ isPrivate }).where(eq(accounts.id, accountId));
    await db.insert(users).values({ id: member, username: "r08-" + member, email: member + "@example.invalid",
      passwordHash: await hashPassword("SyntheticReceipt123!"), emailVerified: true });
    try {
      await db.insert(householdMembers).values({ householdId, userId: member, role: "member" });
      const login = async (id: string) => {
        const res = await request(app).post("/api/auth/login").send({ email: id + "@example.invalid", password: "SyntheticReceipt123!" }).expect(200);
        return (res.headers["set-cookie"] as unknown as string[]).join("; ");
      };
      const memberCookie = await login(member), ownerCookie = await login(userId);
      const [receipt] = await db.insert(pendingReceipts).values({ householdId, uploadedBy: userId,
        filename: "positive.png", originalFilename: "positive.png", mimeType: "image/png", size: 1, storagePath: "synthetic" }).returning();
      const post = (action: string, id: string, cookie: string) => request(app).post(`/api/receipts/${receipt.id}/${action}`)
        .set("Cookie", cookie).set("X-Capital-Subject", id).set("X-Capital-Household", householdId);
      const name = isPrivate ? "Amber Orchard" : "Copper Meadow", date = "2026-06-08", amount = "8.00";
      let resume!: () => void, reached!: () => void;
      const gate = new Promise<void>(resolve => { resume = resolve; });
      const searching = new Promise<void>(resolve => { reached = resolve; });
      const actual = receiptRepository.findTransactionsForMatch.bind(receiptRepository);
      const link = vi.spyOn(receiptTransactionService, "linkReceiptToTransaction");
      const observedCandidates: string[] = [];
      const search = vi.spyOn(receiptRepository, "findTransactionsForMatch").mockImplementationOnce(async (...args) => {
        reached();
        await gate;
        const candidates = await actual(...args);
        observedCandidates.push(...candidates.map(row => row.id));
        return candidates;
      });
      const pending = post("ocr-results", member, memberCookie).send({ confidence: 0.95, merchantName: name, date, amount })
        .expect(200).then(res => res);
      let transactionId: string;
      try {
        await Promise.race([searching, pending.then(() => { throw new Error("OCR did not search"); })]);
        const created = await post("create-transaction", userId, ownerCookie).send({ accountId, name, date, amount }).expect(201);
        transactionId = created.body.data.transactionId;
      } finally { resume(); search.mockRestore(); }
      const result = await pending;
      const linkTargets = link.mock.calls.map(args => args[1]);
      link.mockRestore();
      const criteria = buildMatchCriteria({ merchantName: name, date, amount });
      const ownerCandidates = await actual(householdId, userId, criteria);
      const expected = ownerCandidates.find(row => row.id === transactionId);
      expect(expected, "The original uploader can find the converted posting").toBeDefined();
      expect(calculateMatchScore({ merchantName: name, date, amount }, expected!)).toBeGreaterThanOrEqual(0.7);
      if (!isPrivate) {
        expect(observedCandidates).toContain(transactionId);
        expect(linkTargets).toContain(transactionId);
      }
      expect(result.body.data.autoMatched).toBe(false);
      expect(JSON.stringify(result.body)).not.toContain(transactionId);
      const links = await pool.query("SELECT user_id FROM audit_logs WHERE entity_id=$1 AND action='LINK'", [receipt.id]);
      expect(links.rows).toEqual([{ user_id: userId }]);
      expect((await state(accountId)).accounts[0].balance).toBe("92.00");
    } finally {
      await pool.query(`DELETE FROM "session" WHERE sess->>'userId'=$1`, [member]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id=$1", [member]);
      await db.delete(auditLogs).where(eq(auditLogs.userId, member));
      await db.delete(users).where(eq(users.id, member));
    }
  });

  it("receipt conversion posts once for one conversion and links the saved non-base-currency expense", async () => {
    const accountId = await account(true);
    const [receipt] = await db.insert(pendingReceipts).values({ householdId, uploadedBy: userId,
      filename: "example.png", originalFilename: "example.png", mimeType: "image/png", size: 1, storagePath: "synthetic/unused" }).returning();
    const saved = await new ReceiptTransactionService().createTransactionFromReceipt(receipt.id, householdId, userId,
      { accountId, name: "Synthetic receipt", amount: "12.35", date: "2026-02-01" });
    const after = await state(accountId);
    expect(after.accounts[0].balance).toBe("87.65");
    expect(after.transactions).toEqual([expect.objectContaining({ id: saved.transactionId, source: "receipt_scan",
      amount: "12.35", currency: "USD", postingMode: "posted", postedBalanceDelta: "-12.35", postedAccountIsAsset: true })]);
    const [linked] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, receipt.id));
    expect(linked).toMatchObject({ matchStatus: "matched", matchedTransactionId: saved.transactionId });
  });

  it.each(["manual", "csv_import"] as const)("does not infer actual cash movement for an undocumented %s row", async source => {
    const accountId = await account(true);
    const [historical] = await db.insert(transactions).values({ householdId, accountId, source, ownerUserId: userId,
      date: "2026-02-01", name: "Synthetic legacy row", type: "expense", amount: "10.00", currency: "USD" }).returning();
    await transactionRepository.update(historical.id, householdId, { notes: "Metadata can still be saved" });
    const before = await state(accountId);
    await expect(transactionRepository.update(historical.id, householdId, { amount: "15.00" })).rejects.toThrow();
    await expect(transactionRepository.softDelete(historical.id, householdId)).rejects.toThrow();
    expect(await state(accountId)).toEqual(before);
  });

  it("rolls back an ordinary debit, CREATE audit and queued event together when event publication fails", async () => {
    const accountId = await account(true);
    const before = await state(accountId);
    const effects = async () => ({
      audits: await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.householdId, householdId)),
      events: await db.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.householdId, householdId)),
    });
    const beforeEffects = await effects();
    const publish = outboxEventService.publish.bind(outboxEventService);
    const fault = vi.spyOn(outboxEventService, "publish").mockImplementationOnce(async (event, tx) => {
      expect(tx).toBeDefined();
      await publish(event, tx);
      throw new Error("synthetic failure after outbox insertion");
    });
    try {
      await expect(transactionService.createTransaction({ accountId, name: "Synthetic rolled-back debit",
        date: "2026-02-01", amount: "4.00", currency: "USD", type: "expense", source: "manual" },
        householdId, userId)).rejects.toThrow("synthetic failure after outbox insertion");
    } finally { fault.mockRestore(); }
    expect(await state(accountId)).toEqual(before);
    expect(await effects()).toEqual(beforeEffects);
  });

  it("cannot turn an existing debit into a neutral receipt through ordinary update data", async () => {
    const accountId = await account(true);
    const { transaction } = await transactionRepository.create({ householdId, accountId, ownerUserId: userId,
      name: "Synthetic expense", type: "expense", date: "2026-02-01", amount: "12.00", currency: "USD", source: "manual" });
    const before = await state(accountId);
    expect(before.accounts[0].balance).toBe("88.00");
    const forged = { postedBalanceDelta: "0.00", postingMode: "history_only" as const, postedAccountIsAsset: true };
    await expect(transactionRepository.update(transaction.id, householdId, forged)).rejects.toThrow();
    expect(await state(accountId)).toEqual(before);
  });

  it("retains exactly one provable historical manual asset debit across its first edit", async () => {
    const accountId = await account(true);
    const { transaction } = await transactionRepository.create({ householdId, accountId, ownerUserId: userId,
      name: "Synthetic legacy-backed expense", type: "expense", date: "2026-02-01", amount: "12.00", currency: "USD", source: "manual" },
      { audit: { userId, householdId } });
    // Simulate the all-null 0017 receipt. Parent and CREATE audit timestamps
    // come from the original financial transaction, just as in the old writer.
    await db.update(transactions).set({ postingMode: null, postedBalanceDelta: null, postedAccountIsAsset: null })
      .where(eq(transactions.id, transaction.id));
    await db.update(auditLogs).set({ details: { newValue: { accountId, amount: "12.00", currency: "USD",
      date: transaction.date, type: "expense", source: "manual" } } }).where(eq(auditLogs.entityId, transaction.id));
    await transactionRepository.update(transaction.id, householdId, { amount: "15.00" });
    const saved = await state(accountId);
    expect(saved.accounts[0].balance).toBe("85.00");
    expect(saved.transactions[0]).toMatchObject({ currency: "USD", postedBalanceDelta: "-15.00", postingMode: "posted" });
    await transactionRepository.softDelete(transaction.id, householdId);
    expect((await state(accountId)).accounts[0].balance).toBe("100.00");
  });
});
