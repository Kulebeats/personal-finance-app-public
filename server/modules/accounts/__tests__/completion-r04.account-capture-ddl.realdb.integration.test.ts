import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseConnection, resolveTestDatabaseUrl, verifyDatabaseTarget } from "../../../testing/test-target.mjs";

type Draft = { householdId: string; date: string; captureId: string; capturedAt: Date; currency: string | null; evidence: Record<string, unknown> };
type Outcome = { ok: true } | { ok: false; code: string | undefined };
const connections: Client[] = [], pending = new Set<Promise<Outcome>>();
let a: Client, b: Client, monitor: Client, aPid: number, bPid: number;
let household: string, otherHousehold: string, account: string, secondAccount: string, otherAccount: string;
let ownedHouseholds: string[] = [], securityIds: string[] = [], proposedIds = new Set<string>();

function run(query: Promise<unknown>) {
  const result = query.then<Outcome, Outcome>(() => ({ ok: true }), (error: unknown) => ({ ok: false,
    code: error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined }));
  pending.add(result); void result.then(() => pending.delete(result));
  return result;
}
async function blocked(waiter: number, holder: number) {
  await expect.poll(async () => (await monitor.query<{ blocked: boolean }>(
    "SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked", [waiter, holder],
  )).rows[0].blocked, { timeout: 5_000, interval: 10 }).toBe(true);
}
async function draft(client: Client, target = household, captureId: string = randomUUID()): Promise<Draft> {
  proposedIds.add(captureId);
  const { rows: [row] } = await client.query<{ date: string; instant: Date; currency: string | null; accounts: Record<string, unknown>[] }>(`
    SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
      date_trunc('milliseconds', transaction_timestamp()) AS instant,
      CASE WHEN currency ~ '^[A-Z]{3}$' THEN currency END AS currency,
      public.r04_account_capture_records(id) AS accounts FROM households WHERE id=$1`, [target]);
  return { householdId: target, date: row.date, captureId, capturedAt: row.instant, currency: row.currency,
    evidence: { version: 1, captureId, householdId: target, date: row.date, currency: row.currency,
      capturedAt: row.instant.toISOString(), inventoryComplete: true, capturedAccountCount: row.accounts.length, accounts: row.accounts } };
}
function insert(client: Client, value: Draft) {
  return client.query(`INSERT INTO account_worth_captures(household_id,date,capture_id,captured_at,currency,evidence)
    VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(household_id,date) DO UPDATE SET
      capture_id=EXCLUDED.capture_id,captured_at=EXCLUDED.captured_at,currency=EXCLUDED.currency,evidence=EXCLUDED.evidence,updated_at=now()`,
  [value.householdId, value.date, value.captureId, value.capturedAt, value.currency, JSON.stringify(value.evidence)]);
}
async function capture(client = a, target = household) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try { const value = await draft(client, target); await insert(client, value); await client.query("COMMIT"); return value; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
}
async function current(target = household) {
  return (await monitor.query("SELECT capture_id::text, evidence FROM account_worth_captures WHERE household_id=$1", [target])).rows;
}
async function snapshot() {
  return (await monitor.query(`SELECT jsonb_build_object(
    'captures', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.household_id,c.date),'[]') FROM account_worth_captures c WHERE household_id=ANY($1::uuid[])),
    'days', (SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.household_id,d.date),'[]') FROM account_worth_capture_days d WHERE household_id=ANY($1::uuid[])),
    'spent', (SELECT coalesce(jsonb_agg(capture_id ORDER BY capture_id),'[]') FROM account_worth_capture_generations WHERE capture_id=ANY($2::uuid[])),
    'legacy', (SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.household_id,n.date),'[]') FROM net_worth_snapshots n WHERE household_id=ANY($1::uuid[]))
    ) AS state`, [ownedHouseholds, Array.from(proposedIds)])).rows[0].state;
}
async function rejected(operation: () => Promise<unknown>) {
  const before = await snapshot();
  await a.query("BEGIN");
  try { await expect(operation()).rejects.toMatchObject({ code: "23514" }); }
  finally { await a.query("ROLLBACK"); }
  expect(await snapshot()).toEqual(before);
}
function legacy(client: Client, operation: "INSERT" | "UPDATE", amount = "900.00") {
  return operation === "INSERT"
    ? client.query(`INSERT INTO net_worth_snapshots(household_id,date,total_assets,total_liabilities,net_worth,currency)
        VALUES($1,(transaction_timestamp() AT TIME ZONE 'UTC')::date,$2,0,$2,'ZMW')`, [household, amount])
    : client.query("UPDATE net_worth_snapshots SET total_assets=$2,net_worth=$2 WHERE household_id=$1", [household, amount]);
}
async function withdraw(client = monitor) { await client.query("UPDATE account_worth_captures SET evidence=NULL WHERE household_id=$1", [household]); }
function changeClock(value: Draft, date: string, instant: Date) {
  value.date = date; value.capturedAt = instant; value.evidence.date = date; value.evidence.capturedAt = instant.toISOString();
}
function priorDay(date: string) { const day = new Date(`${date}T12:00:00Z`); day.setUTCDate(day.getUTCDate() - 1); return day.toISOString().slice(0, 10); }

