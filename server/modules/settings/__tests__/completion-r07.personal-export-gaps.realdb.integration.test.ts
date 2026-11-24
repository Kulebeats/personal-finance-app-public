/**
 * A-27 follow-up: the personal-data export gaps left after version 2.
 *
 * - An export too large to build in memory answers 413, never a 500.
 * - AI conversations and their messages, recap feedback, saved views and
 *   investment activity are exported, each under the app's own visibility rule.
 * - A negative rate or yield stays a number in CSV, not neutralised text.
 * - A foreign holding without a kwacha basis says "unavailable", not "none".
 * - Neither the export nor the download holds its row locks while it reads:
 *   a concurrent membership or account write is not blocked, and an export
 *   whose access changed meanwhile is refused.
 *
 * Real HTTP against real Postgres. Two seams are gated (a section read and the
 * file read) only to hold a request at a known point.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import {
  accounts, aiConversations, aiMessages, auditLogs, dataExports, grzBonds, holdings, householdMembers,
  householdSavedViews, households, investmentTransactions, securities, users, weeklyRecapFeedback,
} from "@shared/schema";
import { PERSONAL_EXPORT_JSON_ENTRY, PERSONAL_EXPORT_NONE, PERSONAL_EXPORT_UNAVAILABLE } from "@shared/personal-data-export";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { removePersonalExportFile } from "../settings.privacy-export.files";
import { parseCsv, readStoredZip } from "./personal-export-archive-reader";

const gates = vi.hoisted(() => {
  function gate() {
    let armed = false;
    let enter = () => undefined as void;
    let release = () => undefined as void;
    let entered = Promise.resolve();
    let released = Promise.resolve();
    return {
      arm() {
        armed = true;
        entered = new Promise<void>(resolve => { enter = resolve; });
        released = new Promise<void>(resolve => { release = resolve; });
      },
      async pass() { if (!armed) return; armed = false; enter(); await released; },
      entered: () => entered,
      release: () => release(),
    };
  }
  return { create: gate(), download: gate() };
});
vi.mock("../settings.privacy-export.sections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settings.privacy-export.sections")>();
  return {
    ...actual,
    readHouseholdInventory: async (...args: Parameters<typeof actual.readHouseholdInventory>) => {
      await gates.create.pass();
      return actual.readHouseholdInventory(...args);
    },
  };
});
vi.mock("../settings.privacy-export.files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settings.privacy-export.files")>();
  return {
    ...actual,
    readPersonalExportFile: async (...args: Parameters<typeof actual.readPersonalExportFile>) => {
      await gates.download.pass();
      return actual.readPersonalExportFile(...args);
    },
  };
});

const password = "SyntheticExportGaps123!";
const a = randomUUID();
const userIds: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
type Actor = { id: string; cookie: string };
let owner: Actor, member: Actor;

const id = () => randomUUID();
const acct = { shared: id(), invest: id(), ownerPrivate: id() };
const sec = { usd: id(), zmw: id() };
const holding = { usd: id(), zmw: id() };
const activity = { shared: id(), ownerPrivate: id() };
const conversation = { member: id(), owner: id() };
const view = { ownerRestricted: id(), member: id() };
const bond = id();
const NEGATIVE_YIELD = "-0.0125";

async function fixture(role: "owner" | "member"): Promise<Actor> {
  const userId = randomUUID();
  const email = `a27-gaps-${userId}@example.invalid`;
  await db.insert(users).values({ id: userId, email, username: `a27-gaps-${userId}`, passwordHash: await hashPassword(password), emailVerified: true });
  userIds.push(userId);
  await db.insert(householdMembers).values({ userId, householdId: a, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id: userId, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}
const stepUp = (actor: Actor) => request(app).post("/api/settings/security/step-up").set("Cookie", actor.cookie).send({ password }).expect(200);
const requestExport = (actor: Actor) => request(app).post("/api/settings/privacy/export").set("Cookie", actor.cookie).send({});
function download(actor: Actor, exportId: string) {
  return request(app).get(`/api/settings/privacy/exports/${exportId}/download`).set("Cookie", actor.cookie)
    .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on("data", (c: Buffer) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); });
}
const exportCount = async (actor: Actor) => (await db.select({ id: dataExports.id }).from(dataExports).where(eq(dataExports.userId, actor.id))).length;

async function exportEntries(actor: Actor) {
  await stepUp(actor);
  const created = await requestExport(actor).expect(201);
  const bytes = (await download(actor, created.body.data.id).expect(200)).body as Buffer;
  const entries = readStoredZip(bytes);
  const document = JSON.parse(entries.get(PERSONAL_EXPORT_JSON_ENTRY)!.data.toString("utf8")) as Record<string, unknown>;
  const csv = (section: string) => parseCsv(entries.get(`csv/${section}.csv`)?.data.toString("utf8") ?? "");
  return { exportId: created.body.data.id as string, entries, document, csv };
}

/** Run one write on its own connection; "blocked" when it waited on a row lock past the timeout. */
async function writeWithin(text: string, params: unknown[]): Promise<"done" | "blocked"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query(text, params);
    await client.query("COMMIT");
    return "done";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "55P03") return "blocked";
    throw error;
  } finally {
    client.release();
  }
}

