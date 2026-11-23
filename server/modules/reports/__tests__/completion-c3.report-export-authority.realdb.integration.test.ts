import { randomUUID } from "node:crypto";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accounts, budgets, categories, categoryGroups, dataExports, fxRates,
  householdMembers, households, transactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import {
  createFXRateRepository, createFXRateService, setGlobalFXService,
} from "../../../core/calculations";
import {
  a, b, actors, resetAccountsAndMembership, roles, stop, type Role,
} from "../../tags/__tests__/completion-r04.tags.fixture";
import type { ExportReportInput } from "../reports.validation";

const reportTypes = ["spending", "cashflow", "budget", "networth"] as const;
type ReportType = (typeof reportTypes)[number];
const deniedRoles = ["view_only", "professional"] as const;
const populatedRoles = ["member", ...deniedRoles] as const;
const password = "SyntheticC3ReportExport123!";
const first = "2026-10-01", last = "2026-10-31";
const groupId = randomUUID(), categoryId = randomUUID(), budgetId = randomUUID();
const accountIds = new Map(populatedRoles.map(role => [role, randomUUID()]));
// Capture every identity before any insert or assertion, including partial setup.
const plannedActors = [...roles, "outsider" as const].map(role => {
  const id = randomUUID();
  return { role, id, email: `c3-report-export-${id}@example.invalid`,
    householdId: role === "outsider" ? b : a };
});
const observedExportIds = new Set<string>();
const auditFaults = new Set<string>();
let app: Awaited<ReturnType<typeof getTestApp>>;

function input(reportType: ReportType): ExportReportInput {
  return { reportType, format: "csv", startDate: first, endDate: last,
    scope: "mine", interval: "month", groupBy: "category", includePending: false,
    includeTransfers: false, includeCharts: false, includeForecast: false, forecastMonths: 3 };
}
const signed = (test: request.Test, role: Role = "member") => test.set("Cookie", actors.get(role)!.cookie);
const metadata = (id: string) => signed(request(app).get(`/api/reports/exports/${id}`));
const download = (id: string) => signed(request(app).get(`/api/reports/exports/${id}?download=true`));

async function loginActor(role: Role | "outsider") {
  const actor = plannedActors.find(candidate => candidate.role === role)!;
  const login = await request(app).post("/api/auth/login").send({ email: actor.email, password });
  const cookie = (login.headers["set-cookie"] as unknown as string[] | undefined)?.join("; ") ?? "";
  actors.set(role, { id: actor.id, cookie });
  expect(login.status).toBe(200);
  expect(decodeURIComponent(cookie.split(";")[0])).toMatch(/^connect\.sid=s:/);
  expect(login.body.data.user).toMatchObject({ id: actor.id, emailVerified: true });
}

async function create(reportType: ReportType, role: Role = "member") {
  const response = await signed(request(app).post("/api/reports/exports"), role).send(input(reportType));
  const id: unknown = response.body.data?.id;
  if (typeof id === "string") observedExportIds.add(id);
  return response;
}

async function exportState(userId: string) {
  return {
    jobs: (await pool.query("SELECT * FROM data_exports WHERE household_id=$1 AND user_id=$2 ORDER BY id", [a, userId])).rows,
    // A legitimate DENIED/security audit is allowed. These are publication effects.
    publicationAudits: (await pool.query(`SELECT * FROM audit_logs
      WHERE user_id=$1 AND entity_type='data_export' AND action IN ('CREATE','PROCESS') ORDER BY id`, [userId])).rows,
    accounts: await db.select().from(accounts).where(eq(accounts.householdId, a)).orderBy(accounts.id),
    transactions: await db.select().from(transactions).where(eq(transactions.householdId, a)).orderBy(transactions.id),
    budgets: await db.select().from(budgets).where(eq(budgets.householdId, a)).orderBy(budgets.id),
  };
}

