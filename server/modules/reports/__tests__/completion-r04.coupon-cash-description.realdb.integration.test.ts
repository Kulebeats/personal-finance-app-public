import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accounts, dataExports, grzBondPayments, grzBonds, outboxEvents, users } from "@shared/schema";
import { db, pool } from "../../../db";
import { transactionReportRepository } from "../../../repositories/reports";
import { reportsExportService } from "../reports.export.service";
import { revokeSessionByToken } from "../../../services/session-revocation";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const bond = randomUUID(), coupon = randomUUID(), secret = "Synthetic Confidential Custody Holding", date = "2026-02-12";
const owner = (test: request.Test) => test.set("Cookie", actors.get("owner")!.cookie);
const peer = (test: request.Test) => test.set("Cookie", actors.get("admin")!.cookie);
async function clean() {
  await db.delete(dataExports).where(inArray(dataExports.householdId, [a, b]));
  await db.delete(grzBondPayments).where(eq(grzBondPayments.bondId, bond));
  await db.delete(grzBonds).where(eq(grzBonds.id, bond));
  await db.delete(outboxEvents).where(inArray(outboxEvents.householdId, [a, b]));
}
async function posting(custody: "private" | "absent" | "public") {
  await db.insert(grzBonds).values({ id: bond, householdId: a, bondName: secret,
    accountId: custody === "absent" ? null : custody === "private" ? ids.privateAccount : ids.sharedAccount,
    tenorYears: 5, faceValue: "1000", purchasePrice: "950", purchaseDate: "2025-01-01", maturityDate: "2030-01-01", couponRate: "0.20" });
  await db.insert(grzBondPayments).values({ id: coupon, bondId: bond, paymentDate: date, paymentType: "coupon",
    grossAmount: "100", withholdingTax: "15", netAmount: "85" });
  const result = await owner(request(app).post(`/api/grz/payments/${coupon}/pay`)).send({ accountId: ids.sharedAccount, date }).expect(200);
  // Simulate the existing detailed rows, preserving the real immutable origin,
  // original CREATE metadata and actual paid linkage rather than inventing one.
  const id = result.body.data.incomeTransactionId as string;
  await pool.query("update transactions set name=$2,original_name=$2,notes=$3 where id=$1", [id, `GRZ Coupon: ${secret}`, `Coupon Payment for ${secret}. Gross: 100.00, WHT: 15.00`]);
  return id;
}
const report = (search?: string) => peer(request(app).get("/api/reports/transactions").query({ from: date, to: date, scope: "household", accountId: ids.sharedAccount, limit: 100, ...(search ? { search } : {}) }));
async function csv(search?: string, filters: { merchantId?: string; accountId?: string } = {}) {
  // Actual signed stored-export download, using the existing no-timer fixture pattern.
  const [item] = await db.insert(dataExports).values({ householdId: a, userId: actors.get("admin")!.id, exportType: "transactions", fileFormat: "csv",
    status: "completed", dateRangeStart: date, dateRangeEnd: date, recordCount: 1,
    parameters: { reportType: "transactions", format: "csv", startDate: date, endDate: date, scope: "household",
      accountId: ids.sharedAccount, search, ...filters, includeCharts: false, includeForecast: false, forecastMonths: 3 } }).returning({ id: dataExports.id });
  return peer(request(app).get(`/api/reports/exports/${item.id}?download=true`));
}
function noSecret(text: string) {
  for (const value of [secret.toLowerCase(), "gross:", "wht:"]) expect(text.toLowerCase()).not.toContain(value);
}

