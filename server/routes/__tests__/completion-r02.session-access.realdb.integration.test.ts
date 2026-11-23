import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../../db";
import { getTestApp } from "../../__tests__/fixtures";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { userRepository } from "../../repositories/UserRepository";
import { sessionStore } from "../../config/session-store";
import { marketDataService } from "../../services/MarketDataService";
import { importService } from "../../services/ImportService";
import { businessAuditService } from "../../services/BusinessAuditService";

const deliveries = vi.hoisted(() => [] as { to: string; html: string; text?: string }[]);
const signedResends = vi.hoisted(() => [] as { email: string; token: string; isEmailChange: boolean }[]);
vi.mock("../../services/emailService", async (original) => ({
  ...await original<typeof import("../../services/emailService")>(),
  sendEmail: vi.fn(async (message: { to: string; html: string; text?: string }) => { deliveries.push(message); return true; }),
  // The same-module helper closes over its local sendEmail. Mock its transport
  // boundary explicitly; registration still captures the real emitted template.
  sendVerificationEmail: vi.fn(async (email: string, token: string, isEmailChange = false) => { signedResends.push({ email, token, isEmailChange }); return true; }),
}));
const password = "SyntheticR02Gate123!";
const ids: string[] = [];
const householdId = randomUUID(), resourceId = randomUUID();
const extraHouseholds: string[] = [];
const originalOrigin = process.env.APP_URL;
let app: Awaited<ReturnType<typeof getTestApp>>;
type Actor = { id: string; email: string; cookie: string; token: string };
let pending: Actor, withoutHousehold: Actor, ready: Actor, mfa: Actor;
const cookieFrom = (response: request.Response) => (response.headers["set-cookie"] as unknown as string[]).join("; ");
const sidFrom = (cookie: string) => decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("=")).slice(2).split(".")[0];
async function register(verify = false): Promise<Actor> {
  const unique = randomUUID(), email = `r02-gate-${unique}@example.invalid`;
  const response = await request(app).post("/api/auth/register").send({ username: `r02-${unique}`, email, password }).expect(201);
  const id = response.body.data.user.id as string;
  ids.push(id);
  const href = deliveries.filter((item) => item.to === email).at(-1)?.html.match(/href="([^"]+)"/)?.[1];
  const token = new URL(href!).searchParams.get("token")!;
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  if (verify) await request(app).post("/api/settings/security/email/verify").send({ token }).expect(200);
  return { id, email, cookie: cookieFrom(response), token };
}
async function readStatus(cookie?: string) {
  const probe = request(app).get("/api/auth/session");
  const response = await (cookie ? probe.set("Cookie", cookie) : probe);
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(response.headers.vary?.split(/,\s*/)).toContain("Cookie");
  return response;
}
async function persistedSnapshot() {
  const tables = ["users", "households", "household_members", "household_preferences", "household_invitations", "user_preferences", "user_ai_preferences", "accounts", "transactions", "budgets", "goals", "categories", "merchants", "tags", "rules", "filter_presets", "recurring_transactions", "notifications", "pending_receipts"];
  const digests: Record<string, string> = {};
  for (const table of tables) {
    // Only fixed test-owned identifiers are interpolated; digest avoids logging credentials on mismatch.
    digests[table] = (await pool.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS digest FROM ${table} t`)).rows[0].digest;
  }
  return digests;
}
async function filesSnapshot() {
  const root = path.resolve(process.cwd(), "uploads");
  try {
    const names = await readdir(root, { recursive: true, withFileTypes: true });
    return await Promise.all(names.filter((entry) => entry.isFile()).sort((a, b) => path.join(a.parentPath, a.name).localeCompare(path.join(b.parentPath, b.name))).map(async (entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(root, file), createHash("sha256").update(await readFile(file)).digest("hex")];
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
const denied: ["get" | "post" | "put" | "patch" | "delete", string, Record<string, unknown>?][] = [
  ["get", "/api/accounts"], ["post", "/api/accounts", { name: "Denied", type: "cash", currency: "ZMW", balance: "0" }],
  ["get", "/api/transactions"], ["get", "/api/budgets"], ["get", "/api/goals"], ["get", "/api/categories"],
  ["get", "/api/merchants"], ["get", "/api/tags"], ["get", "/api/rules"], ["get", "/api/reports/cashflow"],
  ["get", "/api/recurring"], ["get", "/api/investments/holdings"], ["get", "/api/filter-presets"],
  ["get", "/api/investments/analytics/fx-historical?from=ZMW&to=USD&date=2026-10-15"],
  ["post", "/api/household", { name: "Denied household", currency: "ZMW" }],
  ["post", "/api/household/invite/accept", { token: "synthetic-invitation" }],
  ["post", "/api/household/invite", { email: "r02-denied@example.invalid", role: "member" }],
  ["get", "/api/settings/profile"], ["put", "/api/settings/profile", { displayName: "Denied" }],
  ["get", "/api/settings/display"], ["put", "/api/settings/display", { theme: "dark" }],
  ["get", "/api/settings/security"], ["put", "/api/settings/security/password", { currentPassword: password, newPassword: "AnotherSynthetic123!" }],
  ["post", "/api/settings/security/email/change", { newEmail: "r02-denied@example.invalid", password }],
  ["post", "/api/settings/security/email/cancel"], ["get", "/api/settings/security/sessions"],
  ["post", "/api/settings/security/mfa/enable"],
  ["get", "/api/notifications"], ["post", "/api/notifications/push/subscribe", { endpoint: "https://push.example.invalid", keys: { p256dh: "synthetic", auth: "synthetic" } }],
  ["post", "/api/weekly-recap/generate"], ["patch", "/api/weekly-recap/settings", { enabled: true }],
  ["post", "/api/ai/chat", { message: "Synthetic denied request" }], ["post", "/api/investments/market/refresh"],
  ["get", "/api/investments/notifications/preferences"], ["get", "/api/investments/tax/summary"],
  ["get", "/api/investments/pension"], ["get", "/api/investments/recurring"],
  ["post", "/api/investments/grz/calculate/bond-price", { faceValue: 1000, couponRate: 10, requiredYield: 12, yearsToMaturity: 2 }],
  ["get", "/api/investments/grz/auctions/calendar"], ["get", "/api/grz/bonds"],
  ["post", `/api/accounts/${resourceId}/balance-history/import`, { rows: [] }],
  ["post", `/api/accounts/${resourceId}/transactions/import`, { transactions: [] }],
  ["post", "/api/import/execute", { transactions: [] }],
  ["get", `/api/transactions/${resourceId}/attachments`],
  ["get", `/api/transactions/${resourceId}/attachments/${resourceId}/download`],
  ["get", `/uploads/goals/${householdId}/synthetic.png`], ["get", `/api/receipts/${resourceId}/thumbnail`],
];

describe("R02 mounted session access (actual registration, mocked mail, disposable PostgreSQL)", () => {
  beforeAll(async () => {
    process.env.APP_URL = "https://capital.example.invalid";
    app = await getTestApp();
    pending = await register(); withoutHousehold = await register(true); ready = await register(true); mfa = await register(true);
    await pool.query("INSERT INTO households (id,name) VALUES ($1,'Synthetic R02 access')", [householdId]);
    await pool.query("INSERT INTO household_members (household_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')", [householdId, ready.id, pending.id]);
    await pool.query("UPDATE users SET mfa_enabled=true,mfa_method='email' WHERE id=$1", [mfa.id]);
    const login = await request(app).post("/api/auth/login").send({ email: mfa.email, password }).expect(200);
    expect(login.body.data.requiresMfa).toBe(true); mfa.cookie = cookieFrom(login);
  }, 30000);
  afterAll(async () => {
    vi.restoreAllMocks();
    for (const id of extraHouseholds) await pool.query("DELETE FROM households WHERE id=$1", [id]);
    await pool.query("DELETE FROM households WHERE id=$1", [householdId]);
    for (const id of ids) {
      await pool.query("DELETE FROM outbox_events WHERE payload->>'userId'=$1", [id]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id=$1", [id]);
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1 OR sess->>\'mfaPendingUserId\'=$1', [id]);
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
    }
    if (originalOrigin === undefined) delete process.env.APP_URL; else process.env.APP_URL = originalOrigin;
  });
  it("anonymous read-only bootstrap returns exact expected state without setting a session", async () => {
    const before = await persistedSnapshot();
    const response = await readStatus();
    expect(response.status).toBe(200); expect(response.body).toEqual({ success: true, data: { state: "anonymous" } });
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(await persistedSnapshot()).toEqual(before);
  });
  it("returns exact minimal DTOs for pending, household-free, ready and MFA states without mutation", async () => {
    const before = await persistedSnapshot();
    const lookup = vi.spyOn(householdRepository, "findByUserId");
    const member = vi.spyOn(householdRepository, "findMember");
    // AH-11: these members have no MFA yet and are inside the 14-day grace.
    const grace = { state: "grace", graceEndsAt: expect.any(String), daysRemaining: 14 };
    try {
      expect((await readStatus(pending.cookie)).body).toEqual({ success: true, data: { state: "verification_pending", subject: { id: pending.id, email: pending.email, displayName: null } } });
      expect((await readStatus(mfa.cookie)).body).toEqual({ success: true, data: { state: "mfa_pending" } });
      expect(lookup).not.toHaveBeenCalled(); expect(member).not.toHaveBeenCalled();
      expect((await readStatus(withoutHousehold.cookie)).body).toEqual({ success: true, data: { state: "verified_without_household", subject: { id: withoutHousehold.id, email: withoutHousehold.email, displayName: null }, mfa: grace } });
      expect((await readStatus(ready.cookie)).body).toEqual({ success: true, data: { state: "ready", subject: { id: ready.id, email: ready.email, displayName: null }, household: { id: householdId, role: "owner" }, mfa: grace } });
    } finally { lookup.mockRestore(); member.mockRestore(); }
    expect(await persistedSnapshot()).toEqual(before);
    expect((await pool.query('SELECT sess->>\'userId\' AS identity FROM "session" WHERE sid=$1', [sidFrom(mfa.cookie)])).rows[0].identity).toBeNull();
  });
  it("pending users retain the compatible own-identity DTO, resend and revoking logout", async () => {
    const actor = await register();
    const me = await request(app).get("/api/auth/me").set("Cookie", actor.cookie).expect(200);
    expect(me.body.data.user).toMatchObject({ id: actor.id, emailVerified: false });
    expect(me.body.data.user.passwordHash).toBeUndefined(); expect(me.body.data.user.emailVerificationToken).toBeUndefined();
    const count = signedResends.length;
    const throttled = await request(app).post("/api/settings/security/email/resend").set("Cookie", actor.cookie).expect(429);
    expect(throttled.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(signedResends).toHaveLength(count);
    const originalHash = createHash("sha256").update(actor.token).digest("hex");
    // Age this user's still-valid registration challenge past the resend cooldown.
    const aged = await pool.query("UPDATE users SET email_verification_expiry=email_verification_expiry-interval '2 minutes' WHERE id=$1 AND email_verification_token=$2", [actor.id, originalHash]);
    expect(aged.rowCount).toBe(1);
    const response = await request(app).post("/api/settings/security/email/resend").set("Cookie", actor.cookie).expect(200);
    expect(response.body.data.delivery).toBe("accepted");
    expect(signedResends).toHaveLength(count + 1);
    const resend = signedResends.at(-1)!;
    expect(resend).toMatchObject({ email: actor.email, isEmailChange: false });
    expect(resend.token).not.toBe(actor.token);
    expect((await pool.query("SELECT email_verification_token FROM users WHERE id=$1", [actor.id])).rows[0].email_verification_token)
      .toBe(createHash("sha256").update(resend.token).digest("hex"));
    await request(app).post("/api/auth/logout").set("Cookie", actor.cookie).expect(200);
    expect((await readStatus(actor.cookie)).body.data).toEqual({ state: "anonymous" });
    await request(app).post("/api/settings/security/email/verify").send({ token: actor.token }).expect(400);
    await request(app).post("/api/settings/security/email/verify").send({ token: resend.token }).expect(200);
  });
  it("denies every finance, personal, file and external-effect entry before membership or persisted/file/provider effects", async () => {
    const before = await persistedSnapshot(), files = await filesSnapshot(), mailCount = deliveries.length, resendCount = signedResends.length;
    const lookup = vi.spyOn(householdRepository, "findByUserId"), member = vi.spyOn(householdRepository, "findMember");
    const fx = vi.spyOn(marketDataService, "updateFXRates"), prices = vi.spyOn(marketDataService, "updateSecurityPrices");
    try {
      for (const [method, url, body] of denied) {
        const probe = request(app)[method](url).set("Cookie", pending.cookie);
        const response = await (body ? probe.send(body) : probe);
        expect({ method, url, status: response.status, code: response.body.error?.code }).toEqual({ method, url, status: 403, code: "EMAIL_VERIFICATION_REQUIRED" });
      }
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
      for (const [url, field] of [["/api/goals/images", "file"], [`/api/transactions/${resourceId}/attachments`, "file"], ["/api/receipts/upload", "file"], ["/api/settings/profile/picture", "picture"], ["/api/settings/profile/banner", "banner"], ["/api/import/parse", "file"]]) {
        const response = await request(app).post(url).set("Cookie", pending.cookie).attach(field, png, { filename: "synthetic.png", contentType: "image/png" });
        expect({ url, status: response.status, code: response.body.error?.code }).toEqual({ url, status: 403, code: "EMAIL_VERIFICATION_REQUIRED" });
      }
      expect(lookup).not.toHaveBeenCalled(); expect(member).not.toHaveBeenCalled();
      expect(fx).not.toHaveBeenCalled(); expect(prices).not.toHaveBeenCalled();
    } finally { lookup.mockRestore(); member.mockRestore(); fx.mockRestore(); prices.mockRestore(); }
    expect(await persistedSnapshot()).toEqual(before); expect(await filesSnapshot()).toEqual(files); expect(deliveries.length).toBe(mailCount); expect(signedResends).toHaveLength(resendCount);
  });
  it("keeps unknown /api/v1 paths from becoming a finance bypass", async () => {
    const response = await request(app).get("/api/v1/accounts").set("Cookie", pending.cookie);
    expect(response.status).toBe(404);
  });
  it("verified household-free identity retains personal settings and household creation entry", async () => {
    await request(app).get("/api/settings/profile").set("Cookie", withoutHousehold.cookie).expect(200);
    await request(app).get("/api/settings/security").set("Cookie", withoutHousehold.cookie).expect(200);
    await request(app).post("/api/household").set("Cookie", withoutHousehold.cookie).send({}).expect(400);
    await request(app).get("/api/accounts").set("Cookie", withoutHousehold.cookie).expect(404);
  });
  it("rejects A-origin reads and creates under B's valid cookie before persistence or resend effects", async () => {
    const actorB = await register(true), householdB = randomUUID();
    extraHouseholds.push(householdB);
    await pool.query("INSERT INTO households (id,name) VALUES ($1,'R02 replacement B')", [householdB]);
    await pool.query("INSERT INTO household_members (household_id,user_id,role) VALUES ($1,$2,'owner')", [householdB, actorB.id]);
    const before = await persistedSnapshot(), mailCount = signedResends.length;
    const lookup = vi.spyOn(householdRepository, "findByUserId"), member = vi.spyOn(householdRepository, "findMember");
    try {
      for (const method of ["get", "post"] as const) {
        const probe = request(app)[method]("/api/accounts").set("Cookie", actorB.cookie)
          .set("X-Capital-Subject", ready.id).set("X-Capital-Household", householdId);
        const response = await (method === "post" ? probe.send({ name: "Must not create under B", type: "cash", currency: "ZMW", balance: "0" }) : probe);
        expect(response.status).toBe(409); expect(response.body.error.code).toBe("SESSION_CONTEXT_CHANGED");
        expect(JSON.stringify(response.body)).not.toContain(ready.id);
        expect(JSON.stringify(response.body)).not.toContain(actorB.id);
      }
      const resend = await request(app).post("/api/settings/security/email/resend").set("Cookie", pending.cookie).set("X-Capital-Subject", ready.id);
      expect(resend.status).toBe(409); expect(resend.body.error.code).toBe("SESSION_CONTEXT_CHANGED");
      expect(lookup).not.toHaveBeenCalled(); expect(member).not.toHaveBeenCalled();
    } finally { lookup.mockRestore(); member.mockRestore(); }
    expect(await persistedSnapshot()).toEqual(before); expect(signedResends).toHaveLength(mailCount);
    await request(app).get("/api/accounts").set("Cookie", actorB.cookie).set("X-Capital-Subject", actorB.id).set("X-Capital-Household", householdB).expect(200);
    await request(app).get("/api/accounts").set("Cookie", actorB.cookie).expect(200);
  });
  it("rejects malformed or duplicate context expectations without echoing header values", async () => {
    const before = await persistedSnapshot();
    for (const headers of [
      { "X-Capital-Subject": "malformed-subject-sentinel" },
      { "X-Capital-Household": "malformed-household-sentinel" },
      { "X-Capital-Subject": [ready.id, ready.id] },
      { "X-Capital-Household": [householdId, householdId] },
    ]) {
      const response = await request(app).get("/api/accounts").set("Cookie", ready.cookie).set(headers);
      expect(response.status).toBe(400); expect(response.body.error.code).toBe("BAD_REQUEST");
      expect(JSON.stringify(response.body)).not.toContain("sentinel");
    }
    expect(await persistedSnapshot()).toEqual(before);
  });
  it("bootstrap and implicit protected reads select the same lowest membership ID from two unchanged memberships", async () => {
    const actor = await register(true), first = randomUUID(), second = randomUUID();
    extraHouseholds.push(first, second);
    await pool.query("INSERT INTO households (id,name) VALUES ($1,'R02 first inserted'),($2,'R02 lower membership ID')", [first, second]);
    // Insert the larger ID first so natural insertion order is not the contract.
    await pool.query("INSERT INTO household_members (id,household_id,user_id,role) VALUES ('ffffffff-ffff-4fff-bfff-ffffffffffff',$1,$3,'owner'),('00000000-0000-4000-8000-000000000000',$2,$3,'professional')", [first, second, actor.id]);
    await pool.query("INSERT INTO accounts (household_id,name,type) VALUES ($1,'R02 unselected account','cash'),($2,'R02 selected account','cash')", [first, second]);
    const before = await persistedSnapshot();
    for (let attempt = 0; attempt < 3; attempt++) {
      const status = await readStatus(actor.cookie);
      expect(status.body.data.household).toEqual({ id: second, role: "professional" });
      const accounts = await request(app).get("/api/accounts").set("Cookie", actor.cookie).expect(200);
      expect(accounts.body.data.map((account: { name: string }) => account.name)).toEqual(["R02 selected account"]);
    }
    expect(await persistedSnapshot()).toEqual(before);
  });
  it("rejects the old household expectation when H1 membership is removed and H2 remains for the same subject", async () => {
    const actor = await register(true), h1 = randomUUID(), h2 = randomUUID();
    extraHouseholds.push(h1, h2);
    await pool.query("INSERT INTO households (id,name) VALUES ($1,'R02 departing H1'),($2,'R02 remaining H2')", [h1, h2]);
    await pool.query("INSERT INTO household_members (id,household_id,user_id,role) VALUES ('00000000-0000-4000-8000-000000000010',$1,$3,'owner'),('ffffffff-ffff-4fff-bfff-fffffffffff0',$2,$3,'owner')", [h1, h2, actor.id]);
    expect((await readStatus(actor.cookie)).body.data.household.id).toBe(h1);
    await pool.query("DELETE FROM household_members WHERE household_id=$1 AND user_id=$2", [h1, actor.id]);
    const before = await persistedSnapshot();
    for (const [method, url] of [["get", "/api/accounts"], ["post", "/api/accounts"], ["get", "/api/household/general"]] as const) {
      const probe = request(app)[method](url).set("Cookie", actor.cookie).set("X-Capital-Subject", actor.id).set("X-Capital-Household", h1);
      const response = await (method === "post" ? probe.send({ name: "Must not create under H2", type: "cash", currency: "ZMW", balance: "0" }) : probe);
      expect(response.status).toBe(409); expect(response.body.error.code).toBe("SESSION_CONTEXT_CHANGED");
    }
    expect(await persistedSnapshot()).toEqual(before);
    await request(app).get("/api/accounts").set("Cookie", actor.cookie).set("X-Capital-Subject", actor.id).set("X-Capital-Household", h2).expect(200);
    await request(app).get("/api/household/general").set("Cookie", actor.cookie).set("X-Capital-Subject", actor.id).set("X-Capital-Household", h2).expect(200);
    expect((await readStatus(actor.cookie)).body.data.household.id).toBe(h2);
  });
  it("returns structural verification-required only after valid credentials and preserves lockout/invalid-password codes", async () => {
    const actor = await register();
    const valid = await request(app).post("/api/auth/login").send({ email: actor.email, password }).expect(403);
    expect(valid.body.error.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    const invalid = await request(app).post("/api/auth/login").send({ email: actor.email, password: "WrongSynthetic123!" }).expect(401);
    expect(invalid.body.error.code).toBe("INVALID_CREDENTIALS");
    await pool.query("UPDATE users SET locked_until=now()+interval '1 minute' WHERE id=$1", [actor.id]);
    const locked = await request(app).post("/api/auth/login").send({ email: actor.email, password }).expect(403);
    expect(locked.body.error.code).toBe("FORBIDDEN");
  });
  it("reuses the guard's household for interleaved household/general reads and writes instead of selecting H2", async () => {
    const actor = await register(true), h1 = randomUUID(), h2 = randomUUID();
    extraHouseholds.push(h1, h2);
    await pool.query("INSERT INTO households (id,name) VALUES ($1,'R02 request H1'),($2,'R02 replacement H2')", [h1, h2]);
    await pool.query("INSERT INTO household_members (household_id,user_id,role) VALUES ($1,$3,'owner'),($2,$3,'owner')", [h1, h2, actor.id]);
    const original = householdRepository.findByUserId.bind(householdRepository);
    for (const method of ["get", "put"] as const) {
      let selections = 0;
      const lookup = vi.spyOn(householdRepository, "findByUserId").mockImplementation(async (userId) => {
        if (userId !== actor.id) return original(userId);
        return householdRepository.findById(++selections === 1 ? h1 : h2);
      });
      try {
        const probe = request(app)[method]("/api/household/general").set("Cookie", actor.cookie)
          .set("X-Capital-Subject", actor.id).set("X-Capital-Household", h1);
        const response = await (method === "put" ? probe.send({ name: "R02 request H1 updated" }) : probe).expect(200);
        expect(response.body.data.household.id).toBe(h1);
        expect(selections).toBe(1);
      } finally { lookup.mockRestore(); }
    }
    expect((await pool.query("SELECT name FROM households WHERE id=$1", [h1])).rows[0].name).toBe("R02 request H1 updated");
    expect((await pool.query("SELECT name FROM households WHERE id=$1", [h2])).rows[0].name).toBe("R02 replacement H2");
  });
  it("does not let an import's explicit body target escape the checked household expectation", async () => {
    const actor = await register(true), h1 = randomUUID(), h2 = randomUUID();
    extraHouseholds.push(h1, h2);
    await pool.query("INSERT INTO households (id,name) VALUES ($1,'R02 import H1'),($2,'R02 import H2')", [h1, h2]);
    await pool.query("INSERT INTO household_members (id,household_id,user_id,role) VALUES ('00000000-0000-4000-8000-000000000020',$1,$3,'owner'),('ffffffff-ffff-4fff-bfff-ffffffffffe0',$2,$3,'owner')", [h1, h2, actor.id]);
    // Execute now needs a target account (IMP-01 review r4 P1); the household check still runs first.
    const target = (await pool.query("INSERT INTO accounts (household_id,name,type) VALUES ($1,'R02 import H2 account','cash') RETURNING id", [h2])).rows[0].id;
    const before = await persistedSnapshot();
    const body = { householdId: h2, targetAccountId: target, strategy: "prioritize_csv", mapping: { date: "date", amount: "amount" }, rows: [{ date: "2026-10-28", amount: "1.00" }] };
    const execute = vi.spyOn(importService, "executeImport").mockResolvedValue({ imported: 0, skipped: 0, errors: [] } as never);
    try {
      const response = await request(app).post("/api/import/execute").set("Cookie", actor.cookie)
        .set("X-Capital-Subject", actor.id).set("X-Capital-Household", h1).send(body);
      expect(response.status).toBe(409); expect(response.body.error.code).toBe("SESSION_CONTEXT_CHANGED");
      expect(execute).not.toHaveBeenCalled();
      await request(app).post("/api/import/execute").set("Cookie", actor.cookie).send(body).expect(200);
      expect(execute).toHaveBeenCalledWith(body.rows, expect.objectContaining({ userId: actor.id, householdId: h2 }));
    } finally { execute.mockRestore(); }
    expect(await persistedSnapshot()).toEqual(before);
  });
  it("keeps preference audit attribution on the request's household when a later selection would return H2", async () => {
    const actor = await register(true), h1 = randomUUID(), h2 = randomUUID();
    extraHouseholds.push(h1, h2);
    await pool.query("INSERT INTO households (id,name) VALUES ($1,'R02 audit H1'),($2,'R02 audit H2')", [h1, h2]);
    await pool.query("INSERT INTO household_members (household_id,user_id,role) VALUES ($1,$3,'owner'),($2,$3,'owner')", [h1, h2, actor.id]);
    let selections = 0;
    const original = householdRepository.findByUserId.bind(householdRepository);
    const lookup = vi.spyOn(householdRepository, "findByUserId").mockImplementation(async (userId) => userId === actor.id ? householdRepository.findById(++selections === 1 ? h1 : h2) : original(userId));
    const audit = vi.spyOn(businessAuditService, "logCreate");
    try {
      await request(app).put("/api/investments/notifications/preferences").set("Cookie", actor.cookie)
        .set("X-Capital-Subject", actor.id).set("X-Capital-Household", h1)
        .send({ notificationType: "maturity_reminder", inAppEnabled: true, emailEnabled: false, pushEnabled: false }).expect(200);
      expect(selections).toBe(1);
      expect(audit).toHaveBeenCalledWith(expect.objectContaining({ householdId: h1, userId: actor.id }));
    } finally { lookup.mockRestore(); audit.mockRestore(); }
  });
  it.each([undefined, { role: "unknown" }])("rejects inconsistent membership and unknown roles without claiming onboarding", async (membership) => {
    const member = vi.spyOn(householdRepository, "findMember").mockResolvedValue(membership as never);
    try { expect((await readStatus(ready.cookie)).status).toBe(403); } finally { member.mockRestore(); }
  });
  it("preserves user, membership and session-store lookup failures as safe server errors", async () => {
    for (const [target, method] of [[userRepository, "findById"], [householdRepository, "findByUserId"]] as const) {
      const lookup = vi.spyOn(target as typeof userRepository, method as "findById").mockRejectedValue(new Error("synthetic secret must not be exposed"));
      try { const response = await readStatus(ready.cookie); expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toContain("synthetic secret"); }
      finally { lookup.mockRestore(); }
    }
    const get = vi.spyOn(sessionStore, "get").mockImplementation((_sid, callback) => callback(new Error("synthetic session-store unavailable")));
    try { const response = await request(app).get("/api/auth/session").set("Cookie", ready.cookie); expect(response.status).toBe(500); }
    finally { get.mockRestore(); }
  });
  it("fails closed for ambiguous persisted identities and does not promote MFA-only sessions", async () => {
    const actor = await register(true), sid = sidFrom(actor.cookie);
    await pool.query('UPDATE "session" SET sess=sess || jsonb_build_object(\'mfaPendingUserId\',$2::text,\'mfaPendingSecurityGeneration\',0) WHERE sid=$1', [sid, actor.id]);
    expect((await readStatus(actor.cookie)).status).toBe(401);
    await request(app).get("/api/auth/me").set("Cookie", mfa.cookie).expect(401);
    await request(app).get("/api/accounts").set("Cookie", mfa.cookie).expect(401);
  });
  it.each(["stale", "erased", "deleted"])("returns anonymous for a %s persisted session", async (state) => {
    const actor = await register(true);
    if (state === "stale") await pool.query("UPDATE users SET security_generation=security_generation+1 WHERE id=$1", [actor.id]);
    if (state === "erased") await pool.query("UPDATE users SET erased_at=now() WHERE id=$1", [actor.id]);
    if (state === "deleted") {
      await pool.query("DELETE FROM outbox_events WHERE payload->>'userId'=$1", [actor.id]);
      await pool.query("DELETE FROM security_audit_logs WHERE user_id=$1", [actor.id]);
      await pool.query("DELETE FROM users WHERE id=$1", [actor.id]);
    }
    expect((await readStatus(actor.cookie)).body).toEqual({ success: true, data: { state: "anonymous" } });
  });
  it("does not cancel B's MFA challenge using A's authenticated logout expectations", async () => {
    for (const headers of [{ "X-Capital-Subject": ready.id }, { "X-Capital-Household": householdId }]) {
      const response = await request(app).post("/api/auth/logout").set("Cookie", mfa.cookie).set(headers);
      expect(response.status).toBe(409); expect(response.body.error.code).toBe("SESSION_CONTEXT_CHANGED");
      expect((await readStatus(mfa.cookie)).body.data).toEqual({ state: "mfa_pending" });
    }
    await request(app).post("/api/auth/logout").set("Cookie", mfa.cookie).expect(200);
    expect((await readStatus(mfa.cookie)).body.data).toEqual({ state: "anonymous" });
  });
});