function observation(phase: string, reportType: ReportType, role: Role, response: request.Response) {
  return { phase, reportType, role, status: response.status,
    errorCode: response.body.error?.code ?? null,
    responseExportId: response.body.data?.id ?? null,
    responseExportStatus: response.body.data?.status ?? null,
    contentType: response.headers["content-type"] ?? null,
    attachment: response.headers["content-disposition"] ?? null,
    responseBytes: Buffer.byteLength(response.text ?? "") };
}

async function memberArtifact(reportType: ReportType) {
  const response = await create(reportType);
  console.info(JSON.stringify({ reportExportAuthority: observation("member-create", reportType, "member", response) }));
  expect(response.status).toBe(200);
  const item = response.body.data;
  expect(item).toMatchObject({ userId: actors.get("member")!.id, householdId: a,
    exportType: reportType, fileFormat: "csv", status: "completed",
    dateRangeStart: first, dateRangeEnd: last, parameters: { ...input(reportType) } });
  expect(item.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(item.fileUrl).toBe(`/api/reports/exports/${item.id}?download=true`);
  expect(item.recordCount).toBeGreaterThan(0);
  return item.id as string;
}

const headers: Record<ReportType, string> = {
  spending: "groupBy,label,amount,currency,percent",
  cashflow: "periodStart,periodEnd,income,expenses,savings,debt,savingsRate,currency,dataType",
  budget: "period,category,budgeted,actual,variance,variancePercent,status,currency",
  networth: "date,netWorth,assets,liabilities,currency",
};
function assertMemberCsv(response: request.Response, reportType: ReportType,
  spending: { groupBy: "category" | "categoryGroup"; label: string } = {
    groupBy: "category", label: "Synthetic export groceries",
  }) {
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toContain("text/csv");
  expect(response.headers["content-disposition"]).toContain("attachment;");
  // Inspect plain text only; never execute exported spreadsheet content.
  const lines = response.text.trim().split(/\r?\n/);
  expect(lines[0]).toBe(headers[reportType]);
  expect(lines.length).toBeGreaterThan(1);
  expect(response.text).toContain("ZMW");
  if (reportType === "spending") expect(response.text).toContain(`${spending.groupBy},${spending.label},`);
  if (reportType === "budget") expect(response.text).toContain("Synthetic export groceries");
}

async function cleanExports() {
  const actorIds = plannedActors.map(actor => actor.id);
  // Resolve even a persisted job whose failed response never returned its ID.
  const owned = await db.select({ id: dataExports.id }).from(dataExports).where(and(
    eq(dataExports.householdId, a), inArray(dataExports.userId, actorIds),
  ));
  for (const { id } of owned) observedExportIds.add(id);
  if (observedExportIds.size) await db.delete(dataExports).where(and(
    eq(dataExports.householdId, a), inArray(dataExports.userId, actorIds),
    inArray(dataExports.id, [...observedExportIds]),
  ));
}

async function dropAuditFault(name: string) {
  await pool.query(`DROP TRIGGER IF EXISTS "${name}" ON public.audit_logs`);
  await pool.query(`DROP FUNCTION IF EXISTS public."${name}"()`);
  await pool.query(`DROP SEQUENCE IF EXISTS public."${name}"`);
  const remaining = await pool.query(`
    SELECT 'trigger' AS kind FROM pg_catalog.pg_trigger
      WHERE tgname=$1 AND tgrelid='public.audit_logs'::regclass
    UNION ALL SELECT 'function' FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=$1 AND p.pronargs=0
    UNION ALL SELECT 'sequence' FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=$1 AND c.relkind='S'`, [name]);
  expect(remaining.rows).toEqual([]);
  auditFaults.delete(name);
}

async function installAuditFault(reportType: ReportType, action: "CREATE" | "PROCESS", artifactId?: string, legacy = false) {
  if (auditFaults.size !== 0) throw new Error("Previous export audit fault cleanup is incomplete");
  const name = `c3_report_audit_${randomUUID().replaceAll("-", "")}`;
  const userId = actors.get("member")!.id;
  const typeKey = action === "CREATE" ? "reportType" : "exportType";
  auditFaults.add(name);
  try {
    await pool.query(`
      CREATE SEQUENCE public."${name}";
      CREATE FUNCTION public."${name}"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
      DECLARE job public.data_exports%ROWTYPE;
      BEGIN
        IF NEW.details->>'${typeKey}' IS DISTINCT FROM '${reportType}' THEN RETURN NEW; END IF;
        ${artifactId ? `IF NEW.entity_id IS DISTINCT FROM '${artifactId}'::uuid THEN RETURN NEW; END IF;` : ""}
        SELECT * INTO job FROM public.data_exports WHERE id=NEW.entity_id
          AND user_id='${userId}'::uuid AND household_id='${a}'::uuid AND export_type='${reportType}'
          ${artifactId ? `AND id='${artifactId}'::uuid` : ""};
        IF NOT FOUND THEN RAISE EXCEPTION 'Synthetic export audit ownership precondition failed'; END IF;
        IF job.status IS DISTINCT FROM 'completed' OR job.file_format IS DISTINCT FROM 'csv'
          OR job.record_count IS NULL OR job.record_count<=0
          OR job.file_url IS DISTINCT FROM ('/api/reports/exports/' || job.id::text || '?download=true')
          OR job.date_range_start IS DISTINCT FROM '${first}'::date OR job.date_range_end IS DISTINCT FROM '${last}'::date
          OR NEW.details->>'recordCount' IS DISTINCT FROM job.record_count::text
          OR ${legacy ? "job.parameters IS NOT NULL" : "job.parameters IS NULL OR job.parameters->>'scope' IS DISTINCT FROM 'mine'"}
          OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE id=NEW.id AND entity_id=job.id)
        THEN RAISE EXCEPTION 'Synthetic export completion precondition failed'; END IF;
        -- A sequence advancement survives rollback and witnesses this actual deferred INSERT.
        PERFORM nextval('public."${name}"');
        RAISE EXCEPTION 'Synthetic mandatory export audit failure' USING ERRCODE='23514';
      END; $body$;
      CREATE CONSTRAINT TRIGGER "${name}" AFTER INSERT ON public.audit_logs DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW WHEN (NEW.user_id='${userId}'::uuid AND NEW.action='${action}' AND NEW.entity_type='data_export')
        EXECUTE FUNCTION public."${name}"();
    `);
    return name;
  } catch (error) {
    await dropAuditFault(name);
    throw error;
  }
}

async function auditFaultWitness(name: string) {
  const result = await pool.query<{ is_called: boolean; last_value: string }>(
    `SELECT is_called,last_value::text FROM public."${name}"`);
  return result.rows[0];
}

describe("C3-13 signed non-transaction financial export capability", () => {
  beforeAll(async () => {
    // Reuse the R04 six-role fixture's identities, reset and cleanup contract.
    // Its native setup is repeated here so IDs are tracked before login assertions.
    for (const actor of plannedActors) actors.set(actor.role, { id: actor.id, cookie: "" });
    app = await getTestApp();
    // The test app omits startup's FX wiring. Use the real repository/service;
    // every seeded denomination is native ZMW, so no quote or provider is needed.
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates), {
      cacheTtlSeconds: 300, baseCurrency: "ZMW", fallbackDays: 30,
    }));
    await db.insert(households).values([
      { id: a, name: "Synthetic report export A", currency: "ZMW" },
      { id: b, name: "Synthetic report export B", currency: "ZMW" },
    ]);
    const passwordHash = await hashPassword(password);
    for (const actor of plannedActors) {
      await db.insert(users).values({ id: actor.id, email: actor.email, username: `c3-export-${actor.id}`,
        passwordHash, emailVerified: true, timezone: "Africa/Lusaka" });
      await db.insert(householdMembers).values({ householdId: actor.householdId, userId: actor.id,
        role: actor.role === "outsider" ? "owner" : actor.role });
      await loginActor(actor.role);
    }
  }, 30_000);

  beforeEach(async () => {
    await cleanExports();
    await resetAccountsAndMembership();
    await db.delete(budgets).where(eq(budgets.id, budgetId));
    await db.delete(categories).where(eq(categories.id, categoryId));
    await db.delete(categoryGroups).where(eq(categoryGroups.id, groupId));
    await db.insert(categoryGroups).values({ id: groupId, householdId: a, name: "Synthetic export expenses",
      type: "expenses", budgetMode: "by_category", displayOrder: 0 });
    await db.insert(categories).values({ id: categoryId, householdId: a, groupId,
      name: "Synthetic export groceries", includeInBudget: true, displayOrder: 0 });
    await db.insert(budgets).values({ id: budgetId, householdId: a, categoryId,
      name: "Synthetic export groceries", amount: "100.00", currency: "ZMW" });
    for (const role of populatedRoles) {
      const userId = actors.get(role)!.id, accountId = accountIds.get(role)!;
      await db.insert(accounts).values({ id: accountId, householdId: a, ownerUserId: userId,
        name: `Synthetic ${role} export account`, type: "checking", currency: "ZMW",
        initialBalance: "100.00", balance: "80.00", isPrivate: true });
      await db.insert(transactions).values({ householdId: a, accountId, ownerUserId: userId, categoryId,
        name: "Synthetic own posted groceries", amount: "20.00", currency: "ZMW", type: "expense",
        date: "2026-10-15", isPrivate: true, isPending: false, isExcludedFromReports: false });
    }
  });

  afterAll(async () => {
    try {
      for (const name of [...auditFaults]) await dropAuditFault(name);
      const cleanupIds = new Set<string>(plannedActors.map(actor => actor.id));
      const emails = plannedActors.map(actor => actor.email);
      const persisted = await pool.query<{ id: string }>("SELECT id FROM users WHERE email=ANY($1::text[])", [emails]);
      for (const { id } of persisted.rows) cleanupIds.add(id);
      await cleanExports();
      const actorIds = [...cleanupIds];
      await pool.query(`DELETE FROM outbox_events WHERE household_id=ANY($1::uuid[])
        OR payload->>'userId'=ANY($2::text[]) OR lower(payload->>'recipient')=ANY($3::text[])`, [[a, b], actorIds, emails]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id=ANY($1::uuid[]) OR target_user_id=ANY($1::uuid[])", [actorIds]);
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=ANY($1::text[]) OR sess->>\'mfaPendingUserId\'=ANY($1::text[])', [actorIds]);
      await pool.query("DELETE FROM user_sessions WHERE user_id=ANY($1::uuid[])", [actorIds]);
    } finally {
      // Existing R04 stop deletes owned transactions/audits, the exact two generated
      // households (cascading business rows), actor sessions and users. Reports build
      // CSV in memory and persist only route URLs; this suite creates no disk files.
      await stop();
    }
  });

  for (const reportType of reportTypes) {
    it.each(deniedRoles)(`denies %s ${reportType} creation in their own mine scope without publication effects`, async role => {
      const actorId = actors.get(role)!.id;
      const before = await exportState(actorId);
      const admission = await signed(request(app).get("/api/reports/exports"), role);
      const response = await create(reportType, role);
      const after = await exportState(actorId);
      // Preserve the response and persisted effects before any expected RED assertion.
      console.info(JSON.stringify({ reportExportAuthority: {
        ...observation("denied-create", reportType, role, response), metadataAdmission: admission.status,
        jobsBefore: before.jobs.length, jobsAfter: after.jobs.length,
        publicationAuditsBefore: before.publicationAudits.length, publicationAuditsAfter: after.publicationAudits.length,
      } }));
      expect.soft(admission.status).toBe(403);
      expect.soft(response.status).toBe(403);
      expect.soft(response.body.error?.code).toBe("FORBIDDEN");
      expect.soft(response.headers["content-type"]).not.toContain("text/csv");
      expect.soft(response.headers["content-disposition"]).toBeUndefined();
      expect.soft(after).toEqual(before);
    });

    it(`allows a member's populated mine ${reportType} create, metadata and download`, async () => {
      const id = await memberArtifact(reportType);
      const detail = await metadata(id);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ id, userId: actors.get("member")!.id, parameters: { scope: "mine" } });
      const response = await download(id);
      assertMemberCsv(response, reportType);
    });

    it.each(deniedRoles)(`denies an existing member ${reportType} download after current %s downgrade`, async role => {
      const id = await memberArtifact(reportType);
      const allowed = await download(id);
      assertMemberCsv(allowed, reportType);
      const userId = actors.get("member")!.id;
      await db.update(householdMembers).set({ role }).where(and(
        eq(householdMembers.householdId, a), eq(householdMembers.userId, userId),
      ));
      // The fixture changes the grant directly because the household role-change
      // controller's legacy enum does not accept Professional. Authenticate through
      // native login again so a revoked credential cannot masquerade as this denial.
      await loginActor("member");
      const [grant] = await db.select({ userId: householdMembers.userId,
        householdId: householdMembers.householdId, role: householdMembers.role }).from(householdMembers).where(and(
        eq(householdMembers.householdId, a), eq(householdMembers.userId, userId),
      ));
      const before = await exportState(userId);
      // Keep the same creator, household, private account and mine parameters.
      // The fresh native SID is authenticated; only the export grant changes.
      const identity = await signed(request(app).get("/api/auth/me"));
      const list = await signed(request(app).get("/api/reports/exports"));
      const detail = await metadata(id);
      const response = await download(id);
      const after = await exportState(userId);
      console.info(JSON.stringify({ reportExportAuthority: {
        ...observation("downgraded-download", reportType, role, response),
        currentGrant: grant,
        identityAdmission: identity.status, listAdmission: list.status, metadataAdmission: detail.status,
        jobsBefore: before.jobs.length, jobsAfter: after.jobs.length,
        publicationAuditsBefore: before.publicationAudits.length, publicationAuditsAfter: after.publicationAudits.length,
      } }));
      expect.soft(identity.status).toBe(200);
      expect.soft(identity.body.data?.user?.id).toBe(userId);
      expect.soft(grant).toEqual({ userId, householdId: a, role });
      expect.soft(list.status).toBe(403);
      expect.soft(detail.status).toBe(403);
      expect.soft(response.status).toBe(403);
      expect.soft(response.body.error?.code).toBe("FORBIDDEN");
      expect.soft(response.headers["content-type"]).not.toContain("text/csv");
      expect.soft(response.headers["content-disposition"]).toBeUndefined();
      expect.soft(response.text).not.toContain(headers[reportType]);
      expect.soft(after).toEqual(before);
    });

    it(`preserves a member's valid legacy ${reportType} download without stored parameters`, async () => {
      const id = await memberArtifact(reportType);
      await db.update(dataExports).set({ parameters: null }).where(and(
        eq(dataExports.id, id), eq(dataExports.householdId, a), eq(dataExports.userId, actors.get("member")!.id),
      ));
      const response = await download(id);
      assertMemberCsv(response, reportType, { groupBy: "categoryGroup", label: "Synthetic export expenses" });
      const detail = await metadata(id);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ id, userId: actors.get("member")!.id, parameters: null });
    });

    it.each(deniedRoles)(`denies an existing member legacy-null ${reportType} download after current %s downgrade`, async role => {
      const id = await memberArtifact(reportType), userId = actors.get("member")!.id;
      await db.update(dataExports).set({ parameters: null }).where(and(
        eq(dataExports.id, id), eq(dataExports.householdId, a), eq(dataExports.userId, userId),
      ));
      const legacyDetail = await metadata(id);
      expect(legacyDetail.status).toBe(200);
      expect(legacyDetail.body.data).toMatchObject({ id, userId, householdId: a, status: "completed", parameters: null });
      const allowed = await download(id);
      assertMemberCsv(allowed, reportType, { groupBy: "categoryGroup", label: "Synthetic export expenses" });

      await db.update(householdMembers).set({ role }).where(and(
        eq(householdMembers.householdId, a), eq(householdMembers.userId, userId),
      ));
      // Reauthenticate the actual creator after the controlled fixture downgrade.
      // Keep the same legacy artifact, household, owner and visible ZMW accounts.
      await loginActor("member");
      const [grant] = await db.select({ userId: householdMembers.userId,
        householdId: householdMembers.householdId, role: householdMembers.role }).from(householdMembers).where(and(
        eq(householdMembers.householdId, a), eq(householdMembers.userId, userId),
      ));
      const before = await exportState(userId);
      const identity = await signed(request(app).get("/api/auth/me"));
      const list = await signed(request(app).get("/api/reports/exports"));
      const detail = await metadata(id);
      const response = await download(id);
      const after = await exportState(userId);
      // Persist the reached response and publication effects before denial checks.
      console.info(JSON.stringify({ reportExportAuthority: {
        ...observation("downgraded-legacy-null-download", reportType, role, response),
        artifactId: id, artifactParameters: before.jobs.find(job => job.id === id)?.parameters,
        currentGrant: grant,
        identityAdmission: identity.status, listAdmission: list.status, metadataAdmission: detail.status,
        jobsBefore: before.jobs.length, jobsAfter: after.jobs.length,
        publicationAuditsBefore: before.publicationAudits.length, publicationAuditsAfter: after.publicationAudits.length,
      } }));
      expect.soft(identity.status).toBe(200);
      expect.soft(identity.body.data?.user?.id).toBe(userId);
      expect.soft(grant).toEqual({ userId, householdId: a, role });
      expect.soft(list.status).toBe(403);
      expect.soft(detail.status).toBe(403);
      expect.soft(response.status).toBe(403);
      expect.soft(response.body.error?.code).toBe("FORBIDDEN");
      expect.soft(response.headers["content-type"]).not.toContain("text/csv");
      expect.soft(response.headers["content-disposition"]).toBeUndefined();
      expect.soft(response.text).not.toContain(headers[reportType]);
      expect.soft(after).toEqual(before);
    });

    it.each(["CREATE", "PROCESS", "legacy-null PROCESS"] as const)(
      `withholds ${reportType} publication when its %s audit cannot commit`, async mode => {
        const userId = actors.get("member")!.id;
        const action = mode === "CREATE" ? "CREATE" : "PROCESS";
        const legacy = mode === "legacy-null PROCESS";
        const artifactId = action === "PROCESS" ? await memberArtifact(reportType) : undefined;
        if (artifactId) {
          if (legacy) await db.update(dataExports).set({ parameters: null }).where(and(
            eq(dataExports.id, artifactId), eq(dataExports.householdId, a), eq(dataExports.userId, userId),
          ));
          const allowed = await download(artifactId);
          assertMemberCsv(allowed, reportType, legacy
            ? { groupBy: "categoryGroup", label: "Synthetic export expenses" }
            : { groupBy: "category", label: "Synthetic export groceries" });
        }
        const before = await exportState(userId);
        const fault = await installAuditFault(reportType, action, artifactId, legacy);
        try {
          const response = action === "CREATE" ? await create(reportType) : await download(artifactId!);
          const after = await exportState(userId);
          const witness = await auditFaultWitness(fault);
          console.info(JSON.stringify({ reportExportAuthority: {
            ...observation(`audit-fault-${mode}`, reportType, "member", response),
            artifactId, fault, witness, jobsBefore: before.jobs.length,
            jobsAfter: after.jobs.map(job => ({ id: job.id, status: job.status, fileUrl: job.file_url, recordCount: job.record_count })),
            publicationAuditsBefore: before.publicationAudits.length, publicationAuditsAfter: after.publicationAudits.length,
          } }));
          expect.soft(witness).toEqual({ is_called: true, last_value: "1" });
          expect.soft(response.status).toBe(500);
          expect.soft(response.body).toHaveProperty("error");
          expect.soft(response.headers["content-type"]).not.toContain("text/csv");
          expect.soft(response.headers["content-disposition"]).toBeUndefined();
          expect.soft(response.text).not.toContain(headers[reportType]);
          expect.soft(response.text).not.toContain("Synthetic export groceries");
          expect.soft(response.text).not.toContain("Synthetic export expenses");
          if (action === "CREATE") {
            for (const job of after.jobs) {
              expect.soft(job.status).not.toBe("completed");
              expect.soft(job.file_url).toBeNull();
              expect.soft(job.record_count).toBeNull();
            }
            expect.soft({ ...after, jobs: before.jobs }).toEqual(before);
          } else expect.soft(after).toEqual(before);
        } finally {
          await dropAuditFault(fault);
        }
        const beforeRecovery = await exportState(userId);
        const recoveryId = action === "CREATE" ? await memberArtifact(reportType) : artifactId!;
        if (action === "PROCESS") {
          const recovered = await download(recoveryId);
          assertMemberCsv(recovered, reportType, legacy
            ? { groupBy: "categoryGroup", label: "Synthetic export expenses" }
            : { groupBy: "category", label: "Synthetic export groceries" });
        }
        const afterRecovery = await exportState(userId);
        const added = afterRecovery.publicationAudits.filter(audit => !beforeRecovery.publicationAudits.some(old => old.id === audit.id));
        expect(added).toEqual([expect.objectContaining({ user_id: userId, action,
          entity_type: "data_export", entity_id: recoveryId })]);
        if (action === "PROCESS") expect({ ...afterRecovery, publicationAudits: beforeRecovery.publicationAudits }).toEqual(beforeRecovery);
      },
    );
  }

  // Non-transaction reports build between two authority cuts. The second cut
  // must re-check the current grant before any publication effect.
  it.each(["create", "download"] as const)("refuses a budget %s when the grant is downgraded while the report is built", async step => {
    const userId = actors.get("member")!.id;
    const artifactId = step === "download" ? await memberArtifact("budget") : undefined;
    const before = await exportState(userId);
    const actual = Client.prototype.query;
    let downgraded = false;
    const spy = vi.spyOn(Client.prototype, "query").mockImplementation(function(this: Client, ...args: unknown[]) {
      const command = args[0];
      const text = typeof command === "string" ? command
        : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      if (!downgraded && /^\s*select\b/i.test(text) && /from\s+"budgets"/i.test(text)) {
        downgraded = true;
        return (async () => {
          await pool.query("UPDATE household_members SET role='view_only' WHERE household_id=$1 AND user_id=$2", [a, userId]);
          return Reflect.apply(actual, this, args);
        })();
      }
      return Reflect.apply(actual, this, args);
    } as typeof Client.prototype.query);
    let response: request.Response;
    try {
      response = step === "create" ? await create("budget") : await download(artifactId!);
    } finally {
      spy.mockRestore();
    }
    const after = await exportState(userId);
    console.info(JSON.stringify({ reportExportAuthority: { ...observation(`mid-build-downgrade-${step}`, "budget", "member", response),
      downgraded, jobsAfter: after.jobs.map(job => ({ id: job.id, status: job.status })) } }));
    expect(downgraded).toBe(true);
    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("FORBIDDEN");
    expect(response.headers["content-disposition"]).toBeUndefined();
    expect(response.text).not.toContain(headers.budget);
    expect(after.publicationAudits).toEqual(before.publicationAudits);
    if (step === "download") {
      expect(after.jobs).toEqual(before.jobs);
    } else {
      const added = after.jobs.filter(job => !before.jobs.some(old => old.id === job.id));
      expect(added).toEqual([expect.objectContaining({ status: "failed", file_url: null, record_count: null })]);
    }
  });
});