describe("R04 transaction drilldown and CSV protect coupon custody details", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await clean(); await stop(); });
  it.each(["private", "absent"] as const)("keeps the real public cash in reports and CSV without %s custody detail", async custody => {
    const id = await posting(custody);
    const response = await report().expect(200);
    expect(response.body.data.items).toEqual([expect.objectContaining({ id, date, account: expect.objectContaining({ id: ids.sharedAccount }),
      amount: { amount: "85.00", currency: "ZMW" } })]);
    noSecret(response.text);
    const download = await csv(); expect(download.status).toBe(200); noSecret(download.text);
    expect(download.text).toContain("85"); expect(download.text).toContain("ZMW"); expect(download.text.trim().split(/\r?\n/)).toHaveLength(2);
  });
  it.each(["private", "absent"] as const)("does not search hidden %s custody through report or stored CSV filters", async custody => {
    await posting(custody);
    const response = await report(secret).expect(200); expect(response.body.data.items).toEqual([]);
    const download = await csv(secret); expect(download.status).toBe(200); noSecret(download.text);
    expect(download.text.trim().split(/\r?\n/)).toHaveLength(1);
  });
  it("retains detailed attributable public custody cash through report and stored CSV search", async () => {
    const id = await posting("public");
    const response = await report(secret).expect(200); expect(response.body.data.items).toEqual([expect.objectContaining({ id })]);
    expect(response.text).toContain(secret);
    const download = await csv(secret); expect(download.status).toBe(200); expect(download.text).toContain(secret);
    expect(download.text.trim().split(/\r?\n/)).toHaveLength(2);
  });
  it("restores a stored merchant filter with an empty result instead of exporting the public cash", async () => {
    await posting("public"); const download = await csv(undefined, { merchantId: randomUUID() });
    expect(download.status).toBe(200); expect(download.text.trim().split(/\r?\n/)).toHaveLength(1);
  });
  it("restores the stored account filter and excludes another real shared posting", async () => {
    await posting("public"); const accountId = randomUUID();
    await db.insert(accounts).values({ id: accountId, householdId: a, ownerUserId: actors.get("owner")!.id,
      name: "Other shared cash", type: "checking", currency: "ZMW", initialBalance: "500", balance: "500", isPrivate: false });
    await owner(request(app).post("/api/transactions")).send({ accountId, date, name: "Unrelated shared export record", type: "income",
      amount: { amount: "12.35", currency: "ZMW" }, idempotencyKey: randomUUID() }).expect(201);
    const download = await csv(); expect(download.status).toBe(200);
    expect(download.text).not.toContain("Unrelated shared export record"); expect(download.text).not.toContain("12.35");
    expect(download.text.trim().split(/\r?\n/)).toHaveLength(2); expect(download.text).toContain("85");
  });
  it("retains defaults for a historical stored export with absent optional fields", async () => {
    await posting("private");
    const [item] = await db.insert(dataExports).values({ householdId: a, userId: actors.get("admin")!.id, exportType: "transactions", fileFormat: "csv",
      status: "completed", dateRangeStart: date, dateRangeEnd: date, recordCount: 1,
      parameters: { reportType: "transactions", startDate: date, endDate: date } }).returning({ id: dataExports.id });
    const download = await peer(request(app).get(`/api/reports/exports/${item.id}?download=true`)).expect(200);
    noSecret(download.text); expect(download.text.trim().split(/\r?\n/)).toHaveLength(2); expect(download.text).toContain("85");
  });
  it("checks the current role before replaying a stored household-scope export", async () => {
    await posting("private");
    await pool.query("update household_members set role='member' where household_id=$1 and user_id=$2", [a, actors.get("admin")!.id]);
    const download = await csv(); expect(download.status).toBe(403); noSecret(download.text);
  });
  it.each(["malformed", "", null, { household: true }])("rejects a malformed stored scope without selecting financial data: %j", async scope => {
    await posting("private");
    const [item] = await db.insert(dataExports).values({ householdId: a, userId: actors.get("admin")!.id, exportType: "transactions", fileFormat: "csv",
      status: "completed", dateRangeStart: date, dateRangeEnd: date, recordCount: 1,
      parameters: { reportType: "transactions", format: "csv", startDate: date, endDate: date, scope } }).returning({ id: dataExports.id });
    const response = await peer(request(app).get(`/api/reports/exports/${item.id}?download=true`)).expect(400);
    noSecret(response.text); expect(response.text).not.toContain("85.00");
    expect((await pool.query("select id from audit_logs where entity_id=$1 and action='PROCESS'", [item.id])).rows).toEqual([]);
  });
  it("serializes a household-role withdrawal through one authorized buffered download", async () => {
    await posting("public");
    let entered = false, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), actual = transactionReportRepository.getTransactions.bind(transactionReportRepository);
    vi.spyOn(transactionReportRepository, "getTransactions").mockImplementationOnce(async (...args) => { const result = await actual(...args); entered = true; await gate; return result; });
    const download = csv(), writer = await pool.connect(); let withdrawal: Promise<unknown> | undefined;
    try {
      await expect.poll(() => entered, { timeout: 5000 }).toBe(true);
      const { rows: [backend] } = await writer.query("select pg_backend_pid() as pid"); let committed = false;
      withdrawal = writer.query("update household_members set role='member' where household_id=$1 and user_id=$2", [a, actors.get("admin")!.id]).then(() => { committed = true; });
      let blocked = false;
      await expect.poll(async () => { blocked = (await pool.query("select cardinality(pg_blocking_pids($1)) > 0 as blocked", [backend.pid])).rows[0].blocked; return blocked || committed; }, { timeout: 5000 }).toBe(true);
      const serialized = blocked && !committed; release(); const response = await download; await withdrawal;
      expect(serialized).toBe(true); expect(response.status).toBe(200); expect(response.text).toContain("85");
    } finally { release(); await Promise.allSettled([download, ...(withdrawal ? [withdrawal] : [])]); writer.release(); }
  }, 20_000);
  it("does not release detailed CSV after a contributing custody account becomes private during the read", async () => {
    await owner(request(app).put(`/api/accounts/${ids.privateAccount}`)).send({ isPrivate: false }).expect(200);
    await posting("private");
    let entered = false, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), actual = transactionReportRepository.getTransactions.bind(transactionReportRepository);
    vi.spyOn(transactionReportRepository, "getTransactions").mockImplementationOnce(async (...args) => { const result = await actual(...args); entered = true; await gate; return result; });
    const download = csv();
    try {
      await expect.poll(() => entered, { timeout: 5000 }).toBe(true);
      await owner(request(app).put(`/api/accounts/${ids.privateAccount}`)).send({ isPrivate: true }).expect(200);
      release(); const response = await download; expect(response.status).toBe(200); noSecret(response.text); expect(response.text).toContain("85");
    } finally { release(); await Promise.allSettled([download]); }
  }, 20_000);
  it("denies a mine-scope artifact after export capability is withdrawn behind route admission", async () => {
    await posting("public");
    const [item] = await db.insert(dataExports).values({ householdId: a, userId: actors.get("owner")!.id, exportType: "transactions", fileFormat: "csv",
      status: "completed", dateRangeStart: date, dateRangeEnd: date, recordCount: 1,
      parameters: { reportType: "transactions", format: "csv", startDate: date, endDate: date, scope: "mine" } }).returning({ id: dataExports.id });
    let entered = false, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const actual = reportsExportService.getExportById.bind(reportsExportService);
    vi.spyOn(reportsExportService, "getExportById").mockImplementationOnce(async (...args) => { const result = await actual(...args); entered = true; await gate; return result; });
    const download = owner(request(app).get(`/api/reports/exports/${item.id}?download=true`)).then(result => result);
    try {
      await expect.poll(() => entered, { timeout: 5000 }).toBe(true);
      await pool.query("update household_members set role='view_only' where household_id=$1 and user_id=$2", [a, actors.get("owner")!.id]);
      release(); const response = await download; expect(response.status).toBe(403); noSecret(response.text); expect(response.text).not.toContain("85.00");
      expect((await pool.query("select id from audit_logs where entity_id=$1 and action='PROCESS'", [item.id])).rows).toEqual([]);
    } finally { release(); await Promise.allSettled([download]); }
  });
  it("audits the actual emitted count after privacy changes the stored job's result", async () => {
    const hidden = await posting("public");
    await owner(request(app).post("/api/transactions")).send({ accountId: ids.sharedAccount, date, name: "Visible current cash", type: "income",
      amount: { amount: "12.35", currency: "ZMW" }, idempotencyKey: randomUUID() }).expect(201);
    const [item] = await db.insert(dataExports).values({ householdId: a, userId: actors.get("admin")!.id, exportType: "transactions", fileFormat: "csv",
      status: "completed", dateRangeStart: date, dateRangeEnd: date, recordCount: 2,
      parameters: { reportType: "transactions", format: "csv", startDate: date, endDate: date, scope: "household" } }).returning({ id: dataExports.id });
    await owner(request(app).put(`/api/transactions/${hidden}`)).send({ isPrivate: true }).expect(200);
    const response = await peer(request(app).get(`/api/reports/exports/${item.id}?download=true`)).expect(200);
    expect(response.text.trim().split(/\r?\n/)).toHaveLength(2); expect(response.text).toContain("12.35");
    // Exact cells, not a substring of the whole CSV: its random UUIDs can contain "85".
    const cells = response.text.split(/[\r\n,]/).map(cell => cell.trim().replace(/^"|"$/g, ""));
    expect(cells).not.toContain("85"); expect(cells).not.toContain("85.00"); expect(response.text).not.toContain(secret);
    const { rows: [audit] } = await pool.query("select details from audit_logs where entity_id=$1 and action='PROCESS'", [item.id]);
    expect(audit.details.recordCount).toBe(1);
  });
  it.each(["security generation", "verification"] as const)("denies a committed %s withdrawal behind route admission with membership retained", async field => {
    await posting("public");
    const { rows: [profile] } = await pool.query("select email from users where id=$1", [actors.get("owner")!.id]);
    const [item] = await db.insert(dataExports).values({ householdId: a, userId: actors.get("owner")!.id, exportType: "transactions", fileFormat: "csv",
      status: "completed", dateRangeStart: date, dateRangeEnd: date, recordCount: 1,
      parameters: { reportType: "transactions", format: "csv", startDate: date, endDate: date, scope: "mine" } }).returning({ id: dataExports.id });
    let entered = false, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const actual = reportsExportService.getExportById.bind(reportsExportService);
    vi.spyOn(reportsExportService, "getExportById").mockImplementationOnce(async (...args) => { const result = await actual(...args); entered = true; await gate; return result; });
    const download = owner(request(app).get(`/api/reports/exports/${item.id}?download=true`)).then(result => result);
    try {
      await expect.poll(() => entered, { timeout: 5000 }).toBe(true);
      await pool.query(field === "security generation" ? "update users set security_generation=security_generation+1 where id=$1" : "update users set email_verified=false where id=$1", [actors.get("owner")!.id]);
      release(); const response = await download; expect(response.status).toBe(field === "security generation" ? 401 : 403); noSecret(response.text); expect(response.text).not.toContain("85.00");
      expect((await pool.query("select id from audit_logs where entity_id=$1 and action='PROCESS'", [item.id])).rows).toEqual([]);
      expect((await pool.query("select user_id from household_members where household_id=$1 and user_id=$2", [a, actors.get("owner")!.id])).rows).toHaveLength(1);
    } finally {
      release(); await Promise.allSettled([download]);
      await pool.query("update users set email_verified=true where id=$1", [actors.get("owner")!.id]);
      const login = await request(app).post("/api/auth/login").send({ email: profile.email, password: "SyntheticR04Tags123!" }).expect(200);
      actors.get("owner")!.cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    }
  });
  it("rejects a selected SID revoked while its unchanged user row blocks the publication snapshot", async () => {
    await posting("public");
    const ownerId = actors.get("owner")!.id;
    const sid = decodeURIComponent(actors.get("owner")!.cookie.split(";")[0].split("=").slice(1).join("=")).slice(2).split(".")[0];
    const { rows: [profile] } = await pool.query("select email,security_generation from users where id=$1", [ownerId]);
    const [item] = await db.insert(dataExports).values({ householdId: a, userId: ownerId, exportType: "transactions", fileFormat: "csv",
      status: "completed", dateRangeStart: date, dateRangeEnd: date, recordCount: 1,
      parameters: { reportType: "transactions", format: "csv", startDate: date, endDate: date, scope: "mine" } }).returning({ id: dataExports.id });
    let held = false, writerPid = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writer = db.transaction(async tx => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).for("update");
      writerPid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid; held = true;
      await gate; await revokeSessionByToken(tx, ownerId, sid);
    });
    let download: Promise<request.Response> | undefined;
    try {
      await expect.poll(() => held, { timeout: 5000 }).toBe(true);
      download = owner(request(app).get(`/api/reports/exports/${item.id}?download=true`)).then(result => result);
      await expect.poll(async () => (await pool.query("select exists(select from pg_stat_activity where $1=any(pg_blocking_pids(pid)) and query ilike '%from \"users\"%') as blocked", [writerPid])).rows[0].blocked, { timeout: 5000 }).toBe(true);
      release(); await writer; const response = await download; expect(response.status).toBe(401); noSecret(response.text); expect(response.text).not.toContain("85.00");
      expect((await pool.query("select id from audit_logs where entity_id=$1 and action='PROCESS'", [item.id])).rows).toEqual([]);
      expect((await pool.query('select sid from "session" where sid=$1', [sid])).rows).toEqual([]);
      expect((await pool.query("select security_generation from users where id=$1", [ownerId])).rows[0].security_generation).toBe(profile.security_generation);
    } finally {
      release(); await Promise.allSettled([writer, ...(download ? [download] : [])]);
      const login = await request(app).post("/api/auth/login").send({ email: profile.email, password: "SyntheticR04Tags123!" }).expect(200);
      actors.get("owner")!.cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    }
  }, 20_000);
});
