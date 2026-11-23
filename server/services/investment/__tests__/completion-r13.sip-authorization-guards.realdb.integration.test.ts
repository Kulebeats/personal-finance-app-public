import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { withFixtureClient } from "../../../testing/fixtures/fixture-context";

/**
 * Migration0028 storage mechanics ONLY. These deliberately direct-SQL grants,
 * audit rows and proofs do not establish a signed human authorization, the
 * digest algorithm, executor correctness or real account-erasure acceptance.
 * No SID is invented. The protected fixture helper verifies the disposable
 * manifest and persisted run marker before every connection.
 *
 * A committed mechanical baseline makes old-row/creation-xid tests meaningful.
 * Every probe rolls back; even successful TRUNCATE on a broken schema rolls
 * back. Only the explicitly marked deferred-COMMIT and two-client race probes
 * open extra transactions. Cleanup is scoped to this fixture's UUIDs.
 * Restricted-writer compatibility is intentionally a separate acceptance gap:
 * this suite does not create cluster roles or grant evidence-table privileges.
 */
const ids = {
  home: randomUUID(), otherHome: randomUUID(), author: randomUUID(), peer: randomUUID(),
  custody: randomUUID(), otherCustody: randomUUID(), instrument: randomUUID(),
  plan: randomUUID(), peerPlan: randomUUID(), otherPlan: randomUUID(),
  grant: randomUUID(), peerGrant: randomUUID(), otherGrant: randomUUID(),
  operation: randomUUID(), oldBuy: randomUUID(), provenBuy: randomUUID(),
};
const digest = "a".repeat(64), initialDate = "2031-01-20";
const extraCommittedPurchases = new Set<string>();
let baselineCommitted = false;

const messages = {
  proof: "Completed investment authorization proof is unavailable or immutable",
  reservation: "SIP purchase reservation is immutable",
  insertOnly: "A reserved SIP purchase can only be bound by its real INSERT",
  incomplete: "SIP reservation requires a completed new purchase and proof",
  purge: "Cannot purge a surviving SIP purchase reservation before completed proof",
  purchase: "Completed authorized investment purchase is immutable",
  initialRevision: "New investment plan must start without authorization at revision zero",
  unchangedRevision: "Investment plan authorization revision must remain unchanged",
  nextRevision: "Investment plan authorization revision must advance exactly once",
  exhaustedRevision: "Investment plan authorization revision is exhausted",
};
type SqlFailure = { code: string; message?: string; constraint?: string };

async function rollbackProbe(operation: (client: Client) => Promise<void>) {
  await withFixtureClient(async client => {
    await client.query("BEGIN");
    try { await operation(client); }
    finally { await client.query("ROLLBACK"); }
  });
}

// Restore the exact pre-attempt state even when an unexpectedly accepted write
// makes the assertion fail. Each refusal checks the intended guard/FK by name.
async function refuses(client: Client, text: string, values: unknown[], failure: SqlFailure) {
  await client.query("SAVEPOINT refused_sip_guard");
  try { await expect(client.query(text, values)).rejects.toMatchObject(failure); }
  finally {
    await client.query("ROLLBACK TO SAVEPOINT refused_sip_guard");
    await client.query("RELEASE SAVEPOINT refused_sip_guard");
  }
}

async function purchase(client: Client, id: string, createdAt = "2000-01-01T00:00:00Z") {
  await client.query(`INSERT INTO public.investment_transactions
    (id,household_id,account_id,security_id,type,quantity,price,amount,currency,amount_zmw,transaction_date,created_at)
    VALUES ($1,$2,$3,$4,'buy','5','2','10.00','ZMW','10.00',$5,$6)`,
  [id, ids.home, ids.custody, ids.instrument, initialDate, createdAt]);
}

async function reserve(client: Client, id: string, authorization = ids.grant) {
  // Both caller-supplied fields must be replaced by the INSERT guard.
  await client.query(`INSERT INTO public.investment_sip_purchase_reservations
    (purchase_id,authorization_id,creation_xid,posting_confirmed) VALUES ($1,$2,'caller-xid',true)`, [id, authorization]);
}

async function audit(client: Client, id: string) {
  await client.query(`INSERT INTO public.audit_logs (household_id,user_id,action,entity_type,entity_id,details)
    VALUES ($1::uuid,NULL,'CREATE','investment_transaction',$2::uuid,jsonb_build_object('actor','system','trigger','sip',
      'authorizationContractVersion',1,'authorizationProofPurchaseId',$2::text))`, [ids.home, id]);
}

const proofProjection = {
  author_user_id: "g.author_user_id", authorized_at: "g.authorized_at",
  authorization_contract_version: "g.authorization_contract_version", authorized_frequency: "g.frequency",
  authorized_initial_date: "g.initial_execution_date", authorized_terms_digest: "g.authorized_terms_digest",
};
async function proof(client: Client, id: string, authorization = ids.grant,
  overrides: Partial<Record<keyof typeof proofProjection, string>> = {}) {
  // SQL fragments are fixed test-source constants, never application input.
  const columns = { ...proofProjection, ...overrides };
  await client.query(`INSERT INTO public.investment_purchase_authorization_proofs
    (purchase_id,${Object.keys(columns).join(",")}) SELECT $1,${Object.values(columns).join(",")}
    FROM public.investment_plan_authorizations g WHERE g.id=$2`, [id, authorization]);
}

async function completedMechanicalPurchase(client: Client, id: string) {
  await reserve(client, id);
  await purchase(client, id);
  await audit(client, id);
  await proof(client, id);
}

