// Run through the protected database tsx wrapper with a restricted login and three synthetic fixture IDs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../../db";

const [household, actor, account] = process.argv.slice(3);
if (![household, actor, account].every(id => /^[0-9a-f-]{36}$/i.test(id ?? ""))) {
  throw new Error("Expected the marked fixture's household, actor and account UUIDs");
}
const claimant = await pool.connect();
const writer = await pool.connect();
const id = randomUUID(), key = randomUUID();
try {
  const { rows: [privilege] } = await claimant.query(`SELECT current_user = session_user AS authenticated,
    has_database_privilege(current_user,current_database(),'TEMP') AS temp,
    has_schema_privilege(current_user,'public','CREATE') AS schema_create,
    EXISTS (SELECT FROM pg_catalog.pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND
      (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls OR
        r.rolname IN ('pg_write_all_data','pg_read_all_data','pg_execute_server_program','pg_write_server_files','pg_read_server_files'))) AS elevated,
    EXISTS (SELECT FROM pg_catalog.pg_class c WHERE c.oid IN ('public.transactions'::regclass,
      'public.transaction_create_owner_intents'::regclass) AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns_tables,
    EXISTS (SELECT FROM pg_catalog.pg_database d WHERE d.datname=current_database()
      AND pg_has_role(current_user,d.datdba,'MEMBER')) AS owns_db`);
  assert.deepEqual(privilege, { authenticated: true, temp: true, schema_create: false, elevated: false, owns_tables: false, owns_db: false });
  const fixture = await writer.query(`SELECT 1 FROM public.accounts a JOIN public.household_members m ON m.household_id=a.household_id
     WHERE a.id=$1 AND a.household_id=$2 AND m.user_id=$3`, [account, household, actor]);
  assert.equal(fixture.rowCount, 1);
  await claimant.query("BEGIN");
  await claimant.query("CREATE TEMP TABLE acquire_temp_namespace (id integer) ON COMMIT DROP");
  await claimant.query("CREATE TYPE pg_temp.xid AS (claimed pg_catalog.xid)");
  await claimant.query(`CREATE FUNCTION pg_temp.fake_xid(pg_catalog.xid8) RETURNS pg_temp.xid LANGUAGE sql STABLE AS
    $$ SELECT ROW(pg_catalog.current_setting('pfa_probe.foreign_xmin')::pg_catalog.xid)::pg_temp.xid $$`);
  await claimant.query(`CREATE FUNCTION pg_temp.unwrap_xid(pg_temp.xid) RETURNS pg_catalog.xid LANGUAGE sql IMMUTABLE AS
    $$ SELECT ($1).claimed $$`);
  await claimant.query("CREATE CAST (pg_catalog.xid8 AS pg_temp.xid) WITH FUNCTION pg_temp.fake_xid(pg_catalog.xid8)");
  await claimant.query("CREATE CAST (pg_temp.xid AS pg_catalog.xid) WITH FUNCTION pg_temp.unwrap_xid(pg_temp.xid) AS IMPLICIT");
  await claimant.query(`INSERT INTO public.transaction_create_owner_intents
    (transaction_id,idempotency_key,household_id,actor_user_id,owner_selected) VALUES ($1,$2,$3,$4,false)`, [id,key,household,actor]);
  const { rows: [posting] } = await writer.query(`INSERT INTO public.transactions
    (id,idempotency_key,household_id,account_id,owner_user_id,type,name,date,amount,currency)
    VALUES ($1,$2,$3,$4,$5,'expense','Restricted XID control','2026-01-10','1.00','ZMW') RETURNING xmin::pg_catalog.text AS xmin`,
    [id,key,household,account,actor]);
  await claimant.query("SELECT pg_catalog.set_config('pfa_probe.foreign_xmin',$1,true)", [posting.xmin]);
  const { rows: [proof] } = await claimant.query(`SELECT
    (pg_catalog.pg_current_xact_id()::pg_temp.xid).claimed = $1::pg_catalog.xid AS explicit_spoof_works,
    public.transfer_creation_owns_xid($1::pg_catalog.xid) AS accepts_foreign`, [posting.xmin]);
  let sealCode: string | undefined;
  await claimant.query("SAVEPOINT try_ordinary_seal");
  try {
    await claimant.query("UPDATE public.transaction_create_owner_intents SET posting_confirmed=true WHERE transaction_id=$1", [id]);
  } catch (error) {
    sealCode = (error as { code?: string }).code;
  }
  await claimant.query("ROLLBACK TO SAVEPOINT try_ordinary_seal");
  console.log(JSON.stringify({ privilege, ...proof, sealCode: sealCode ?? "accepted" }));
  assert.equal(proof.explicit_spoof_works, true);
  assert.equal(proof.accepts_foreign, false);
  assert.equal(sealCode, "23514");
} finally {
  try {
    await claimant.query("ROLLBACK");
    await writer.query("DELETE FROM public.transactions WHERE id=$1 AND household_id=$2", [id, household]);
  } finally { claimant.release(); writer.release(); await pool.end(); }
}