async function seed() {
  const account = { initialBalance: "0.00", balance: "0.00", currency: "ZMW", ownerUserId: owner.id };
  await db.insert(accounts).values([
    { ...account, id: acct.shared, householdId: a, name: "A27 gaps shared", type: "checking", isPrivate: false },
    { ...account, id: acct.invest, householdId: a, name: "A27 gaps invest", type: "investment", isPrivate: false },
    { ...account, id: acct.ownerPrivate, householdId: a, name: "OWNER-PRIVATE invest", type: "investment", isPrivate: true },
  ]);
  await db.insert(securities).values([
    { id: sec.usd, symbol: `A27GU${a.slice(0, 6)}`, name: "A27 gaps USD fund", type: "etf", currency: "USD", currentPrice: null },
    { id: sec.zmw, symbol: `A27GZ${a.slice(0, 6)}`, name: "A27 gaps ZMW stock", type: "stock", currency: "ZMW", currentPrice: null },
  ]);
  await db.insert(holdings).values([
    { id: holding.usd, householdId: a, accountId: acct.invest, securityId: sec.usd, quantity: "2.00000000", costBasis: "200.00" },
    { id: holding.zmw, householdId: a, accountId: acct.invest, securityId: sec.zmw, quantity: "5.00000000", costBasis: "50.00" },
  ]);
  await db.insert(investmentTransactions).values([
    { id: activity.shared, householdId: a, accountId: acct.invest, holdingId: holding.zmw, securityId: sec.zmw, type: "buy",
      quantity: "5.00000000", price: "10.0000", amount: "50.00", currency: "ZMW", transactionDate: "2026-11-02", notes: "A27 gaps buy" },
    { id: activity.ownerPrivate, householdId: a, accountId: acct.ownerPrivate, type: "dividend", amount: "9.00", currency: "ZMW",
      transactionDate: "2026-11-03", notes: "OWNER-PRIVATE dividend" },
  ]);
  await db.insert(grzBonds).values({
    id: bond, householdId: a, accountId: acct.invest, bondName: "A27 gaps premium bond", tenorYears: 2, faceValue: "1000.00",
    purchasePrice: "1010.00", purchaseYield: NEGATIVE_YIELD, couponRate: "0.0500", purchaseDate: "2026-01-05",
    maturityDate: "2028-01-05", status: "active",
  });
  await db.insert(aiConversations).values([
    { id: conversation.member, householdId: a, userId: member.id, title: "A27 member question" },
    { id: conversation.owner, householdId: a, userId: owner.id, title: "OWNER-PRIVATE question" },
  ]);
  await db.insert(aiMessages).values([
    { conversationId: conversation.member, role: "user", content: "How much did I spend?", createdAt: new Date("2026-11-20T10:00:00Z") },
    { conversationId: conversation.member, role: "assistant", content: "A27 member answer", toolsUsed: ["get_spending_summary"], createdAt: new Date("2026-11-20T10:00:05Z") },
    { conversationId: conversation.owner, role: "user", content: "OWNER-PRIVATE message" },
  ]);
  const week = { householdId: a, weekStart: "2026-11-16", weekEnd: "2026-11-22", step: "overall", choice: "positive" };
  await db.insert(weeklyRecapFeedback).values([
    { ...week, userId: member.id, comment: "A27 member feedback" },
    { ...week, userId: owner.id, comment: "OWNER-PRIVATE feedback" },
  ]);
  await db.insert(householdSavedViews).values([
    { id: view.ownerRestricted, householdId: a, name: "A27 owner's private view", filter: { accountId: acct.ownerPrivate, type: "expense" }, createdBy: owner.id },
    { id: view.member, householdId: a, name: "A27 member view", filter: { accountId: acct.shared }, createdBy: member.id },
  ]);
}