async function evidence(client: Client, id: string) {
  return {
    purchase: (await client.query("SELECT to_jsonb(p) AS data FROM public.investment_transactions p WHERE id=$1", [id])).rows,
    reservation: (await client.query("SELECT to_jsonb(r) AS data FROM public.investment_sip_purchase_reservations r WHERE purchase_id=$1", [id])).rows,
    proof: (await client.query("SELECT to_jsonb(p) AS data FROM public.investment_purchase_authorization_proofs p WHERE purchase_id=$1", [id])).rows,
    audit: (await client.query("SELECT to_jsonb(a) AS data FROM public.audit_logs a WHERE entity_id=$1 ORDER BY id", [id])).rows,
  };
}

async function addGrant(client: Client, plan: string, home: string, author: string, custody: string, id: string, revision = 1) {
  await client.query(`INSERT INTO public.investment_plan_authorizations
    (id,plan_id,household_id,author_user_id,revision,authorization_contract_version,authorization_kind,
      security_generation,account_id,security_id,amount,currency,frequency,initial_execution_date,authorized_terms_digest)
    VALUES ($1,$2,$3,$4,$9,1,'record_only_sip',0,$5,$6,'10.00','ZMW','monthly',$7,$8)`,
  [id, plan, home, author, custody, ids.instrument, initialDate, digest, revision]);
}

async function operationReceipt(client: Client, plan: string, home: string, actor: string, authorization: string | null,
  operation = randomUUID()) {
  await client.query(`INSERT INTO public.investment_plan_operations
    (household_id,actor_user_id,operation_id,action,request_version,request_digest,expected_revision,plan_id,authorization_id)
    VALUES ($1,$2,$3,'create',1,$4,0,$5,$6)`, [home, actor, operation, digest, plan, authorization]);
}

async function freshPlan(client: Client, id = randomUUID()) {
  await client.query(`INSERT INTO public.recurring_investments
    (id,household_id,account_id,security_id,type,frequency,amount,currency,next_execution_date)
    VALUES ($1,$2,$3,$4,'sip','monthly','10.00','ZMW',$5)`, [id, ids.home, ids.custody, ids.instrument, initialDate]);
  return id;
}

async function planAuthority(client: Client, id: string) {
  return (await client.query<{ current_authorization_id: string | null; authorization_revision: number }>(
    "SELECT current_authorization_id,authorization_revision FROM public.recurring_investments WHERE id=$1", [id])).rows;
}