describe("R04 0019 independently verified account capture DDL", () => {
  beforeAll(async () => {
    await verifyDatabaseTarget();
    const config = parseConnection(resolveTestDatabaseUrl(process.env));
    for (let i = 0; i < 3; i++) { const client = new Client(config); connections.push(client); await client.connect(); await client.query("SET statement_timeout='10s'"); }
    [a, b, monitor] = connections;
    aPid = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    bPid = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  });
  beforeEach(async () => {
    household = randomUUID(); otherHousehold = randomUUID(); ownedHouseholds = [household, otherHousehold];
    account = randomUUID(); secondAccount = randomUUID(); otherAccount = randomUUID(); securityIds = []; proposedIds = new Set();
    await monitor.query("INSERT INTO households(id,name,currency) VALUES($1,'Synthetic capture DDL A','ZMW'),($2,'Synthetic capture DDL B','ZMW')", ownedHouseholds);
    await monitor.query(`INSERT INTO accounts(id,household_id,name,type,balance,currency) VALUES
      ($1,$2,'Native first','checking',100,'ZMW'),($3,$2,'Native second','cash',25,'ZMW'),($4,$5,'Foreign native','checking',200,'ZMW')`,
    [account, household, secondAccount, otherAccount, otherHousehold]);
  });
  afterEach(async () => {
    if (!monitor) return;
    // Vitest runs this finally path after failed assertions as well. Cancel only
    // this fixture's two clients, settle their queries, then release both locks.
    if (pending.size) await monitor.query("SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid=ANY($1::int[])", [[aPid, bPid]]);
    await Promise.all(Array.from(pending));
    await Promise.all([a.query("ROLLBACK"), b.query("ROLLBACK")]);
    await monitor.query("DELETE FROM grz_bonds WHERE household_id=ANY($1::uuid[])", [ownedHouseholds]);
    await monitor.query("DELETE FROM grz_tbills WHERE household_id=ANY($1::uuid[])", [ownedHouseholds]);
    await monitor.query("DELETE FROM households WHERE id=ANY($1::uuid[])", [ownedHouseholds]);
    await monitor.query("DELETE FROM securities WHERE id=ANY($1::uuid[])", [securityIds]);
    expect((await monitor.query("SELECT count(*)::int AS count FROM account_worth_captures WHERE household_id=ANY($1::uuid[])", [ownedHouseholds])).rows[0].count).toBe(0);
    expect((await monitor.query("SELECT count(*)::int AS count FROM account_worth_capture_days WHERE household_id=ANY($1::uuid[])", [ownedHouseholds])).rows[0].count).toBe(0);
    // The deliberately irreversible registry retains only opaque spent UUIDs.
  });
  afterAll(async () => { await Promise.all(connections.map(client => client.end())); });

  it("accepts complete native facts, preserves row identity and spends each fresh recapture exactly once", async () => {
    const first = await capture(), before = await monitor.query("SELECT id FROM account_worth_captures WHERE household_id=$1", [household]);
    expect((await current())[0].evidence).toEqual(first.evidence);
    expect((first.evidence.accounts as Record<string, unknown>[]).map(value => value.accountId)).toEqual([account, secondAccount].sort());
    expect(first.evidence.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: account, sourceAmount: "100.00", sourceCurrency: "ZMW", investments: { holdings: 0, tbills: 0, pensions: 0, bonds: 0 } }),
      expect.objectContaining({ accountId: secondAccount, sourceAmount: "25.00" }),
    ]));
    await monitor.query("UPDATE accounts SET balance=101 WHERE id=$1", [account]);
    const next = await capture(); expect(next.captureId).not.toBe(first.captureId);
    expect((await current())[0].evidence).toEqual(next.evidence);
    expect((await monitor.query("SELECT id FROM account_worth_captures WHERE household_id=$1", [household])).rows).toEqual(before.rows);
    expect((await monitor.query("SELECT count(*)::int AS count FROM account_worth_capture_generations WHERE capture_id=ANY($1::uuid[])", [[first.captureId, next.captureId]])).rows[0].count).toBe(2);
  });
  it("exhaustively records account flags and counts each economic interest by BOTH household and parent ID", async () => {
    const security = randomUUID(); securityIds.push(security);
    await monitor.query("INSERT INTO securities(id,symbol,name,type,currency) VALUES($1,$2,'Synthetic DDL security','stock','ZMW')", [security, `DDL${security.slice(0, 17)}`]);
    await monitor.query(`INSERT INTO holdings(household_id,account_id,security_id,quantity) VALUES
      ($1,$2,$5,1),($1,$3,$5,0),($4,$2,$5,1),($1,$6,$5,1)`, [household, account, secondAccount, otherHousehold, security, otherAccount]);
    await monitor.query(`INSERT INTO pension_holdings(household_id,account_id,provider_name,pension_type,current_balance) VALUES
      ($1,$2,'DDL','private',1),($1,$2,'DDL','private',0),($3,$2,'DDL','private',1),
      ($1,$4,'DDL','private',1),($1,NULL,'DDL','private',1),($1,$5,'DDL','private',NULL)`,
    [household, account, otherHousehold, otherAccount, secondAccount]);
    await monitor.query(`INSERT INTO grz_tbills(household_id,account_id,tbill_name,tenor_days,face_value,purchase_price,purchase_date,maturity_date,status) VALUES
      ($1,$2,'DDL',91,1,1,current_date,current_date+91,'active'),($1,$2,'DDL',91,0,0,current_date,current_date+91,'active'),
      ($1,$2,'DDL',91,1,1,current_date,current_date+91,'matured'),($3,$2,'DDL',91,1,1,current_date,current_date+91,'active'),
      ($1,$4,'DDL',91,1,1,current_date,current_date+91,'active'),($1,NULL,'DDL',91,1,1,current_date,current_date+91,'active'),
      ($1,$5,'DDL',91,1,1,current_date,current_date+91,NULL)`, [household, account, otherHousehold, otherAccount, secondAccount]);
    await monitor.query(`INSERT INTO grz_bonds(household_id,account_id,bond_name,tenor_years,face_value,purchase_price,purchase_date,maturity_date,coupon_rate,status) VALUES
      ($1,$2,'DDL',2,1,1,current_date,current_date+730,0.1,'active'),($1,$2,'DDL',2,0,0,current_date,current_date+730,0.1,'active'),
      ($1,$2,'DDL',2,1,1,current_date,current_date+730,0.1,'sold'),($3,$2,'DDL',2,1,1,current_date,current_date+730,0.1,'active'),
      ($1,$4,'DDL',2,1,1,current_date,current_date+730,0.1,'active'),($1,NULL,'DDL',2,1,1,current_date,current_date+730,0.1,'active')`,
    [household, account, otherHousehold, otherAccount]);
    await monitor.query(`UPDATE accounts SET type='real_estate',balance=1,estimated_value=250,is_hidden=true,
      is_archived=true,exclude_from_net_worth=true,deleted_at=now() WHERE id=$1`, [secondAccount]);
    const value = await capture();
    expect(value.evidence.capturedAccountCount).toBe(2);
    expect(value.evidence.accounts).toEqual(expect.arrayContaining([
      { accountId: account, accountType: "checking", sourceAmount: "100.00", sourceCurrency: "ZMW", excluded: false,
        hidden: false, archived: false, deleted: false, investments: { holdings: 1, tbills: 1, pensions: 1, bonds: 1 } },
      { accountId: secondAccount, accountType: "real_estate", sourceAmount: "250.00", sourceCurrency: "ZMW", excluded: true,
        hidden: true, archived: true, deleted: true, investments: { holdings: 0, tbills: 1, pensions: 1, bonds: 0 } },
    ]));
    expect((await current())[0].evidence).toEqual(value.evidence);
  });

  const malformed: [string, (value: Draft) => void][] = [
    ["missing contributor", value => { (value.evidence.accounts as unknown[]).pop(); value.evidence.capturedAccountCount = 1; }],
    ["duplicate contributor", value => { const rows = value.evidence.accounts as unknown[]; rows[1] = rows[0]; }],
    ["foreign contributor", value => { (value.evidence.accounts as Record<string, unknown>[])[0].accountId = otherAccount; }],
    ["stale native amount", value => { (value.evidence.accounts as Record<string, unknown>[])[0].sourceAmount = "7.25"; }],
    ["invented investment interest", value => { (value.evidence.accounts as Record<string, unknown>[])[0].investments = { holdings: 1, tbills: 0, pensions: 0, bonds: 0 }; }],
    ["incomplete inventory", value => { value.evidence.inventoryComplete = false; }],
    ["wrong count", value => { value.evidence.capturedAccountCount = 0; }],
    ["wrong version", value => { value.evidence.version = "1"; }],
    ["extra unverified field", value => { value.evidence.assumedComplete = true; }],
    ["foreign envelope household", value => { value.evidence.householdId = otherHousehold; }],
    ["unsupported base label", value => { value.currency = "USD"; value.evidence.currency = "USD"; }],
    ["mismatched capture day", value => changeClock(value, priorDay(value.date), value.capturedAt)],
    ["matching but backdated day and instant", value => changeClock(value, priorDay(value.date), new Date(value.capturedAt.getTime() - 86_400_000))],
    ["same-day caller-chosen instant", value => changeClock(value, value.date, new Date(value.capturedAt.getTime() + 1))],
    ["ambient-timezone timestamp", value => { value.evidence.capturedAt = value.capturedAt.toISOString().replace(/Z$/, ""); }],
  ];
  it.each(malformed)("rejects %s without persisting a receipt, barrier or spent identity", async (_name, mutate) => {
    await rejected(async () => { const value = await draft(a); mutate(value); await insert(a, value); });
  });
  it("rejects false absence of a real linked nonzero holding without changing the existing proof or source data", async () => {
    const security = randomUUID(), holding = randomUUID(); securityIds.push(security);
    await monitor.query("INSERT INTO securities(id,symbol,name,type,currency) VALUES($1,$2,'Synthetic omitted holding','stock','ZMW')", [security, `DDL${security.slice(0, 17)}`]);
    await monitor.query("INSERT INTO holdings(id,household_id,account_id,security_id,quantity,cost_basis) VALUES($1,$2,$3,$4,2,10)", [holding, household, account, security]);
    await capture();
    const sourceSql = `SELECT jsonb_build_object('holding',(SELECT to_jsonb(h) FROM holdings h WHERE id=$1),
      'account',(SELECT to_jsonb(a) FROM accounts a WHERE id=$2)) AS state`;
    const before = (await monitor.query(sourceSql, [holding, account])).rows;
    await rejected(async () => {
      const value = await draft(a);
      const contributor = (value.evidence.accounts as Record<string, unknown>[]).find(row => row.accountId === account)!;
      const inventory = contributor.investments as { holdings: number };
      expect(inventory.holdings).toBe(1); inventory.holdings = 0;
      await insert(a, value);
    });
    expect((await monitor.query(sourceSql, [holding, account])).rows).toEqual(before);
  });
  it("rejects genuinely changed source facts between observation and write and aborts the whole transaction", async () => {
    await rejected(async () => {
      const value = await draft(a);
      await a.query("UPDATE accounts SET balance=101 WHERE id=$1", [account]);
      await insert(a, value);
    });
    expect((await monitor.query("SELECT balance::text FROM accounts WHERE id=$1", [account])).rows[0].balance).toBe("100.00");
  });
  it("retains unknown household/native denominations as null without substituting ZMW", async () => {
    await monitor.query("UPDATE households SET currency=NULL WHERE id=$1", [household]);
    await monitor.query("UPDATE accounts SET currency='12!' WHERE id=$1", [account]);
    const value = await capture(); expect(value.currency).toBeNull();
    expect(value.evidence.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: account, sourceCurrency: null })]));
    expect((await current())[0].evidence).toEqual(value.evidence);
  });
  it("refuses NULL inserts and NULL withdrawal header changes, while permitting honest withdrawal", async () => {
    await rejected(async () => { const value = await draft(a); await a.query("INSERT INTO account_worth_captures(household_id,date,capture_id,captured_at,evidence) VALUES($1,$2,$3,$4,NULL)", [household, value.date, value.captureId, value.capturedAt]); });
    await capture();
    for (const assignment of ["capture_id=gen_random_uuid()", "captured_at=captured_at+interval '1 second'", "currency='USD'", "date=date-1", "id=gen_random_uuid()", "created_at=created_at+interval '1 second'"])
      await rejected(() => a.query(`UPDATE account_worth_captures SET evidence=NULL,${assignment} WHERE household_id=$1`, [household]));
    await rejected(() => a.query("UPDATE account_worth_captures SET evidence=NULL,household_id=$2 WHERE household_id=$1", [household, otherHousehold]));
    const header = (await current())[0].capture_id;
    await withdraw(); expect(await current()).toEqual([{ capture_id: header, evidence: null }]);
    await capture(); expect((await current())[0].evidence).not.toBeNull();
  });
  it("rejects spent-ID replay after receipt deletion and after legitimate household erasure", async () => {
    const first = await capture();
    await monitor.query("DELETE FROM account_worth_captures WHERE household_id=$1", [household]);
    await rejected(async () => insert(a, await draft(a, household, first.captureId)));
    const second = await capture();
    await monitor.query("DELETE FROM households WHERE id=$1", [household]);
    expect(await current()).toEqual([]);
    await rejected(async () => insert(a, await draft(a, otherHousehold, second.captureId)));
    const columns = await monitor.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='account_worth_capture_generations' ORDER BY ordinal_position");
    expect(columns.rows).toEqual([{ column_name: "capture_id" }]);
    expect((await monitor.query("SELECT count(*)::int AS count FROM account_worth_capture_generations WHERE capture_id=ANY($1::uuid[])", [[first.captureId, second.captureId]])).rows[0].count).toBe(2);
  });
  it.each(["UPDATE", "DELETE", "TRUNCATE"])("prevents %s erasing the opaque spent-ID history", async operation => {
    const value = await capture();
    await rejected(() => operation === "UPDATE" ? a.query("UPDATE account_worth_capture_generations SET capture_id=$2 WHERE capture_id=$1", [value.captureId, randomUUID()])
      : operation === "DELETE" ? a.query("DELETE FROM account_worth_capture_generations WHERE capture_id=$1", [value.captureId])
        : a.query("TRUNCATE account_worth_capture_generations"));
  });

  it.each(["INSERT", "no-op UPDATE", "changed UPDATE", "DELETE", "moved date", "moved household"])("withdraws proof after legacy aggregate %s", async operation => {
    if (operation !== "INSERT") await legacy(monitor, "INSERT");
    await capture(); const original = (await current())[0].capture_id;
    if (operation === "INSERT") await legacy(monitor, "INSERT");
    else if (operation === "DELETE") await monitor.query("DELETE FROM net_worth_snapshots WHERE household_id=$1", [household]);
    else if (operation === "moved date") await monitor.query("UPDATE net_worth_snapshots SET date=date-1 WHERE household_id=$1", [household]);
    else if (operation === "moved household") {
      await capture(a, otherHousehold);
      await monitor.query("UPDATE net_worth_snapshots SET household_id=$2 WHERE household_id=$1", [household, otherHousehold]);
      expect((await current(otherHousehold))[0].evidence).toBeNull();
    } else await legacy(monitor, "UPDATE", operation === "no-op UPDATE" ? "900.00" : "777.00");
    expect(await current()).toEqual([{ capture_id: original, evidence: null }]);
    if (operation !== "moved household") { await capture(); expect((await current())[0].evidence).not.toBeNull(); }
  });
  it("named existing-import exception: independent balance INSERT/UPDATE/DELETE preserves captured facts", async () => {
    const value = await capture(), before = await snapshot();
    await monitor.query("INSERT INTO account_balance_snapshots(account_id,date,balance) VALUES($1,$2,999)", [account, value.date]);
    expect(await snapshot()).toEqual(before);
    await monitor.query("UPDATE account_balance_snapshots SET balance=888 WHERE account_id=$1", [account]);
    expect(await snapshot()).toEqual(before);
    await monitor.query("DELETE FROM account_balance_snapshots WHERE account_id=$1", [account]);
    expect(await snapshot()).toEqual(before);
  });
  it("leaves historical legacy rows byte-equivalent when current-day proof is authored and withdrawn", async () => {
    await monitor.query(`INSERT INTO net_worth_snapshots(household_id,date,total_assets,total_liabilities,net_worth,currency,account_balances)
      VALUES($1,(transaction_timestamp() AT TIME ZONE 'UTC')::date-2,123,0,123,'ZMW','[{"accountId":"legacy","balance":"123.00"}]')`, [household]);
    const before = await monitor.query("SELECT to_jsonb(n) AS row FROM net_worth_snapshots n WHERE household_id=$1", [household]);
    const value = await capture(); await withdraw();
    expect((await monitor.query("SELECT to_jsonb(n) AS row FROM net_worth_snapshots n WHERE household_id=$1", [household])).rows).toEqual(before.rows);
    expect((await monitor.query("SELECT date::text FROM account_worth_captures WHERE household_id=$1", [household])).rows).toEqual([{ date: value.date }]);
  });

  it.each(["retained", "deleted before commit"] as const)("simultaneous same UUID across households has one winner with its receipt %s and no losing transaction effects", async receiptState => {
    const sharedId = randomUUID();
    const loserBefore = (await monitor.query("SELECT to_jsonb(a) AS row FROM accounts a WHERE id=$1", [otherAccount])).rows;
    await a.query("BEGIN");
    await a.query("UPDATE accounts SET notes='UUID winner' WHERE id=$1", [account]);
    const winner = await draft(a, household, sharedId); await insert(a, winner);
    if (receiptState === "deleted before commit") await a.query("DELETE FROM account_worth_captures WHERE household_id=$1", [household]);
    await b.query("BEGIN");
    await b.query("UPDATE accounts SET notes='UUID losing uncommitted marker' WHERE id=$1", [otherAccount]);
    const loser = await draft(b, otherHousehold, sharedId);
    let constraint: string | undefined;
    const writing = run(insert(b, loser).catch((error: unknown) => {
      if (error && typeof error === "object" && "constraint" in error && typeof error.constraint === "string") constraint = error.constraint;
      throw error;
    }));
    await blocked(bPid, aPid); await a.query("COMMIT");
    expect(await writing).toEqual({ ok: false, code: "23505" });
    expect(constraint).toBe(receiptState === "retained" ? "uniq_account_worth_captures_generation" : "account_worth_capture_generations_pkey");
    await b.query("ROLLBACK");
    expect(await current()).toEqual(receiptState === "retained" ? [{ capture_id: sharedId, evidence: winner.evidence }] : []);
    expect(await current(otherHousehold)).toEqual([]);
    expect((await monitor.query("SELECT capture_id::text FROM account_worth_capture_generations WHERE capture_id=$1", [sharedId])).rows).toEqual([{ capture_id: sharedId }]);
    expect((await monitor.query("SELECT notes FROM accounts WHERE id=$1", [account])).rows[0].notes).toBe("UUID winner");
    expect((await monitor.query("SELECT to_jsonb(a) AS row FROM accounts a WHERE id=$1", [otherAccount])).rows).toEqual(loserBefore);
    expect((await monitor.query("SELECT household_id FROM account_worth_capture_days WHERE household_id=$1", [otherHousehold])).rows).toEqual([]);
  }, 25_000);

  for (const initial of ["absent", "withdrawn"] as const) for (const isolation of ["READ COMMITTED", "SERIALIZABLE"] as const) {
    it.each(["INSERT", "UPDATE"] as const)(`${initial} receipt: concurrent legacy %s at ${isolation} cannot leave a published proof`, async operation => {
      if (operation === "UPDATE") await legacy(monitor, "INSERT");
      if (initial === "withdrawn") { await capture(); await withdraw(); }
      const legacyBefore = await monitor.query("SELECT to_jsonb(n) AS row FROM net_worth_snapshots n WHERE household_id=$1", [household]);
      await a.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); const value = await draft(a); await insert(a, value);
      await b.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      await b.query("SELECT count(*) FROM account_worth_capture_days WHERE household_id=$1", [household]);
      const writing = run(legacy(b, operation, "777.00"));
      await blocked(bPid, aPid); await a.query("COMMIT");
      const outcome = await writing;
      if (isolation === "READ COMMITTED") { expect(outcome).toEqual({ ok: true }); await b.query("COMMIT"); }
      else {
        expect(outcome).toEqual({ ok: false, code: "40001" }); await b.query("ROLLBACK");
        expect((await current())[0].evidence).toEqual(value.evidence);
        expect((await monitor.query("SELECT to_jsonb(n) AS row FROM net_worth_snapshots n WHERE household_id=$1", [household])).rows).toEqual(legacyBefore.rows);
        await b.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); await legacy(b, operation, "777.00"); await b.query("COMMIT");
      }
      expect(await current()).toEqual([{ capture_id: value.captureId, evidence: null }]);
      expect((await monitor.query("SELECT net_worth::text FROM net_worth_snapshots WHERE household_id=$1", [household])).rows).toEqual([{ net_worth: "777.00" }]);
    }, 25_000);
  }
  it("legacy-first barrier makes stale capture retry its whole transaction before a fresh proof can win", async () => {
    await b.query("BEGIN"); await legacy(b, "INSERT");
    await a.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await a.query("UPDATE accounts SET notes='first attempt' WHERE id=$1", [account]);
    const stale = await draft(a), writing = run(insert(a, stale));
    await blocked(aPid, bPid); await b.query("COMMIT");
    expect(await writing).toEqual({ ok: false, code: "40001" }); await a.query("ROLLBACK");
    expect(await current()).toEqual([]);
    expect((await monitor.query("SELECT notes FROM accounts WHERE id=$1", [account])).rows[0].notes).toBeNull();
    await a.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await a.query("UPDATE accounts SET notes='whole transaction retried' WHERE id=$1", [account]);
    const fresh = await draft(a); await insert(a, fresh); await a.query("COMMIT");
    expect(fresh.captureId).not.toBe(stale.captureId);
    expect((await current())[0].evidence).toEqual(fresh.evidence);
    expect((await monitor.query("SELECT notes FROM accounts WHERE id=$1", [account])).rows[0].notes).toBe("whole transaction retried");
    expect((await monitor.query("SELECT capture_id FROM account_worth_capture_generations WHERE capture_id=$1", [stale.captureId])).rows).toEqual([]);
  }, 25_000);
  it("reverse tuple/day lock order reports 40P01, rolls back all victim effects and permits whole transaction retry", async () => {
    await legacy(monitor, "INSERT"); await capture();
    await a.query("BEGIN"); await a.query("UPDATE accounts SET notes='A attempt 1' WHERE id=$1", [account]);
    await a.query("SELECT id FROM account_worth_captures WHERE household_id=$1 FOR UPDATE", [household]);
    await b.query("BEGIN"); await b.query("UPDATE accounts SET notes='B attempt 1' WHERE id=$1", [secondAccount]);
    const legacyWrite = run(legacy(b, "UPDATE", "777.00"));
    await blocked(bPid, aPid);
    const receiptWrite = run(withdraw(a));
    const results = await Promise.all([receiptWrite, legacyWrite]);
    expect(results.filter(result => !result.ok)).toEqual([{ ok: false, code: "40P01" }]);
    const victim = results[0].ok ? b : a, survivor = victim === a ? b : a;
    const victimAccount = victim === a ? account : secondAccount, survivorAccount = victim === a ? secondAccount : account;
    await victim.query("ROLLBACK"); await survivor.query("COMMIT");
    expect((await monitor.query("SELECT notes FROM accounts WHERE id=$1", [victimAccount])).rows[0].notes).toBeNull();
    expect((await monitor.query("SELECT notes FROM accounts WHERE id=$1", [survivorAccount])).rows[0].notes).toBe(victim === a ? "B attempt 1" : "A attempt 1");
    expect((await current())[0].evidence).toBeNull();
    expect((await monitor.query("SELECT net_worth::text FROM net_worth_snapshots WHERE household_id=$1", [household])).rows[0].net_worth).toBe(victim === b ? "900.00" : "777.00");
    await victim.query("BEGIN");
    await victim.query("UPDATE accounts SET notes=$2 WHERE id=$1", [victimAccount, victim === a ? "A attempt 2" : "B attempt 2"]);
    if (victim === a) { await victim.query("SELECT id FROM account_worth_captures WHERE household_id=$1 FOR UPDATE", [household]); await withdraw(victim); }
    else await legacy(victim, "UPDATE", "777.00");
    await victim.query("COMMIT");
    expect((await monitor.query("SELECT notes FROM accounts WHERE id=$1", [victimAccount])).rows[0].notes).toBe(victim === a ? "A attempt 2" : "B attempt 2");
    expect((await current())[0].evidence).toBeNull();
    expect((await monitor.query("SELECT net_worth::text FROM net_worth_snapshots WHERE household_id=$1", [household])).rows[0].net_worth).toBe("777.00");
  }, 25_000);
});
