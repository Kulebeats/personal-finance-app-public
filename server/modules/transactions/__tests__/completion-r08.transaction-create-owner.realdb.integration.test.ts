import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { categories, grzBondPayments, grzBonds, merchants, outboxEvents } from "@shared/schema";
import { db, pool } from "../../../db";
import { transactionService } from "../../../services/TransactionService";
import { transactionRepository } from "../../../repositories/TransactionRepository";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

describe("R08 ordinary transaction owner over signed HTTP", () => {
  beforeAll(start, 30000);
  beforeEach(reset);
  afterAll(async () => {
    await db.delete(outboxEvents).where(eq(outboxEvents.householdId, a));
    await stop();
  });

  function post(owner: string | null | undefined, key: string, signer: "member" | "admin" = "member") {
    return request(app).post("/api/transactions").set("Cookie", actors.get(signer)!.cookie).send({
      accountId: ids.sharedAccount, name: "Owner selection", type: "expense", date: "2026-02-12",
      amount: { currency: "ZMW", amount: "12.35" }, idempotencyKey: key,
      ...(owner === undefined ? {} : { ownerUserId: owner }),
    });
  }

  it.each(["shared", "member", "omitted"] as const)("persists %s ownership separately from the authenticated audit actor", async choice => {
    const actor = actors.get("member")!.id, key = randomUUID();
    const selected = choice === "member" ? actors.get("admin")!.id : choice === "shared" ? null : undefined;
    const expected = selected === undefined ? actor : selected;
    const first = await post(selected, key).expect(201);
    const replay = await post(selected, key).expect(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
    const rows = await pool.query("SELECT id, owner_user_id FROM transactions WHERE idempotency_key=$1", [key]);
    expect(rows.rows).toEqual([{ id: first.body.data.id, owner_user_id: expected }]);
    expect(first.body.data.ownerUserId).toBe(expected);
    expect(replay.body.data.ownerUserId).toBe(expected);
    const audit = await pool.query("SELECT user_id FROM audit_logs WHERE entity_id=$1 AND action='CREATE'", [first.body.data.id]);
    expect(audit.rows).toEqual([{ user_id: actor }]);
    expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [ids.sharedAccount])).rows[0].balance).toBe("976.54");
  });

  it("rejects changed posting terms on the same ordinary create key", async () => {
    const key = randomUUID();
    const first = await post(null, key).expect(201);
    const id = first.body.data.id;
    expect((await post(null, key).expect(200)).body.data.id).toBe(id);

    for (const change of [{ amount: { currency: "ZMW", amount: "13.35" } }, { date: "2026-02-13" }, { type: "income" }]) {
      const replay = await request(app).post("/api/transactions").set("Cookie", actors.get("member")!.cookie).send({
        accountId: ids.sharedAccount, name: "Owner selection", type: "expense", date: "2026-02-12",
        amount: { currency: "ZMW", amount: "12.35" }, ownerUserId: null, idempotencyKey: key, ...change,
      });
      expect.soft(replay.status, JSON.stringify(change)).toBe(409);
    }
    expect((await pool.query("SELECT id, amount, date::text, type FROM transactions WHERE idempotency_key=$1", [key])).rows)
      .toEqual([{ id, amount: "12.35", date: "2026-02-12", type: "expense" }]);
    expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [ids.sharedAccount])).rows[0].balance).toBe("976.54");
    expect((await pool.query("SELECT id FROM audit_logs WHERE entity_id=$1 AND action='CREATE'", [id])).rowCount).toBe(1);
    await expect.poll(async () => (await pool.query(
      "SELECT id FROM outbox_events WHERE household_id=$1 AND aggregate_id=$2 AND event_type='transaction.created'", [a, id],
    )).rowCount).toBe(1);
  });

  it("replays the original owner choice after reassignment and rejects a changed choice", async () => {
    const key = randomUUID(), peer = actors.get("admin")!.id, signer = actors.get("member")!;
    const created = await post(null, key).expect(201);
    const id = created.body.data.id;
    await request(app).put(`/api/transactions/${id}/owner`).set("Cookie", signer.cookie).send({ ownerUserId: peer }).expect(200);
    expect((await post(null, key).expect(200)).body.data).toMatchObject({ id, ownerUserId: peer });
    await post(peer, key).expect(409);
    await post(undefined, key).expect(409);
    expect((await pool.query("SELECT owner_user_id FROM transactions WHERE idempotency_key=$1", [key])).rows).toEqual([{ owner_user_id: peer }]);
    expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [ids.sharedAccount])).rows[0].balance).toBe("976.54");
  });

  it("binds adjustment direction and visibility for ordinary service callers", async () => {
    const key = randomUUID(), actor = actors.get("member")!.id;
    const input = { accountId: ids.sharedAccount, date: "2026-02-12", name: "Account correction",
      type: "balance_adjustment" as const, amount: "18.00", currency: "ZMW", isBalanceAdjustmentIncrease: true };
    const first = await transactionService.createTransaction(input, a, actor, key);
    expect(first.isDuplicate).toBe(false);
    expect(await transactionService.createTransaction({ ...input, isPrivate: false }, a, actor, key))
      .toMatchObject({ isDuplicate: true, transaction: { id: first.transaction.id } });
    for (const change of [{ isBalanceAdjustmentIncrease: false }, { isPrivate: true }, { isExcludedFromReports: true },
      { isExcludedFromBudget: true }, { isPending: true }, { amount: "18.001" }]) {
      await expect(transactionService.createTransaction({ ...input, ...change }, a, actor, key))
        .rejects.toMatchObject({ statusCode: 409 });
    }
    expect((await pool.query("SELECT posted_balance_delta, is_private FROM transactions WHERE idempotency_key=$1", [key])).rows)
      .toEqual([{ posted_balance_delta: "18.00", is_private: false }]);
    expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [ids.sharedAccount])).rows[0].balance).toBe("1006.89");
  });

  it("posts and replays the caller's original values when its object changes in flight", async () => {
    const actor = actors.get("member")!.id, key = randomUUID();
    const input = { accountId: ids.sharedAccount, date: "2026-02-12", name: "Fare", type: "expense" as const,
      amount: "16.00", currency: "ZMW", reviewedAt: new Date("2026-02-12T12:00:00Z"), tags: ["personal"],
      splits: [{ amount: "16.00", notes: "Original fare" }] };
    const original = structuredClone(input);
    const pending = transactionService.createTransaction(input, a, actor, key);
    input.amount = "26.00";
    input.splits[0].amount = "26.00";
    input.splits[0].notes = "Changed fare";
    input.tags[0] = "changed";
    input.reviewedAt.setUTCFullYear(2027);
    const { transaction } = await pending;
    expect(transaction).toMatchObject({ amount: original.amount, reviewedAt: original.reviewedAt });
    expect((await pool.query("SELECT amount, notes FROM transaction_splits WHERE transaction_id=$1", [transaction.id])).rows)
      .toEqual(original.splits);
    expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [ids.sharedAccount])).rows[0].balance).toBe("972.89");
    expect(await transactionService.createTransaction(original, a, actor, key)).toMatchObject({ isDuplicate: true, transaction: { id: transaction.id } });
    await expect(transactionService.createTransaction(input, a, actor, key)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("recovers only the matching key when a supplied row ID collides after the initial lookup", async () => {
    const actor = actors.get("member")!.id, key = randomUUID();
    const input = { id: randomUUID(), accountId: ids.sharedAccount, date: "2026-02-12", name: "Fare",
      type: "expense" as const, amount: "12.00", currency: "ZMW" };
    const original = await transactionService.createTransaction(input, a, actor, key);
    const lookup = vi.spyOn(transactionRepository, "findByIdempotencyKey");
    try {
      lookup.mockResolvedValueOnce(undefined);
      expect(await transactionService.createTransaction(input, a, actor, key))
        .toMatchObject({ isDuplicate: true, transaction: { id: original.transaction.id } });
      lookup.mockResolvedValueOnce(undefined);
      await expect(transactionService.createTransaction({ ...input, amount: "13.00" }, a, actor, key))
        .rejects.toMatchObject({ statusCode: 409 });
      await expect(transactionService.createTransaction(input, a, actor, randomUUID())).rejects.toThrow();
      expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [ids.sharedAccount])).rows[0].balance).toBe("976.89");
    } finally { lookup.mockRestore(); }
  });

  it("rejects import-only posting options on a first ordinary request and an ordinary replay", async () => {
    const actor = actors.get("member")!.id, key = randomUUID();
    const input = { accountId: ids.sharedAccount, date: "2026-02-12", name: "Fare",
      type: "expense" as const, amount: "12.00", currency: "ZMW", source: "csv_import" as const };
    const create = (options?: Parameters<typeof transactionService.createTransaction>[5]) =>
      transactionService.createTransaction(input, a, actor, key, undefined, options);
    for (const options of [{ initialImportTagNames: ["unapproved"] }, { postingMode: "history_only" as const }]) {
      await expect(create(options)).rejects.toMatchObject({ statusCode: 400 });
    }
    const first = await create();
    await expect(create({ initialImportTagNames: ["unapproved"] })).rejects.toMatchObject({ statusCode: 400 });
    expect((await create()).transaction.id).toBe(first.transaction.id);
    expect((await pool.query("SELECT id FROM tags WHERE household_id=$1 AND name='unapproved'", [a])).rows).toEqual([]);
  });

  it("binds the original normalized request even after a signed edit", async () => {
    const key = randomUUID();
    const signer = actors.get("member")!;
    const create = (changes: Record<string, unknown> = {}) => request(app).post("/api/transactions").set("Cookie", signer.cookie).send({
      accountId: ids.sharedAccount, description: "Bus fare", date: "2026-02-12", type: "expense",
      amount: { currency: "ZMW", amount: "12.3" }, notes: "Original note", idempotencyKey: key, ...changes,
    });
    const { id } = (await create().expect(201)).body.data;
    await request(app).put(`/api/transactions/${id}`).set("Cookie", signer.cookie).send({ notes: "Edited note" }).expect(200);
    const equivalent = await create({ description: undefined, name: "Bus fare", accountId: ids.sharedAccount.toUpperCase(),
      amount: { currency: "ZMW", amount: "012.30" } }).expect(200);
    expect(equivalent.body.data).toMatchObject({ id, notes: "Edited note" });
    const categoryId = randomUUID(), merchantId = randomUUID();
    await db.insert(categories).values({ id: categoryId, householdId: a, name: "Replay category", displayOrder: 1 });
    await db.insert(merchants).values({ id: merchantId, householdId: a, name: "Replay merchant" });
    for (const changes of [{ notes: "Edited note" }, { tags: ["work"] }, { isRecurring: true },
      { splits: [{ amount: { currency: "ZMW", amount: "12.30" }, notes: "Split" }] },
      { categoryId }, { merchantId }]) {
      await create(changes).expect(409);
    }
    await create({ categoryId: randomUUID() }).expect(404);
    await expect(pool.query("UPDATE transaction_create_owner_intents SET request_digest=NULL WHERE transaction_id=$1", [id]))
      .rejects.toMatchObject({ code: "23514" });
  });

  it.each([true, false])("resolves overlapping ordinary keys when only one debit fits (identical=%s)", async identical => {
    const key = randomUUID();
    const create = (amount: string) => request(app).post("/api/transactions").set("Cookie", actors.get("member")!.cookie).send({
      accountId: ids.sharedAccount, name: "Fare", type: "expense", date: "2026-02-12",
      amount: { currency: "ZMW", amount }, idempotencyKey: key,
    });
    const lookup = transactionRepository.findByIdempotencyKey.bind(transactionRepository);
    let misses = 0;
    let release!: () => void;
    const bothMissed = new Promise<void>(resolve => { release = resolve; });
    const barrier = vi.spyOn(transactionRepository, "findByIdempotencyKey").mockImplementation(async (...args) => {
      const row = await lookup(...args);
      if (args[0] === key && !row && misses < 2) {
        if (++misses === 2) release();
        await bothMissed;
      }
      return row;
    });
    try {
      const amounts = ["600.00", identical ? "600.00" : "700.00"];
      const responses = await Promise.all(amounts.map(create));
      expect(misses).toBe(2);
      expect(responses.map(response => response.status).sort()).toEqual(identical ? [200, 201] : [201, 409]);
      const winner = responses.findIndex(response => response.status === 201);
      expect((await create(amounts[winner]).expect(200)).body.data.id).toBe(responses[winner].body.data.id);
      expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [ids.sharedAccount])).rows[0].balance)
        .toBe(amounts[winner] === "600.00" ? "388.89" : "288.89");
    } finally {
      release();
      barrier.mockRestore();
    }
  });

  it("commits only one original owner when two signed choices race for the same key", async () => {
    const key = randomUUID(), peer = actors.get("admin")!.id;
    const results = await Promise.all([post(null, key), post(peer, key)]);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
    const created = results.find(result => result.status === 201)!;
    expect((await pool.query("SELECT owner_user_id FROM transactions WHERE idempotency_key=$1", [key])).rows)
      .toEqual([{ owner_user_id: created.body.data.ownerUserId }]);
  });

  it("retains omitted-owner retries for legacy postings without attesting an explicit choice", async () => {
    const key = randomUUID(), actor = actors.get("member")!.id;
    await pool.query("UPDATE transactions SET idempotency_key=$1, owner_user_id=$2 WHERE id=$3", [key, actor, ids.sharedTx]);
    expect((await post(undefined, key).expect(200)).body.data.id).toBe(ids.sharedTx);
    await post(null, key).expect(409);
    await post(actor, key).expect(409);
    await expect(pool.query(`INSERT INTO transaction_create_owner_intents
      (transaction_id,idempotency_key,household_id,actor_user_id,owner_selected) VALUES ($1,$2,$3,$4,false)`,
      [ids.sharedTx, key, a, actor])).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects a second signer's omitted-owner retry on a visible posting", async () => {
    const key = randomUUID();
    const created = await post(undefined, key).expect(201);
    await post(undefined, key, "admin").expect(409);
    expect((await post(undefined, key).expect(200)).body.data.id).toBe(created.body.data.id);
  });

  function recurring(key: string) {
    return request(app).post("/api/recurring/transaction").set("Cookie", actors.get("member")!.cookie).send({
      accountId: ids.sharedAccount, name: "Monthly fare", type: "expense", date: "2026-02-12",
      amount: { currency: "ZMW", amount: "12.35" }, idempotencyKey: key, recurring: { frequency: "monthly" },
    });
  }

  it.each([true, false])("checks stored visibility before rejecting ordinary-key reuse by recurring create (private=%s)", async concealed => {
    const key = randomUUID(), actor = actors.get("owner")!;
    const first = await request(app).post("/api/transactions").set("Cookie", actor.cookie).send({
      accountId: concealed ? ids.privateAccount : ids.sharedAccount, name: "Original fare", type: "expense",
      date: "2026-02-12", amount: { currency: "ZMW", amount: "12.35" }, idempotencyKey: key,
    }).expect(201);
    const snapshot = async () => (await pool.query(`SELECT
      (SELECT count(*) FROM recurring_transactions WHERE household_id=$1) AS rules,
      (SELECT count(*) FROM audit_logs WHERE household_id=$1) AS audits,
      (SELECT count(*) FROM outbox_events WHERE household_id=$1) AS events,
      (SELECT row_to_json(t) FROM transactions t WHERE id=$2) AS posting`, [a, first.body.data.id])).rows;
    const before = await snapshot();
    await recurring(key).expect(concealed ? 404 : 409);
    expect(await snapshot()).toEqual(before);
  });

  it("replays a keyed recurring creation only through its original operation", async () => {
    const key = randomUUID(), created = await recurring(key).expect(201);
    const again = await recurring(key).expect(201);
    expect(again.body.data).toMatchObject({ isDuplicate: true, transaction: { id: created.body.data.transaction.id },
      recurringRule: { id: created.body.data.recurringRule.id } });
    await post(undefined, key).expect(409);
    expect((await pool.query("SELECT id FROM transactions WHERE idempotency_key=$1", [key])).rowCount).toBe(1);
  });

  it("rejects evidence reserved by a different connection while a legacy posting is uncommitted", async () => {
    const id = randomUUID(), key = randomUUID(), actor = actors.get("member")!.id;
    const writer = await pool.connect(), claimant = await pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query(`INSERT INTO transactions (id,idempotency_key,household_id,account_id,owner_user_id,type,name,date,amount,currency)
        VALUES ($1,$2,$3,$4,$5,'expense','Legacy posting','2026-02-12','12.35','ZMW')`, [id,key,a,ids.sharedAccount,actor]);
      await claimant.query("BEGIN");
      await claimant.query(`INSERT INTO transaction_create_owner_intents
        (transaction_id,idempotency_key,household_id,actor_user_id,owner_selected) VALUES ($1,$2,$3,$4,true)`, [id,key,a,actor]);
      await writer.query("COMMIT");
      await expect(claimant.query("COMMIT")).rejects.toMatchObject({ code: "23514" });
      expect((await pool.query("SELECT id FROM transactions WHERE id=$1", [id])).rowCount).toBe(1);
      expect((await pool.query("SELECT transaction_id FROM transaction_create_owner_intents WHERE transaction_id=$1", [id])).rowCount).toBe(0);
    } finally {
      try { await Promise.all([writer.query("ROLLBACK"), claimant.query("ROLLBACK")]); }
      finally { writer.release(); claimant.release(); }
    }
  });

  it.each([false,true])("refuses a temporary trigger claiming another connection's posting (refresh row version=%s)", async refresh => {
    const writer = await pool.connect(), claimant = await pool.connect();
    const id = randomUUID(), key = randomUUID(), actor = actors.get("member")!.id;
    try {
      await writer.query("BEGIN");
      await writer.query(`INSERT INTO transactions (id,idempotency_key,household_id,account_id,owner_user_id,type,name,date,amount,currency)
        VALUES ($1,$2,$3,$4,$5,'expense','Overlapping posting','2026-02-12','12.35','ZMW')`, [id,key,a,ids.sharedAccount,actor]);
      await claimant.query("BEGIN");
      await claimant.query(`INSERT INTO transaction_create_owner_intents
        (transaction_id,idempotency_key,household_id,actor_user_id,owner_selected) VALUES ($1,$2,$3,$4,true)`, [id,key,a,actor]);
      await claimant.query("CREATE TEMP TABLE owner_claim (id uuid) ON COMMIT DROP");
      await claimant.query(`CREATE OR REPLACE FUNCTION pg_temp.seal_owner_claim() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN UPDATE public.transaction_create_owner_intents SET posting_confirmed=true WHERE transaction_id=NEW.id; RETURN NEW; END $$`);
      await claimant.query("CREATE TRIGGER claim AFTER INSERT ON owner_claim FOR EACH ROW EXECUTE FUNCTION pg_temp.seal_owner_claim()");
      if (refresh) {
        await writer.query("COMMIT");
        await expect(claimant.query("UPDATE public.transactions SET notes='Updated by claimant' WHERE id=$1", [id]))
          .rejects.toMatchObject({ code: "23514" });
      } else {
        await expect(claimant.query("INSERT INTO owner_claim VALUES ($1)", [id])).rejects.toMatchObject({ code: "23514" });
        await writer.query("COMMIT");
      }
    } finally {
      try { await Promise.all([writer.query("ROLLBACK"), claimant.query("ROLLBACK")]); }
      finally { writer.release(); claimant.release(); }
    }
    expect((await pool.query("SELECT transaction_id FROM transaction_create_owner_intents WHERE transaction_id=$1", [id])).rows).toEqual([]);
  });

  it("allows another authorized importer to replay shared rows and continue, but denies ordinary and private collisions", async () => {
    const row = { date: "2026-02-12", merchant: "Statement fare", amount: "-10.00" };
    const account = ids.sharedAccount;
    const importRows = (who: "owner" | "member", accountId: string, rows: typeof row[],
      decisions: { row: number; matchesTransactionId: string; decision: "post" }[] = []) => request(app)
      .post(`/api/accounts/${accountId}/transactions/import`).set("Cookie", actors.get(who)!.cookie)
      .send({ adjustBalance: true, transactions: rows, possibleDuplicateDecisions: decisions });
    const readLedger = async () => ({
      balance: (await pool.query("SELECT balance FROM accounts WHERE id=$1", [account])).rows[0].balance,
      postings: (await pool.query(`SELECT t.id, t.idempotency_key, t.name, t.original_name, t.amount,
        t.posted_balance_delta, t.currency, al.user_id AS audit_actor FROM transactions t
        LEFT JOIN audit_logs al ON al.entity_id=t.id AND al.action='CREATE' AND al.entity_type='transaction'
        WHERE t.account_id=$1 AND t.source='csv_import' ORDER BY t.id`, [account])).rows,
    });
    const readHistory = async () => (await pool.query(`SELECT di.id, di.user_id, di.imported_count, di.duplicate_count,
      di.row_outcomes, al.user_id AS audit_actor FROM data_imports di
      LEFT JOIN audit_logs al ON al.entity_id=di.account_id AND al.action='CREATE' AND al.entity_type='transaction_import'
        AND al.details->'newValue'->>'importId'=di.id::text
      WHERE di.account_id=$1 ORDER BY di.id`, [account])).rows;

    expect((await importRows("owner", account, [row]).expect(200)).body.data).toMatchObject({ imported: 1, skipped: 0 });
    const firstLedger = await readLedger();
    const owner = actors.get("owner")!.id;
    const member = actors.get("member")!.id;
    const posting = { amount: "10.00", posted_balance_delta: "-10.00", currency: "ZMW" };
    expect(firstLedger).toEqual({ balance: "978.89", postings: [expect.objectContaining({ ...posting,
      id: expect.any(String), idempotency_key: expect.any(String), original_name: row.merchant, audit_actor: owner })] });
    const [original] = firstLedger.postings;

    // An exact statement replays for the other importer without another posting.
    const second = await importRows("member", account.toUpperCase(), [row]).expect(200);
    expect(second.body.data).toMatchObject({ imported: 0, skipped: 1 });
    expect(await readLedger()).toEqual(firstLedger);
    const beforeReview = await readHistory();
    expect(beforeReview).toHaveLength(2);
    expect(beforeReview).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: owner, audit_actor: owner, imported_count: 1, duplicate_count: 0,
        row_outcomes: [{ ordinal: 1, outcome: "imported", transactionId: original.id }] }),
      expect.objectContaining({ user_id: member, audit_actor: member, imported_count: 0, duplicate_count: 1,
        row_outcomes: [{ ordinal: 1, outcome: "duplicate", transactionId: original.id }] }),
    ]));

    // A different merchant at the same date and amount requires a decision on this visible candidate.
    const distinct = { ...row, merchant: "Second fare" };
    const held = await importRows("member", account, [distinct]).expect(409);
    expect(held.body.error.code).toBe("IMPORT_REVIEW_REQUIRED");
    expect(held.body.error.details.possibleDuplicates).toEqual([{ row: 1, matchesTransactionId: original.id,
      match: { name: original.name, date: row.date, type: "expense", amount: { amount: "10.00", currency: "ZMW" } } }]);
    expect(await readLedger()).toEqual(firstLedger);
    expect(await readHistory()).toEqual(beforeReview);

    const accepted = await importRows("member", account, [distinct], [
      { row: 1, matchesTransactionId: original.id, decision: "post" },
    ]).expect(200);
    const saved = await readLedger();
    const added = saved.postings.find(posting => posting.id !== original.id);
    expect(saved.balance).toBe("968.89");
    expect(saved.postings).toHaveLength(2);
    expect(saved.postings).toContainEqual(original);
    expect(added).toMatchObject({ ...posting, idempotency_key: expect.any(String), original_name: distinct.merchant, audit_actor: member });
    expect(added!.idempotency_key).not.toBe(original.idempotency_key);
    expect(accepted.body.data).toMatchObject({ imported: 1, skipped: 0,
      possibleDuplicates: [{ row: 1, matchesTransactionId: original.id, transactionId: added!.id }] });
    const acceptedHistory = await readHistory();
    expect(acceptedHistory).toHaveLength(3);
    expect(acceptedHistory).toEqual(expect.arrayContaining([...beforeReview, expect.objectContaining({
      user_id: member, audit_actor: member, imported_count: 1, duplicate_count: 0,
      row_outcomes: [{ ordinal: 1, outcome: "imported", transactionId: added!.id, possibleDuplicateOf: original.id }],
    })]));

    const replay = await importRows("owner", account, [distinct]).expect(200);
    expect(replay.body.data).toMatchObject({ imported: 0, skipped: 1 });
    const replayedHistory = await readHistory();
    expect(replayedHistory).toHaveLength(4);
    expect(replayedHistory).toEqual(expect.arrayContaining([...acceptedHistory, expect.objectContaining({
      user_id: owner, audit_actor: owner, imported_count: 0, duplicate_count: 1,
      row_outcomes: [{ ordinal: 1, outcome: "duplicate", transactionId: added!.id }],
    })]));

    await post(undefined, original.idempotency_key).expect(409);
    await importRows("owner", ids.privateAccount, [row]).expect(200);
    await importRows("member", ids.privateAccount, [row]).expect(404);
    expect(await readLedger()).toEqual(saved);
    expect(await readHistory()).toEqual(replayedHistory);
  });

  it("does not infer legacy recurring creation from a subsequently linked ordinary posting", async () => {
    const key = randomUUID();
    await pool.query("UPDATE transactions SET idempotency_key=$1 WHERE id=$2", [key, ids.sharedTx]);
    await request(app).post(`/api/recurring/transaction/${ids.sharedTx}`).set("Cookie", actors.get("member")!.cookie)
      .send({ frequency: "monthly" }).expect(200);
    await recurring(key).expect(409);
  });

  it.each(["source becomes private", "USD destination"] as const)("refuses a first coupon posting when %s", async scenario => {
    const [bond] = await db.insert(grzBonds).values({ householdId: a, accountId: ids.sharedAccount, bondName: "Coupon admission",
      faceValue: "1000", purchasePrice: "1000", couponRate: "10", purchaseDate: "2026-01-01", maturityDate: "2029-01-01", tenorYears: 3 }).returning();
    const [payment] = await db.insert(grzBondPayments).values({ bondId: bond.id, paymentDate: "2026-07-01",
      grossAmount: "50", withholdingTax: "5", netAmount: "45", paymentType: "coupon", status: "scheduled" }).returning();
    const snapshot = async () => (await pool.query(`SELECT
      (SELECT balance FROM accounts WHERE id=$1) AS balance,
      (SELECT count(*) FROM transactions WHERE household_id=$2) AS postings,
      (SELECT count(*) FROM audit_logs WHERE household_id=$2) AS audits,
      (SELECT count(*) FROM outbox_events WHERE household_id=$2) AS events,
      (SELECT count(*) FROM transaction_create_owner_intents WHERE household_id=$2) AS intents,
      (SELECT row_to_json(p) FROM grz_bond_payments p WHERE id=$3) AS payment`, [ids.sharedAccount, a, payment.id])).rows;
    try {
      if (scenario === "USD destination") {
        await pool.query("UPDATE accounts SET currency='USD' WHERE id=$1", [ids.sharedAccount]);
      }
      const before = await snapshot();
      const pay = () => request(app).post(`/api/grz/payments/${payment.id}/pay`).set("Cookie", actors.get("member")!.cookie)
        .send({ accountId: ids.sharedAccount, date: "2026-07-01" }).then(response => response.status);
      if (scenario === "source becomes private") {
        // Admission sees the old source while the writer holds the change uncommitted.
        const blocker = await pool.connect();
        let pending: Promise<number> | undefined;
        try {
          await blocker.query("BEGIN");
          await blocker.query("UPDATE grz_bonds SET account_id=$1 WHERE id=$2", [ids.privateAccount, bond.id]);
          const { rows: [backend] } = await blocker.query("SELECT pg_backend_pid() AS pid");
          pending = pay();
          let waiting = false;
          const deadline = Date.now() + 5000;
          while (!waiting && Date.now() < deadline) {
            const { rows } = await pool.query("SELECT EXISTS (SELECT FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting", [backend.pid]);
            waiting = rows[0].waiting;
            if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
          }
          await blocker.query("COMMIT");
          expect(await pending).toBe(404);
          expect(waiting).toBe(true);
        } finally {
          try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
          if (pending) await Promise.allSettled([pending]);
        }
      } else {
        expect(await pay()).toBe(400);
      }
      expect(await snapshot()).toEqual(before);
      if (scenario === "source becomes private") {
        expect((await pool.query("SELECT account_id FROM grz_bonds WHERE id=$1", [bond.id])).rows[0].account_id).toBe(ids.privateAccount);
      }
    } finally {
      vi.restoreAllMocks();
      await db.delete(grzBondPayments).where(eq(grzBondPayments.id, payment.id));
      await db.delete(grzBonds).where(eq(grzBonds.id, bond.id));
    }
  });

  it.each(["uppercase", "omitted date", "conflicting date", "private bond", "downgrade", "stranded USD", "sold after posting"] as const)
  ("checks coupon recovery after a genuine payment rollback: %s", async scenario => {
    const [bond] = await db.insert(grzBonds).values({ householdId: a, accountId: ids.sharedAccount, bondName: "Owner replay bond",
      faceValue: "1000", purchasePrice: "1000", couponRate: "10", purchaseDate: "2026-01-01", maturityDate: "2029-01-01", tenorYears: 3 }).returning();
    const [payment] = await db.insert(grzBondPayments).values({ bondId: bond.id, paymentDate: "2026-07-01",
      grossAmount: "50", withholdingTax: "5", netAmount: "45", paymentType: "coupon", status: "scheduled" }).returning();
    const pay = (who: "owner" | "member", date: string | null = "2026-07-01") => request(app)
      .post(`/api/grz/payments/${who === "member" && scenario === "uppercase" ? payment.id.toUpperCase() : payment.id}/pay`)
      .set("Cookie", actors.get(who)!.cookie).send({
        accountId: who === "member" && scenario === "uppercase" ? ids.sharedAccount.toUpperCase() : ids.sharedAccount,
        ...(date !== null && { date }),
      });
    const hook = "r08_coupon_" + payment.id.replace(/-/g, "");
    try {
      await pool.query(`CREATE FUNCTION ${hook}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic payment failure'; END $$`);
      try {
        await pool.query(`CREATE TRIGGER ${hook} BEFORE UPDATE ON grz_bond_payments FOR EACH ROW WHEN (NEW.id='${payment.id}'::uuid) EXECUTE FUNCTION ${hook}()`);
        await pay("owner").expect(500);
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${hook} ON grz_bond_payments`);
        await pool.query(`DROP FUNCTION IF EXISTS ${hook}()`);
      }
      const posted = await pool.query("SELECT id,idempotency_key FROM transactions WHERE account_id=$1 AND type='income'", [ids.sharedAccount]);
      expect(posted.rows).toHaveLength(1);
      if (scenario === "sold after posting") {
        await db.update(grzBonds).set({ status: "sold", soldDate: "2026-07-02" }).where(eq(grzBonds.id, bond.id));
      }
      await post(undefined, posted.rows[0].idempotency_key).expect(409);
      if (scenario === "stranded USD") {
        // Synthetic legacy damage: the receipt identifies a coupon, but the posted currency is wrong.
        await pool.query("UPDATE transactions SET currency='USD' WHERE id=$1", [posted.rows[0].id]);
      }
      if (scenario === "private bond") {
        await db.update(grzBonds).set({ accountId: ids.privateAccount }).where(eq(grzBonds.id, bond.id));
      }
      if (scenario === "downgrade") {
        const actual = transactionService.createTransaction.bind(transactionService);
        vi.spyOn(transactionService, "createTransaction").mockImplementationOnce(async (...args) => {
          const replay = await actual(...args);
          expect(replay.isDuplicate).toBe(true);
          await pool.query("UPDATE household_members SET role='view_only' WHERE household_id=$1 AND user_id=$2", [a, actors.get("member")!.id]);
          return replay;
        });
      }
      const status = scenario === "conflicting date" || scenario === "stranded USD" ? 409 : scenario === "private bond" ? 404 : scenario === "downgrade" ? 403 : 200;
      await pay("member", scenario === "omitted date" ? null : scenario === "conflicting date" ? "2026-07-02" : "2026-07-01").expect(status);
      const saved = await pool.query("SELECT status, actual_payment_date::text, income_transaction_id FROM grz_bond_payments WHERE id=$1", [payment.id]);
      expect(saved.rows).toEqual([{ status: status === 200 ? "paid" : "scheduled", actual_payment_date: status === 200 ? "2026-07-01" : null,
        income_transaction_id: status === 200 ? posted.rows[0].id : null }]);
      expect((await pool.query("SELECT id FROM audit_logs WHERE entity_id=$1 AND action='PROCESS'", [payment.id])).rowCount).toBe(status === 200 ? 1 : 0);
      expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [ids.sharedAccount])).rows[0].balance).toBe("1033.89");
      if (scenario === "stranded USD") expect((await pool.query("SELECT amount,currency FROM transactions WHERE id=$1", [posted.rows[0].id])).rows)
        .toEqual([{ amount: "45.00", currency: "USD" }]);
    } finally {
      vi.restoreAllMocks();
      await db.delete(grzBondPayments).where(eq(grzBondPayments.id, payment.id));
      await db.delete(grzBonds).where(eq(grzBonds.id, bond.id));
    }
  });

  it("protects original intent and its operation key until the posting is erased", async () => {
    const key = randomUUID(), actor = actors.get("member")!.id;
    const id = (await post(null, key).expect(201)).body.data.id;
    expect((await pool.query("SELECT * FROM transaction_create_owner_intents WHERE transaction_id=$1", [id])).rows).toEqual([{
      transaction_id: id, idempotency_key: key, household_id: a, actor_user_id: actor, owner_selected: true, selected_owner_id: null,
      operation: "ordinary", posting_confirmed: true, request_digest: expect.stringMatching(/^v1:[0-9a-f]{64}$/),
      transfer_group_id: null, transfer_inflow_id: null, transfer_creation_xid: null, transfer_inflow_confirmed: null,
    }]);
    await expect(pool.query("UPDATE transaction_create_owner_intents SET owner_selected=false WHERE transaction_id=$1", [id]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("DELETE FROM transaction_create_owner_intents WHERE transaction_id=$1", [id]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE transactions SET idempotency_key=$1 WHERE id=$2", [randomUUID(), id]))
      .rejects.toMatchObject({ code: "23514" });
    expect((await post(null, key).expect(200)).body.data.id).toBe(id);
    await pool.query("DELETE FROM transactions WHERE id=$1 AND household_id=$2", [id, a]);
    expect((await pool.query("SELECT transaction_id FROM transaction_create_owner_intents WHERE transaction_id=$1", [id])).rows).toEqual([]);
  });

  it("binds a new keyed posting created in a PostgreSQL savepoint", async () => {
    const id = randomUUID(), key = randomUUID(), actor = actors.get("member")!.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_current_xact_id()");
      await client.query("SAVEPOINT nested_posting");
      await client.query(`INSERT INTO transaction_create_owner_intents
        (transaction_id,idempotency_key,household_id,actor_user_id,owner_selected) VALUES ($1,$2,$3,$4,false)`, [id,key,a,actor]);
      await client.query(`INSERT INTO transactions (id,idempotency_key,household_id,account_id,owner_user_id,type,name,date,amount,currency)
        VALUES ($1,$2,$3,$4,$5,'expense','Nested posting','2026-02-12','12.35','ZMW')`, [id,key,a,ids.sharedAccount,actor]);
      await client.query("RELEASE SAVEPOINT nested_posting");
      await client.query("COMMIT");
    } finally {
      try { await client.query("ROLLBACK"); } finally { client.release(); }
    }
    expect((await pool.query("SELECT posting_confirmed FROM transaction_create_owner_intents WHERE transaction_id=$1", [id])).rows)
      .toEqual([{ posting_confirmed: true }]);
  });

  it.each(["outside", "malformed"] as const)("rejects an %s owner before posting", async kind => {
    const key = randomUUID();
    const before = await pool.query("SELECT balance FROM accounts WHERE id=$1", [ids.sharedAccount]);
    await post(kind === "outside" ? actors.get("outsider")!.id : "invalid", key).expect(kind === "outside" ? 404 : 400);
    expect((await pool.query("SELECT id FROM transactions WHERE idempotency_key=$1", [key])).rows).toEqual([]);
    expect((await pool.query("SELECT balance FROM accounts WHERE id=$1", [ids.sharedAccount])).rows).toEqual(before.rows);
  });
});