describe("R13 migration0028 direct-SQL authorization guard controls (not signed authority)", () => {
  beforeAll(async () => {
    await withFixtureClient(async client => {
      await client.query("BEGIN");
      try {
        for (const id of [ids.author, ids.peer]) await client.query(`INSERT INTO public.users
          (id,username,email,password_hash,email_verified,security_generation)
          VALUES ($1,$2,$3,'synthetic-no-login-storage-control',true,0)`,
        [id, `sip-guard-${id}`, `sip-guard-${id}@example.invalid`]);
        for (const id of [ids.home, ids.otherHome]) await client.query(
          "INSERT INTO public.households (id,name,currency) VALUES ($1,'Synthetic SQL SIP guards','ZMW')", [id]);
        // One owner per household (NEW-12); the guards accept owner, admin and member alike.
        for (const [home, author, role] of [[ids.home, ids.author, "owner"], [ids.home, ids.peer, "admin"], [ids.otherHome, ids.peer, "owner"]]) {
          await client.query("INSERT INTO public.household_members (household_id,user_id,role) VALUES ($1,$2,$3)", [home, author, role]);
        }
        for (const [id, home] of [[ids.custody, ids.home], [ids.otherCustody, ids.otherHome]]) {
          await client.query(`INSERT INTO public.accounts (id,household_id,name,type,currency,balance,initial_balance)
            VALUES ($1,$2,'Synthetic SQL custody','investment','ZMW','0.00','0.00')`, [id, home]);
        }
        await client.query(`INSERT INTO public.securities (id,symbol,name,type,currency)
          VALUES ($1,'SIP_SQL_GUARD','Synthetic SQL guard instrument','stock','ZMW')`, [ids.instrument]);
        for (const [plan, home, author, custody, authorization] of [
          [ids.plan, ids.home, ids.author, ids.custody, ids.grant],
          [ids.peerPlan, ids.home, ids.peer, ids.custody, ids.peerGrant],
          [ids.otherPlan, ids.otherHome, ids.peer, ids.otherCustody, ids.otherGrant],
        ]) {
          await client.query(`INSERT INTO public.recurring_investments
            (id,household_id,account_id,security_id,type,frequency,amount,currency,next_execution_date)
            VALUES ($1,$2,$3,$4,'sip','monthly','10.00','ZMW',$5)`, [plan, home, custody, ids.instrument, initialDate]);
          await addGrant(client, plan, home, author, custody, authorization);
          await client.query(`UPDATE public.recurring_investments
            SET current_authorization_id=$2,authorization_revision=1 WHERE id=$1`, [plan, authorization]);
        }
        await operationReceipt(client, ids.plan, ids.home, ids.author, ids.grant, ids.operation);
        await purchase(client, ids.oldBuy);
        await completedMechanicalPurchase(client, ids.provenBuy);
        await client.query("COMMIT");
        baselineCommitted = true;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    });
  });

  afterEach(async () => {
    if (!extraCommittedPurchases.size) return;
    await withFixtureClient(async client => {
      await client.query("DELETE FROM public.investment_transactions WHERE id=ANY($1::uuid[])", [Array.from(extraCommittedPurchases)]);
    });
    extraCommittedPurchases.clear();
  });
  afterAll(async () => {
    if (!baselineCommitted) return;
    await withFixtureClient(async client => {
      await client.query("BEGIN");
      try {
        // Purchase removal, including proof/reservation cascade, precedes all
        // source/plan deletion. This is fixture cleanup, not an erasure test.
        await client.query("DELETE FROM public.investment_transactions WHERE household_id=ANY($1::uuid[])", [[ids.home, ids.otherHome]]);
        await client.query("DELETE FROM public.audit_logs WHERE household_id=ANY($1::uuid[])", [[ids.home, ids.otherHome]]);
        await client.query("DELETE FROM public.recurring_investments WHERE household_id=ANY($1::uuid[])", [[ids.home, ids.otherHome]]);
        await client.query("DELETE FROM public.accounts WHERE id=ANY($1::uuid[])", [[ids.custody, ids.otherCustody]]);
        await client.query("DELETE FROM public.securities WHERE id=$1", [ids.instrument]);
        await client.query("DELETE FROM public.households WHERE id=ANY($1::uuid[])", [[ids.home, ids.otherHome]]);
        await client.query("DELETE FROM public.users WHERE id=ANY($1::uuid[])", [[ids.author, ids.peer]]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    });
  });

  it.each([
    ["same-household other plan", ids.peerPlan], ["other household", ids.otherPlan],
  ])("rejects a current pointer into %s", async (_label, plan) => rollbackProbe(async client => {
    // Match revision2 and the legal increment so only plan/household binding
    // can reject the other plan's pointer, rather than the revision trigger.
    const authorization = randomUUID();
    await addGrant(client, ids.plan, ids.home, ids.author, ids.custody, authorization, 2);
    await refuses(client, `UPDATE public.recurring_investments
      SET current_authorization_id=$2,authorization_revision=2 WHERE id=$1`, [plan, authorization],
      { code: "23503", constraint: "investment_plan_current_authorization_fk" });
  }));

  it("starts a fresh plan with a NULL pointer and durable revision zero", async () => rollbackProbe(async client => {
    const plan = await freshPlan(client);
    expect(await planAuthority(client, plan)).toEqual([{ current_authorization_id: null, authorization_revision: 0 }]);
  }));

  it.each([
    ["nonzero", 1, null], ["negative", -1, null], ["NULL", null, null], ["nonnull pointer", 0, ids.grant],
  ] as const)("refuses an arbitrary %s initial authorization state before any FK can mask it", async (_label, revision, pointer) => rollbackProbe(async client => {
    const plan = randomUUID();
    await refuses(client, `INSERT INTO public.recurring_investments
      (id,household_id,account_id,security_id,type,frequency,amount,currency,next_execution_date,
        authorization_revision,current_authorization_id)
      VALUES ($1,$2,$3,$4,'sip','monthly','10.00','ZMW',$5,$6,$7)`,
    [plan, ids.home, ids.custody, ids.instrument, initialDate, revision, pointer],
    { code: "23514", message: messages.initialRevision });
    expect(await planAuthority(client, plan)).toEqual([]);
  }));

  it.each([
    ["decrement", "authorization_revision=0"], ["same-pointer bump", "authorization_revision=2"],
    ["NULL counter", "authorization_revision=NULL"],
    ["clear-pointer reset", "current_authorization_id=NULL,authorization_revision=0"],
    ["clear-pointer bump", "current_authorization_id=NULL,authorization_revision=2"],
  ])("refuses a plan revision %s", async (_label, assignment) => rollbackProbe(async client => {
    const before = await planAuthority(client, ids.plan);
    await refuses(client, `UPDATE public.recurring_investments SET ${assignment} WHERE id=$1`, [ids.plan],
      { code: "23514", message: messages.unchangedRevision });
    expect(await planAuthority(client, ids.plan)).toEqual(before);
  }));

  it("compares NULL pointers safely and prevents a revision-only bump after clearing", async () => rollbackProbe(async client => {
    await client.query("UPDATE public.recurring_investments SET current_authorization_id=NULL WHERE id=$1", [ids.plan]);
    const before = [{ current_authorization_id: null, authorization_revision: 1 }];
    expect(await planAuthority(client, ids.plan)).toEqual(before);
    await refuses(client, "UPDATE public.recurring_investments SET authorization_revision=2 WHERE id=$1", [ids.plan],
      { code: "23514", message: messages.unchangedRevision });
    await client.query("UPDATE public.recurring_investments SET current_authorization_id=NULL,authorization_revision=1 WHERE id=$1", [ids.plan]);
    expect(await planAuthority(client, ids.plan)).toEqual(before);
  }));

  it.each([1, 3])("requires a different nonnull pointer to advance exactly once instead of to revision%s", async revision => rollbackProbe(async client => {
    const authorization = randomUUID();
    await addGrant(client, ids.plan, ids.home, ids.peer, ids.custody, authorization, 2);
    await refuses(client, `UPDATE public.recurring_investments
      SET current_authorization_id=$2,authorization_revision=$3 WHERE id=$1`, [ids.plan, authorization, revision],
    { code: "23514", message: messages.nextRevision });
  }));

  it("binds the pointer to the actual grant revision as well as plan and household", async () => rollbackProbe(async client => {
    const authorization = randomUUID();
    await addGrant(client, ids.plan, ids.home, ids.peer, ids.custody, authorization, 3);
    await refuses(client, `UPDATE public.recurring_investments
      SET current_authorization_id=$2,authorization_revision=2 WHERE id=$1`, [ids.plan, authorization],
    { code: "23503", constraint: "investment_plan_current_authorization_fk" });
  }));

  it("preserves the nonpersonal counter through grant purge, distinguishes NULL ABA and accepts the next real grant revision", async () => rollbackProbe(async client => {
    // Direct-SQL lifecycle mechanics only. Every guard stays enabled; the
    // erased flag permits operational purge but is not real-service erasure.
    const plan = await freshPlan(client), firstGrant = randomUUID(), replacementGrant = randomUUID();
    expect(await planAuthority(client, plan)).toEqual([{ current_authorization_id: null, authorization_revision: 0 }]);
    await addGrant(client, plan, ids.home, ids.author, ids.custody, firstGrant, 1);
    await client.query(`UPDATE public.recurring_investments
      SET current_authorization_id=$2,authorization_revision=1 WHERE id=$1`, [plan, firstGrant]);
    await client.query("UPDATE public.users SET erased_at=clock_timestamp() WHERE id=$1", [ids.author]);
    await client.query("UPDATE public.recurring_investments SET current_authorization_id=NULL WHERE id=$1", [plan]);
    await client.query("DELETE FROM public.investment_plan_authorizations WHERE id=$1", [firstGrant]);
    expect(await planAuthority(client, plan)).toEqual([{ current_authorization_id: null, authorization_revision: 1 }]);
    expect((await client.query("SELECT id FROM public.investment_plan_authorizations WHERE plan_id=$1", [plan])).rows).toEqual([]);
    await addGrant(client, plan, ids.home, ids.peer, ids.custody, replacementGrant, 2);
    const stale = await client.query(`UPDATE public.recurring_investments
      SET current_authorization_id=$2,authorization_revision=2
      WHERE id=$1 AND current_authorization_id IS NULL AND authorization_revision=0 RETURNING id`, [plan, replacementGrant]);
    expect(stale.rows).toEqual([]);
    await client.query(`UPDATE public.recurring_investments SET current_authorization_id=$2,authorization_revision=2
      WHERE id=$1 AND current_authorization_id IS NULL AND authorization_revision=1`, [plan, replacementGrant]);
    expect(await planAuthority(client, plan)).toEqual([{ current_authorization_id: replacementGrant, authorization_revision: 2 }]);
    await client.query("UPDATE public.recurring_investments SET current_authorization_id=NULL WHERE id=$1", [plan]);
    expect(await planAuthority(client, plan)).toEqual([{ current_authorization_id: null, authorization_revision: 2 }]);
    await client.query("DELETE FROM public.recurring_investments WHERE id=$1", [plan]);
    expect(await planAuthority(client, plan)).toEqual([]);
    expect((await client.query("SELECT id FROM public.investment_plan_authorizations WHERE plan_id=$1", [plan])).rows).toEqual([]);
  }));

  it("refuses an exhausted revision with23514 before attempting integer addition", async () => rollbackProbe(async client => {
    // Artificial owner-only boundary setup, explicitly authorized for this
    // synthetic target. It is not a production transition or caller privilege
    // claim. No other trigger or FK is disabled; outer finally always rolls
    // back the transaction, including DDL if setup/assertion fails.
    // Migration 0029's deferred plan-dependency check would otherwise leave a
    // pending trigger event that blocks the ALTER below; for a plan with no
    // occurrence it is a no-op, so run it at statement end for this setup only.
    await client.query("SET CONSTRAINTS c306_plan_dependency IMMEDIATE");
    await client.query("UPDATE public.recurring_investments SET current_authorization_id=NULL WHERE id=$1", [ids.peerPlan]);
    await client.query("ALTER TABLE public.recurring_investments DISABLE TRIGGER guard_investment_plan_authorization_revision");
    await client.query("UPDATE public.recurring_investments SET authorization_revision=2147483647 WHERE id=$1", [ids.peerPlan]);
    await client.query("ALTER TABLE public.recurring_investments ENABLE TRIGGER guard_investment_plan_authorization_revision");
    expect((await client.query(`SELECT tgenabled FROM pg_catalog.pg_trigger
      WHERE tgrelid='public.recurring_investments'::regclass AND tgname='guard_investment_plan_authorization_revision'`)).rows)
      .toEqual([{ tgenabled: "O" }]);
    expect(await planAuthority(client, ids.peerPlan)).toEqual([{ current_authorization_id: null, authorization_revision: 2147483647 }]);
    await refuses(client, `UPDATE public.recurring_investments
      SET current_authorization_id=$2,authorization_revision=2147483647 WHERE id=$1`, [ids.peerPlan, ids.peerGrant],
    { code: "23514", message: messages.exhaustedRevision });
  }));

  it("keeps authority revision unchanged during ordinary scheduling and pointer no-op updates", async () => rollbackProbe(async client => {
    const before = await planAuthority(client, ids.plan);
    await client.query(`UPDATE public.recurring_investments SET next_execution_date='2031-02-20',is_active=false,
      current_authorization_id=current_authorization_id,authorization_revision=authorization_revision WHERE id=$1`, [ids.plan]);
    expect(await planAuthority(client, ids.plan)).toEqual(before);
    expect((await client.query("SELECT next_execution_date::text,is_active FROM public.recurring_investments WHERE id=$1", [ids.plan])).rows)
      .toEqual([{ next_execution_date: "2031-02-20", is_active: false }]);
  }));

  it.each([
    ["same-household other plan", ids.peerPlan, ids.home, ids.author],
    ["other household", ids.otherPlan, ids.otherHome, ids.author],
    ["other actor", ids.plan, ids.home, ids.peer],
  ])("binds operation authorization to its exact %s", async (_label, plan, home, actor) => rollbackProbe(async client => {
    await client.query("SAVEPOINT bad_receipt");
    try { await expect(operationReceipt(client, plan, home, actor, ids.grant)).rejects.toMatchObject(
      { code: "23503", constraint: "investment_plan_operation_authorization_fk" }); }
    finally { await client.query("ROLLBACK TO SAVEPOINT bad_receipt"); await client.query("RELEASE SAVEPOINT bad_receipt"); }
  }));

  it("rejects a grant whose plan and household disagree", async () => rollbackProbe(async client => {
    await expect(addGrant(client, ids.plan, ids.otherHome, ids.author, ids.custody, randomUUID(), 2)).rejects.toMatchObject(
      { code: "23503", constraint: "investment_authorization_plan_fk" });
  }));

  it("rejects a duplicate per-plan authorization revision", async () => rollbackProbe(async client => {
    await expect(addGrant(client, ids.plan, ids.home, ids.author, ids.custody, randomUUID())).rejects.toMatchObject(
      { code: "23505", constraint: "investment_authorization_revision" });
  }));

  it("rejects a duplicate operation identity", async () => rollbackProbe(async client => {
    await expect(operationReceipt(client, ids.plan, ids.home, ids.author, ids.grant, ids.operation)).rejects.toMatchObject(
      { code: "23505", constraint: "investment_plan_operation_identity" });
  }));

  it.each([
    ["grant no-op UPDATE", "UPDATE public.investment_plan_authorizations SET revision=revision WHERE id=$1", ids.grant, "Investment plan authorization is immutable"],
    ["grant DELETE", "DELETE FROM public.investment_plan_authorizations WHERE id=$1", ids.grant, "Investment plan authorization is immutable"],
    ["receipt no-op UPDATE", "UPDATE public.investment_plan_operations SET request_digest=request_digest WHERE operation_id=$1", ids.operation, "Investment plan operation is immutable"],
    ["receipt DELETE", "DELETE FROM public.investment_plan_operations WHERE operation_id=$1", ids.operation, "Investment plan operation is immutable"],
  ])("rejects immutable operational %s", async (_label, text, id, message) => rollbackProbe(async client => {
    await refuses(client, text, [id], { code: "23514", message });
  }));

  it("does not infer an authorization from an operational NULL-result receipt", async () => rollbackProbe(async client => {
    const operation = randomUUID();
    await operationReceipt(client, ids.plan, ids.home, ids.author, null, operation);
    expect((await client.query("SELECT authorization_id FROM public.investment_plan_operations WHERE operation_id=$1", [operation])).rows)
      .toEqual([{ authorization_id: null }]);
    await audit(client, ids.oldBuy);
    await expect(proof(client, ids.oldBuy)).rejects.toMatchObject({ code: "23514", message: messages.proof });
  }));

  it.each(["none", "no-op", "created-at", "id"] as const)("refuses a reservation for an old BUY after %s rewrite", async rewrite => rollbackProbe(async client => {
    let id = ids.oldBuy;
    if (rewrite === "no-op") await client.query("UPDATE public.investment_transactions SET amount=amount WHERE id=$1", [id]);
    if (rewrite === "created-at") await client.query("UPDATE public.investment_transactions SET created_at=clock_timestamp() WHERE id=$1", [id]);
    if (rewrite === "id") {
      id = randomUUID();
      await client.query("UPDATE public.investment_transactions SET id=$2 WHERE id=$1", [ids.oldBuy, id]);
    }
    if (rewrite !== "none") expect((await client.query(`SELECT xmin=pg_current_xact_id()::xid AS current_tuple
      FROM public.investment_transactions WHERE id=$1`, [id])).rows).toEqual([{ current_tuple: true }]);
    // Leave reservation/INSERT origin as the only missing proof precondition.
    await audit(client, id);
    await client.query("SAVEPOINT old_buy_reservation");
    try { await expect(reserve(client, id)).rejects.toMatchObject({ code: "23514", message: "SIP reservation must precede a new purchase" }); }
    finally { await client.query("ROLLBACK TO SAVEPOINT old_buy_reservation"); await client.query("RELEASE SAVEPOINT old_buy_reservation"); }
    await expect(proof(client, id)).rejects.toMatchObject({ code: "23514", message: messages.proof });
  }));

  it("rejects renaming an old BUY into a reserved new purchase ID", async () => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id);
    const before = await evidence(client, ids.oldBuy);
    await refuses(client, "UPDATE public.investment_transactions SET id=$2,created_at=clock_timestamp() WHERE id=$1", [ids.oldBuy, id],
      { code: "23514", message: messages.insertOnly });
    expect(await evidence(client, ids.oldBuy)).toEqual(before);
    expect((await evidence(client, id)).reservation).toHaveLength(1);
  }));

  it("overwrites caller seal/xid fields and rejects manually sealing before an INSERT", async () => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id);
    expect((await client.query(`SELECT posting_confirmed,creation_xid=pg_current_xact_id()::text AS owns_xid
      FROM public.investment_sip_purchase_reservations WHERE purchase_id=$1`, [id])).rows)
      .toEqual([{ posting_confirmed: false, owns_xid: true }]);
    await refuses(client, "UPDATE public.investment_sip_purchase_reservations SET posting_confirmed=true WHERE purchase_id=$1", [id],
      { code: "23514", message: messages.reservation });
    await purchase(client, id); await audit(client, id); await proof(client, id);
    expect((await client.query("SELECT posting_confirmed FROM public.investment_sip_purchase_reservations WHERE purchase_id=$1", [id])).rows)
      .toEqual([{ posting_confirmed: true }]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  }));

  it("allows abandoning a reservation when no purchase was inserted", async () => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id);
    await client.query("DELETE FROM public.investment_sip_purchase_reservations WHERE purchase_id=$1", [id]);
    await client.query("SET CONSTRAINTS require_completed_sip_reservation IMMEDIATE");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    expect(await evidence(client, id)).toEqual({ purchase: [], reservation: [], proof: [], audit: [] });
  }));

  it("seals the actual INSERT in a released savepoint and satisfies deferred completion", async () => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id);
    await client.query("SAVEPOINT real_purchase_insert");
    await purchase(client, id); await client.query("RELEASE SAVEPOINT real_purchase_insert");
    await audit(client, id); await proof(client, id); await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const stored = await evidence(client, id);
    expect(stored.purchase).toHaveLength(1); expect(stored.proof).toHaveLength(1); expect(stored.audit).toHaveLength(1);
    expect(stored.reservation[0].data).toMatchObject({ posting_confirmed: true });
  }));

  it("rolls a savepoint INSERT and its seal back, then requires a fresh real INSERT", async () => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id);
    await client.query("SAVEPOINT rolled_purchase_insert"); await purchase(client, id);
    await client.query("ROLLBACK TO SAVEPOINT rolled_purchase_insert"); await client.query("RELEASE SAVEPOINT rolled_purchase_insert");
    const rolled = await evidence(client, id);
    expect(rolled.purchase).toEqual([]); expect(rolled.reservation[0].data).toMatchObject({ posting_confirmed: false });
    await refuses(client, "UPDATE public.investment_sip_purchase_reservations SET posting_confirmed=true WHERE purchase_id=$1", [id],
      { code: "23514", message: messages.reservation });
    await purchase(client, id); await audit(client, id); await proof(client, id); await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    expect((await evidence(client, id)).proof).toHaveLength(1);
  }));

  it.each([
    ["no-op", "UPDATE public.investment_transactions SET amount=amount WHERE id=$1"],
    ["created-at", "UPDATE public.investment_transactions SET created_at=clock_timestamp() WHERE id=$1"],
    ["ID", "UPDATE public.investment_transactions SET id=gen_random_uuid() WHERE id=$1"],
  ])("rejects a reserved current purchase %s UPDATE before proof", async (_label, text) => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id); await purchase(client, id);
    await refuses(client, text, [id], { code: "23514", message: messages.insertOnly });
    await audit(client, id); await proof(client, id); await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  }));

  it("rejects deleting/replacing a reserved purchase during its creation transaction", async () => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id); await purchase(client, id);
    await refuses(client, "DELETE FROM public.investment_transactions WHERE id=$1", [id],
      { code: "23514", message: "Cannot replace a reserved SIP purchase during creation" });
    await audit(client, id); await proof(client, id); await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  }));

  it("cannot seal a purchase committed by a different transaction after the reservation read", async () => rollbackProbe(async claimant => {
    const id = randomUUID(); extraCommittedPurchases.add(id);
    await withFixtureClient(async oldWriter => {
      await oldWriter.query("BEGIN");
      try {
        await purchase(oldWriter, id);
        // The uncommitted old tuple is invisible to the reservation's plain read.
        await reserve(claimant, id);
        await oldWriter.query("COMMIT");
      } catch (error) { await oldWriter.query("ROLLBACK"); throw error; }
    });
    expect((await evidence(claimant, id)).reservation[0].data).toMatchObject({ posting_confirmed: false });
    await refuses(claimant, "UPDATE public.investment_sip_purchase_reservations SET posting_confirmed=true WHERE purchase_id=$1", [id],
      { code: "23514", message: messages.reservation });
    await refuses(claimant, "UPDATE public.investment_transactions SET amount=amount WHERE id=$1", [id],
      { code: "23514", message: messages.insertOnly });
    await refuses(claimant, "SET CONSTRAINTS ALL IMMEDIATE", [], { code: "23514", message: messages.incomplete });
  }));

  it.each(["purchase", "proof"] as const)("rejects actual COMMIT when the reserved %s is missing and rolls back all probe effects", async missing => {
    const id = randomUUID();
    await withFixtureClient(async client => {
      await client.query("BEGIN");
      try {
        await reserve(client, id);
        if (missing === "proof") { await purchase(client, id); await audit(client, id); }
        await expect(client.query("COMMIT")).rejects.toMatchObject(missing === "purchase"
          ? { code: "23503", constraint: "investment_sip_reservation_purchase_fk" }
          : { code: "23514", message: messages.incomplete });
      } finally { await client.query("ROLLBACK"); }
      expect(await evidence(client, id)).toEqual({ purchase: [], reservation: [], proof: [], audit: [] });
    });
  });

  it("rejects an early selective completion-constraint flush while its unposted reservation survives", async () => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id);
    const before = await evidence(client, id);
    expect(before.purchase).toEqual([]); expect(before.proof).toEqual([]);
    expect(before.reservation[0].data).toMatchObject({ posting_confirmed: false });
    // The separately named purchase FK remains deferred. A surviving reservation
    // must itself keep the completion check alive before the real BUY exists.
    // Diagnostic793c28b/39w is preserved in history; this oracle now requires
    // refusal at this premature flush rather than allowing it and failing later.
    await refuses(client, "SET CONSTRAINTS require_completed_sip_reservation IMMEDIATE", [],
      { code: "23514", message: messages.incomplete });
    expect(await evidence(client, id)).toEqual(before);
    // Savepoint rollback restores deferred mode and allows a complete purchase.
    await purchase(client, id); await audit(client, id); await proof(client, id);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    expect((await evidence(client, id)).proof).toHaveLength(1);
  }));

  it("rejects reservation INSERT when its completion constraint was made immediate beforehand", async () => rollbackProbe(async client => {
    const id = randomUUID();
    await client.query("SET CONSTRAINTS require_completed_sip_reservation IMMEDIATE");
    await client.query("SAVEPOINT immediate_reservation_insert");
    try { await expect(reserve(client, id)).rejects.toMatchObject({ code: "23514", message: messages.incomplete }); }
    finally {
      await client.query("ROLLBACK TO SAVEPOINT immediate_reservation_insert");
      await client.query("RELEASE SAVEPOINT immediate_reservation_insert");
    }
    expect(await evidence(client, id)).toEqual({ purchase: [], reservation: [], proof: [], audit: [] });
    await client.query("SET CONSTRAINTS require_completed_sip_reservation DEFERRED");
    await completedMechanicalPurchase(client, id); await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    expect((await evidence(client, id)).proof).toHaveLength(1);
  }));

  it("accepts a selective completion-constraint flush after the complete mechanical proof", async () => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id);
    await purchase(client, id); await audit(client, id); await proof(client, id);
    await client.query("SET CONSTRAINTS require_completed_sip_reservation IMMEDIATE");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const stored = await evidence(client, id);
    expect(stored.purchase).toHaveLength(1); expect(stored.proof).toHaveLength(1); expect(stored.audit).toHaveLength(1);
    expect(stored.reservation[0].data).toMatchObject({ posting_confirmed: true });
  }));

  it("refuses reservation TRUNCATE with native pending-trigger admission and preserves guards after rollback", async () => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id); await purchase(client, id);
    expect((await client.query(`SELECT has_table_privilege(current_user,
      'public.investment_sip_purchase_reservations','TRUNCATE') AS can_truncate`)).rows).toEqual([{ can_truncate: true }]);
    await refuses(client, "TRUNCATE public.investment_sip_purchase_reservations", [], { code: "55006" });
    expect((await evidence(client, id)).reservation[0].data).toMatchObject({ posting_confirmed: true });
    await refuses(client, "UPDATE public.investment_transactions SET id=gen_random_uuid() WHERE id=$1", [id],
      { code: "23514", message: messages.insertOnly });
    await refuses(client, "SET CONSTRAINTS ALL IMMEDIATE", [], { code: "23514", message: messages.incomplete });
    await audit(client, id); await proof(client, id); await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  }));

  it("rejects a SELL at the actual INSERT seal rather than issuing completed BUY proof", async () => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id);
    await refuses(client, `INSERT INTO public.investment_transactions
      (id,household_id,account_id,security_id,type,quantity,amount,currency,transaction_date)
      VALUES ($1,$2,$3,$4,'sell','5','10.00','ZMW',$5)`, [id, ids.home, ids.custody, ids.instrument, initialDate],
    { code: "23514", message: messages.reservation });
    expect((await evidence(client, id)).purchase).toEqual([]);
  }));

  it.each([
    ["author", { author_user_id: `'${ids.peer}'::uuid` }],
    ["grant instant", { authorized_at: "g.authorized_at+interval '1 second'" }],
    ["frequency", { authorized_frequency: "'weekly'::public.recurring_frequency" }],
    ["initial date", { authorized_initial_date: "g.initial_execution_date+1" }],
    ["digest", { authorized_terms_digest: "repeat('b',64)" }],
  ] as const)("rejects a completed proof with the wrong %s", async (_label, overrides) => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id); await purchase(client, id); await audit(client, id);
    await client.query("SAVEPOINT mismatched_proof");
    try { await expect(proof(client, id, ids.grant, overrides)).rejects.toMatchObject({ code: "23514", message: messages.proof }); }
    finally { await client.query("ROLLBACK TO SAVEPOINT mismatched_proof"); await client.query("RELEASE SAVEPOINT mismatched_proof"); }
    await proof(client, id); await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  }));

  it.each(["missing", "duplicate", "human actor", "wrong audience", "missing linkage"] as const)("requires the exact system effect audit: %s control", async fault => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id); await purchase(client, id);
    if (fault !== "missing") await audit(client, id);
    if (fault === "duplicate") await audit(client, id);
    if (fault === "human actor") await client.query("UPDATE public.audit_logs SET user_id=$2 WHERE entity_id=$1", [id, ids.author]);
    if (fault === "wrong audience") await client.query("UPDATE public.audit_logs SET household_id=NULL WHERE entity_id=$1", [id]);
    if (fault === "missing linkage") await client.query("UPDATE public.audit_logs SET details=details-'authorizationProofPurchaseId' WHERE entity_id=$1", [id]);
    await expect(proof(client, id)).rejects.toMatchObject({ code: "23514", message: messages.proof });
  }));

  it.each([
    ["no-op UPDATE", "UPDATE public.investment_purchase_authorization_proofs SET authorized_terms_digest=authorized_terms_digest WHERE purchase_id=$1"],
    ["digest UPDATE", "UPDATE public.investment_purchase_authorization_proofs SET authorized_terms_digest=repeat('b',64) WHERE purchase_id=$1"],
    ["DELETE", "DELETE FROM public.investment_purchase_authorization_proofs WHERE purchase_id=$1"],
  ])("rejects completed proof %s while its purchase survives", async (_label, text) => rollbackProbe(async client => {
    const before = await evidence(client, ids.provenBuy);
    await refuses(client, text, [ids.provenBuy], { code: "23514", message: messages.proof });
    expect(await evidence(client, ids.provenBuy)).toEqual(before);
  }));

  it.each(["", " CASCADE"])("rejects actual proof TRUNCATE%s via its23514 guard", async suffix => rollbackProbe(async client => {
    const before = await evidence(client, ids.provenBuy);
    // A missing TRUNCATE privilege (42501) cannot satisfy this guard assertion.
    await refuses(client, `TRUNCATE public.investment_purchase_authorization_proofs${suffix}`, [],
      { code: "23514", message: "Completed investment authorization proof cannot be truncated" });
    expect(await evidence(client, ids.provenBuy)).toEqual(before);
  }));

  it.each([
    ["type", "type='sell'"], ["amount", "amount='11.00'"], ["quantity", "quantity='6'"],
    ["created-at", "created_at=clock_timestamp()"], ["ID", "id=gen_random_uuid()"],
  ])("rejects a proven purchase %s rewrite after its creation transaction", async (_label, assignment) => rollbackProbe(async client => {
    const before = await evidence(client, ids.provenBuy);
    await refuses(client, `UPDATE public.investment_transactions SET ${assignment} WHERE id=$1`, [ids.provenBuy],
      { code: "23514", message: messages.purchase });
    expect(await evidence(client, ids.provenBuy)).toEqual(before);
  }));

  it.each(["direct", "plan cascade", "erased-actor cascade"] as const)("rejects preproof reservation purge through %s and preserves INSERT-only binding after savepoint rollback", async route => rollbackProbe(async client => {
    const id = randomUUID(); await reserve(client, id); await purchase(client, id);
    const before = await evidence(client, id);
    await client.query("SAVEPOINT attempted_preproof_purge");
    try {
      if (route === "direct") await expect(client.query("DELETE FROM public.investment_sip_purchase_reservations WHERE purchase_id=$1", [id]))
        .rejects.toMatchObject({ code: "23514", message: messages.purge });
      if (route === "plan cascade") await expect(client.query("DELETE FROM public.recurring_investments WHERE id=$1", [ids.plan]))
        .rejects.toMatchObject({ code: "23514", message: messages.purge });
      if (route === "erased-actor cascade") {
        // A flag is only a guard precondition; this is NOT an erasure positive.
        await client.query("UPDATE public.users SET erased_at=clock_timestamp() WHERE id=$1", [ids.author]);
        await client.query("UPDATE public.recurring_investments SET current_authorization_id=NULL WHERE id=$1", [ids.plan]);
        await expect(client.query("DELETE FROM public.investment_plan_authorizations WHERE id=$1", [ids.grant]))
          .rejects.toMatchObject({ code: "23514", message: messages.purge });
      }
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT attempted_preproof_purge"); await client.query("RELEASE SAVEPOINT attempted_preproof_purge");
    }
    expect(await evidence(client, id)).toEqual(before);
    await refuses(client, "UPDATE public.investment_transactions SET amount=amount WHERE id=$1", [id], { code: "23514", message: messages.insertOnly });
    await refuses(client, "UPDATE public.investment_transactions SET id=gen_random_uuid() WHERE id=$1", [id], { code: "23514", message: messages.insertOnly });
    await refuses(client, "DELETE FROM public.investment_transactions WHERE id=$1", [id],
      { code: "23514", message: "Cannot replace a reserved SIP purchase during creation" });
    await refuses(client, "SET CONSTRAINTS ALL IMMEDIATE", [], { code: "23514", message: messages.incomplete });
    await audit(client, id); await proof(client, id); await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  }));

  it("allows postproof operational purge while retaining exactly the seven mechanical proof fields", async () => rollbackProbe(async client => {
    const before = await evidence(client, ids.provenBuy);
    await client.query("UPDATE public.users SET erased_at=clock_timestamp() WHERE id=$1", [ids.author]);
    await client.query("UPDATE public.recurring_investments SET current_authorization_id=NULL,is_active=false WHERE id=$1", [ids.plan]);
    await client.query("DELETE FROM public.investment_plan_authorizations WHERE id=$1", [ids.grant]);
    const after = await evidence(client, ids.provenBuy);
    expect(after.purchase).toEqual(before.purchase); expect(after.proof).toEqual(before.proof); expect(after.audit).toEqual(before.audit);
    expect(after.reservation).toEqual([]);
    expect((await client.query("SELECT id FROM public.investment_plan_authorizations WHERE author_user_id=$1", [ids.author])).rows).toEqual([]);
    expect((await client.query("SELECT operation_id FROM public.investment_plan_operations WHERE actor_user_id=$1", [ids.author])).rows).toEqual([]);
    expect((await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='investment_purchase_authorization_proofs' ORDER BY ordinal_position`)).rows.map(row => row.column_name))
      .toEqual(["purchase_id", "author_user_id", "authorized_at", "authorization_contract_version", "authorized_frequency", "authorized_initial_date", "authorized_terms_digest"]);
    await refuses(client, "DELETE FROM public.investment_purchase_authorization_proofs WHERE purchase_id=$1", [ids.provenBuy],
      { code: "23514", message: messages.proof });
    await refuses(client, "UPDATE public.investment_transactions SET id=gen_random_uuid() WHERE id=$1", [ids.provenBuy],
      { code: "23514", message: messages.purchase });
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  }));

  it("allows actual parent-purchase removal to cascade its committed proof and reservation", async () => rollbackProbe(async client => {
    await client.query("DELETE FROM public.investment_transactions WHERE id=$1", [ids.provenBuy]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const after = await evidence(client, ids.provenBuy);
    expect(after.purchase).toEqual([]); expect(after.reservation).toEqual([]); expect(after.proof).toEqual([]);
    expect(after.audit).toHaveLength(1);
  }));

  it("preserves ordinary unreserved INSERT/UPDATE/no-op/DELETE mechanics without creating authorization evidence", async () => rollbackProbe(async client => {
    const id = randomUUID(); await purchase(client, id);
    await client.query("UPDATE public.investment_transactions SET quantity='6',amount='12.00' WHERE id=$1", [id]);
    await client.query("UPDATE public.investment_transactions SET amount=amount WHERE id=$1", [id]);
    const manual = await evidence(client, id);
    expect(manual.purchase[0].data).toMatchObject({ quantity: 6, amount: 12 });
    expect(manual.reservation).toEqual([]); expect(manual.proof).toEqual([]);
    await client.query("DELETE FROM public.investment_transactions WHERE id=$1", [id]);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    expect((await evidence(client, id)).purchase).toEqual([]);
  }));
});
