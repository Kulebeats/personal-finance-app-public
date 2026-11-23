import request from "supertest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dataExports } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

const body = { reportType: "transactions", format: "csv", startDate: "2026-10-01", endDate: "2026-10-31",
  scope: "mine", search: "PRIVSECRET", accountId: ids.privateAccount, includePending: false };
const signed = (test: request.Test, role: Role | "outsider" = "owner") => test.set("Cookie", actors.get(role)!.cookie);
const create = (role: Role = "owner") => signed(request(app).post("/api/reports/exports"), role).send(body);
const clean = () => db.delete(dataExports).where(inArray(dataExports.householdId, [a, b]));
const header = "date,name,merchant,category,account,type,amount,currency,amountBase,baseCurrency,isPending,notes,transactionId,splitId\n";
const range = { reportType: "transactions", format: "csv", startDate: body.startDate, endDate: body.endDate, includePending: false };
const cash = (role: Role, name: string, amount: string) => signed(request(app).post("/api/transactions"), role).send({
  accountId: ids.sharedAccount, date: "2026-10-06", type: "income", name, amount: { amount, currency: "ZMW" }, idempotencyKey: randomUUID(),
}).expect(201);

describe("R04 transaction export creation and artifact metadata protect private source intent", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterAll(async () => { await clean(); await stop(); });
  it.each(["view_only", "professional"] as const)("denies %s transaction-export creation without a job or audit", async role => {
    const before = (await pool.query("select * from audit_logs where user_id=$1 order by id", [actors.get(role)!.id])).rows;
    const response = await create(role).expect(403); expect(response.text).not.toContain("777.77");
    expect((await pool.query("select id from data_exports where household_id=$1 and user_id=$2", [a, actors.get(role)!.id])).rows).toEqual([]);
    expect((await pool.query("select * from audit_logs where user_id=$1 order by id", [actors.get(role)!.id])).rows).toEqual(before);
  });
  it.each(["view_only", "professional"] as const)("denies the creator's list/detail after a current %s downgrade", async role => {
    const response = await create().expect(200), id = response.body.data.id, ownerId = actors.get("owner")!.id;
    await pool.query("update household_members set role=$3 where household_id=$1 and user_id=$2", [a, ownerId, role]);
    for (const url of ["/api/reports/exports", `/api/reports/exports/${id}`]) {
      const denied = await signed(request(app).get(url)).expect(403);
      expect(denied.text).not.toContain(body.search); expect(denied.text).not.toContain(ids.privateAccount);
    }
    expect((await pool.query("select id from audit_logs where entity_id=$1 and action='PROCESS'", [id])).rows).toEqual([]);
  });
  it("retains the creator's private search and count while redacting them from a different admin's list/detail", async () => {
    const response = await create().expect(200), item = response.body.data;
    expect(item).toMatchObject({ recordCount: 1, parameters: { search: body.search, accountId: ids.privateAccount, scope: "mine" } });
    const own = await signed(request(app).get(`/api/reports/exports/${item.id}`)).expect(200);
    expect(own.body.data).toMatchObject({ recordCount: 1, parameters: { search: body.search, accountId: ids.privateAccount } });
    const peer = await signed(request(app).get(`/api/reports/exports/${item.id}`), "admin").expect(200);
    const list = await signed(request(app).get("/api/reports/exports"), "admin").expect(200);
    const listed = list.body.data.exports.find((entry: { id: string }) => entry.id === item.id);
    for (const metadata of [peer.body.data, listed]) {
      expect(metadata).toMatchObject({ id: item.id, exportType: "transactions", status: "completed", parameters: null, recordCount: null });
      expect(JSON.stringify(metadata)).not.toContain(body.search); expect(JSON.stringify(metadata)).not.toContain(ids.privateAccount);
    }
    const ownerDownload = await signed(request(app).get(`/api/reports/exports/${item.id}?download=true`)).expect(200);
    expect(ownerDownload.text).toContain("777.77");
    const adminDownload = await signed(request(app).get(`/api/reports/exports/${item.id}?download=true`), "admin").expect(200);
    expect(adminDownload.text).not.toContain("777.77"); expect(adminDownload.text).not.toContain(body.search);
  });
  it("keeps private result-count CREATE and PROCESS evidence in the actual exporter's audience", async () => {
    const response = await create().expect(200), id = response.body.data.id;
    await signed(request(app).get(`/api/reports/exports/${id}?download=true`)).expect(200);
    const evidence = (await pool.query("select action,household_id,user_id,details from audit_logs where entity_type='data_export' and entity_id=$1 order by action", [id])).rows;
    expect(evidence).toEqual(["CREATE", "PROCESS"].map(action => expect.objectContaining({ action, household_id: null, user_id: actors.get("owner")!.id,
      details: expect.objectContaining({ recordCount: 1 }) })));
  });
  it("keeps the creator's malformed stored scope error generic", async () => {
    const response = await create().expect(200), id = response.body.data.id, sentinel = "PRIVATE_ARTIFACT_SCOPE_SENTINEL";
    await pool.query("update data_exports set parameters=jsonb_set(parameters,'{scope}',$2::jsonb) where id=$1", [id, JSON.stringify(sentinel)]);
    const denied = await signed(request(app).get(`/api/reports/exports/${id}?download=true`)).expect(400);
    expect(denied.text).not.toContain(sentinel); expect(denied.text).not.toContain(body.search); expect(denied.text).not.toContain(ids.privateAccount);
    expect((await pool.query("select id from audit_logs where entity_id=$1 and action='PROCESS'", [id])).rows).toEqual([]);
  });
  for (const status of ["pending", "failed"] as const) it.each(["owner", "admin"] as const)(`denies %s download of a locked ${status} job without CREATE/PROCESS or CSV`, async role => {
    const [job] = await db.insert(dataExports).values({ householdId: a, userId: actors.get("owner")!.id, exportType: "transactions", fileFormat: "csv",
      status, parameters: body, dateRangeStart: body.startDate, dateRangeEnd: body.endDate }).returning({ id: dataExports.id });
    const denied = await signed(request(app).get(`/api/reports/exports/${job.id}?download=true`), role).expect(400);
    expect(denied.headers["content-type"]).not.toContain("text/csv"); expect(denied.text).not.toContain("777.77");
    expect((await pool.query("select id from audit_logs where entity_type='data_export' and entity_id=$1", [job.id])).rows).toEqual([]);
    expect((await pool.query("select status from data_exports where id=$1", [job.id])).rows[0].status).toBe(status);
  });
  it("returns identical header-only CSV for another signer's private A/B or malformed intent without querying their rows", async () => {
    await cash("owner", "SelectionAlpha", "13.13"); await cash("owner", "SelectionBeta", "24.24");
    await cash("admin", "SelectionAlpha", "51.11"); await cash("admin", "SelectionBeta", "62.22");
    const jobIds: string[] = [];
    for (const search of ["SelectionAlpha", "SelectionBeta"]) {
      const created = await signed(request(app).post("/api/reports/exports")).send({ ...range, scope: "mine", search }).expect(200);
      jobIds.push(created.body.data.id);
    }
    const own = await signed(request(app).get(`/api/reports/exports/${jobIds[0]}?download=true`)).expect(200);
    expect(own.text).toContain("13.13"); expect(own.text).not.toContain("24.24");
    for (const id of jobIds) {
      const peer = await signed(request(app).get(`/api/reports/exports/${id}?download=true`), "admin").expect(200);
      expect(peer.text).toBe(header); expect(peer.headers["content-disposition"]).toBe('attachment; filename="transactions.csv"');
      const audit = (await pool.query("select household_id,user_id,details from audit_logs where entity_id=$1 and action='PROCESS' and user_id=$2", [id, actors.get("admin")!.id])).rows;
      expect(audit).toEqual([expect.objectContaining({ household_id: null, user_id: actors.get("admin")!.id, details: expect.objectContaining({ recordCount: 0 }) })]);
    }
    await pool.query("update data_exports set parameters=jsonb_set(parameters,'{scope}','\"PRIVATE_INVALID_SCOPE\"') where id=$1", [jobIds[1]]);
    const malformed = await signed(request(app).get(`/api/reports/exports/${jobIds[1]}?download=true`), "admin").expect(200);
    expect(malformed.text).toBe(header);
  });
  it("treats completed legacy jobs without a sharing marker as private intent", async () => {
    await cash("admin", "LegacyUnfilteredCash", "51.11");
    const [job] = await db.insert(dataExports).values({ householdId: a, userId: actors.get("owner")!.id, exportType: "transactions", fileFormat: "csv",
      status: "completed", parameters: null, dateRangeStart: body.startDate, dateRangeEnd: body.endDate }).returning({ id: dataExports.id });
    const peer = await signed(request(app).get(`/api/reports/exports/${job.id}?download=true`), "admin").expect(200);
    expect(peer.text).toBe(header);
  });
  it("preserves a fresh normal admin-owned household/unfiltered export of their currently visible cash", async () => {
    await cash("admin", "PublicAlpha", "51.11"); await cash("admin", "PublicBeta", "62.22");
    const created = await signed(request(app).post("/api/reports/exports"), "admin").send({ ...range, scope: "household" }).expect(200);
    const downloaded = await signed(request(app).get(`/api/reports/exports/${created.body.data.id}?download=true`), "admin").expect(200);
    expect(downloaded.text).toContain("51.11"); expect(downloaded.text).toContain("62.22"); expect(downloaded.text).toContain("11.11");
    expect(downloaded.text).not.toContain("777.77");
  });
  it.each(["member", "outsider"] as const)("keeps another creator's artifact unavailable to an ordinary %s", async role => {
    const response = await create().expect(200), id = response.body.data.id;
    const denied = await signed(request(app).get(`/api/reports/exports/${id}`), role).expect(role === "member" ? 403 : 404);
    expect(denied.text).not.toContain(body.search); expect(denied.text).not.toContain(ids.privateAccount);
  });
});