describe("A-27 follow-up: the personal export's remaining gaps", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: a, name: "A27 gaps household", currency: "ZMW" });
    owner = await fixture("owner");
    member = await fixture("member");
    await seed();
  }, 90_000);

  afterEach(() => { gates.create.release(); gates.download.release(); vi.restoreAllMocks(); });

  afterAll(async () => {
    for (const userId of userIds) await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds));
    const written = await db.select({ id: dataExports.id }).from(dataExports).where(inArray(dataExports.userId, userIds));
    for (const row of written) await removePersonalExportFile(row.id);
    await db.delete(dataExports).where(inArray(dataExports.userId, userIds));
    await db.delete(householdSavedViews).where(eq(householdSavedViews.householdId, a));
    await db.delete(weeklyRecapFeedback).where(eq(weeklyRecapFeedback.householdId, a));
    await db.delete(aiConversations).where(eq(aiConversations.householdId, a));
    await db.delete(grzBonds).where(eq(grzBonds.householdId, a));
    await db.delete(investmentTransactions).where(eq(investmentTransactions.householdId, a));
    await db.delete(holdings).where(eq(holdings.householdId, a));
    await db.delete(accounts).where(eq(accounts.householdId, a));
    await db.delete(securities).where(inArray(securities.id, Object.values(sec)));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, a));
    await db.delete(households).where(eq(households.id, a));
    for (const userId of userIds) await db.delete(users).where(eq(users.id, userId));
  });

  it("answers 413, not 500, when the export is too large to build in memory, and writes nothing", async () => {
    const stringify = JSON.stringify.bind(JSON);
    vi.spyOn(JSON, "stringify").mockImplementation((value: unknown, ...rest: unknown[]) => {
      if (value && typeof value === "object" && (value as { format?: unknown }).format === "personal-data-export") {
        throw new RangeError("Invalid string length");
      }
      return (stringify as (...args: unknown[]) => string)(value, ...rest);
    });
    await stepUp(member);
    const before = await exportCount(member);

    const response = await requestExport(member);

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("EXPORT_TOO_LARGE");
    expect(await exportCount(member)).toBe(before);
  });

  it("exports the member's AI conversations, recap feedback, saved views and visible investment activity", async () => {
    const { document, csv, entries } = await exportEntries(member);

    expect(document.aiConversations).toEqual([expect.objectContaining({ id: conversation.member, title: "A27 member question" })]);
    expect(document.aiMessages).toEqual([
      expect.objectContaining({ conversationId: conversation.member, role: "user", content: "How much did I spend?" }),
      expect.objectContaining({ conversationId: conversation.member, role: "assistant", content: "A27 member answer", toolsUsed: ["get_spending_summary"] }),
    ]);
    expect(document.recapFeedback).toEqual([expect.objectContaining({ weekStart: "2026-11-16", step: "overall", choice: "positive", comment: "A27 member feedback" })]);
    expect(document.savedViews).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: view.member, createdByYou: true, restricted: false, filter: { accountId: acct.shared } }),
      expect.objectContaining({ id: view.ownerRestricted, createdByYou: false, restricted: true, filter: { type: "expense" } }),
    ]));
    expect(document.investmentActivity).toEqual([expect.objectContaining({
      id: activity.shared, type: "buy", amount: { amount: "50.00", currency: "ZMW" },
    })]);
    for (const section of ["aiConversations", "aiMessages", "recapFeedback", "savedViews", "investmentActivity"]) {
      expect(entries.has(`csv/${section}.csv`), section).toBe(true);
    }
    expect(csv("investmentActivity")).toEqual([expect.objectContaining({ id: activity.shared, amount: "50.00", amountCurrency: "ZMW" })]);
    const text = [...entries.values()].map(entry => entry.data.toString("utf8")).join("\n");
    for (const hidden of ["OWNER-PRIVATE", acct.ownerPrivate, owner.id]) expect(text).not.toContain(hidden);
  });

  it("keeps a negative yield numeric in CSV", async () => {
    const { csv } = await exportEntries(member);

    expect(csv("grzBonds").find(row => row.id === bond)).toMatchObject({ purchaseYield: NEGATIVE_YIELD });
  });

  it("says a foreign holding without a kwacha basis is unavailable, and a kwacha one has none", async () => {
    const { document, csv } = await exportEntries(member);

    const rows = document.holdings as Array<Record<string, unknown>>;
    expect(rows.find(row => row.id === holding.usd)).toMatchObject({ costBasisZmw: { amount: null, currency: "ZMW" } });
    expect(csv("holdings").find(row => row.id === holding.usd)).toMatchObject({ costBasisZmw: PERSONAL_EXPORT_UNAVAILABLE });
    expect(csv("holdings").find(row => row.id === holding.zmw)).toMatchObject({ costBasisZmw: PERSONAL_EXPORT_NONE });
  });

  it("does not hold the membership lock while it reads, and refuses an export whose access changed meanwhile", async () => {
    await stepUp(member);
    const before = await exportCount(member);
    gates.create.arm();
    const pending = requestExport(member).then(response => response);
    await gates.create.entered();

    const write = await writeWithin("UPDATE household_members SET role = role WHERE household_id = $1 AND user_id = $2", [a, member.id]);
    gates.create.release();
    const response = await pending;

    expect(write).toBe("done");
    expect(response.status).toBe(409);
    expect(await exportCount(member)).toBe(before);
  });

  it("does not hold source locks while the download reads its file", async () => {
    await stepUp(member);
    const created = await requestExport(member).expect(201);
    gates.download.arm();
    const pending = download(member, created.body.data.id).then(response => response);
    await gates.download.entered();

    const write = await writeWithin("UPDATE accounts SET name = name WHERE id = $1", [acct.shared]);
    gates.download.release();
    const response = await pending;

    expect(write).toBe("done");
    expect(response.status).toBe(200);
  });
});
