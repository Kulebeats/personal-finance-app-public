/**
 * A-27 (AH-08 export half): the personal-data export holds every entity the
 * requester may see, as JSON plus one CSV per section, in one stored ZIP.
 * Real HTTP against real Postgres; the archive is read back with an
 * independent reader that checks each entry's CRC and length.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import {
  accounts, auditLogs, budgets, categories, dataExports, goals, grzBondPayments, grzBonds, grzTBills, holdings,
  householdMembers, households, investmentTransactions, pendingReceipts, recurringTransactionHistory,
  recurringTransactionLinks, recurringTransactions, securities, tags, transactions, users,
} from "@shared/schema";
import {
  PERSONAL_EXPORT_CSV_SECTIONS, PERSONAL_EXPORT_JSON_ENTRY, PERSONAL_EXPORT_NONE, PERSONAL_EXPORT_UNAVAILABLE,
  personalExportCsvEntry,
} from "@shared/personal-data-export";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { personalExportRoot, removePersonalExportFile } from "../settings.privacy-export.files";
import { parseCsv, readStoredZip } from "./personal-export-archive-reader";

const password = "SyntheticExportInventory123!";
const a = randomUUID(), b = randomUUID();
const userIds: string[] = [];
const securityIds: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
type Actor = { id: string; cookie: string };
let owner: Actor, member: Actor, outsider: Actor;

const id = () => randomUUID();
const acct = { shared: id(), invest: id(), ownerPrivate: id(), memberUsd: id(), foreign: id(), ownerCash: id(), saleCash: id() };
const txn = { shared: id(), ownerPrivate: id(), foreign: id() };
const sec = { visible: id(), ownerOnly: id(), foreign: id() };
const goal = { shared: id(), privateSource: id(), foreign: id() };
const budget = { shared: id(), foreign: id() };
const rule = { shared: id(), memberUsd: id(), ownerPrivate: id(), foreign: id() };
const holding = { shared: id(), ownerPrivate: id(), foreign: id() };
const bond = { shared: id(), ownerPrivate: id(), foreign: id() };
const payment = { shared: id(), ownerPrivate: id() };
const bill = { awaiting: id(), ownerPrivate: id(), foreign: id() };
const receipt = { unlinked: id(), ownerPrivate: id(), foreign: id() };
const tag = { formula: id(), foreign: id() };
const category = { shared: id(), foreign: id() };

const GOAL_FORMULA = '=HYPERLINK("https://example.invalid")';
const TAG_FORMULA = "+Synthetic tag";
const SECURITY_FORMULA = "=1+1 Synthetic Fund";
const HIDDEN_PROGRESS = "777.77";
const FILE_MARKERS = ["STORED-NAME-A27", "UPLOAD-NAME-A27", "STORAGE-PATH-A27", "THUMB-PATH-A27"];

async function fixture(householdId: string, role: "owner" | "member"): Promise<Actor> {
  const userId = randomUUID();
  const email = `a27-${userId}@example.invalid`;
  await db.insert(users).values({ id: userId, email, username: `a27-${userId}`, passwordHash: await hashPassword(password), emailVerified: true });
  userIds.push(userId);
  await db.insert(householdMembers).values({ userId, householdId, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id: userId, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}
const stepUp = (actor: Actor) => request(app).post("/api/settings/security/step-up").set("Cookie", actor.cookie).send({ password }).expect(200);
const requestExport = (actor: Actor) => request(app).post("/api/settings/privacy/export").set("Cookie", actor.cookie).send({});
function download(actor: Actor, exportId: string) {
  return request(app).get(`/api/settings/privacy/exports/${exportId}/download`).set("Cookie", actor.cookie)
    .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on("data", (c: Buffer) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); });
}
const list = (actor: Actor) => request(app).get("/api/settings/privacy/exports").set("Cookie", actor.cookie).expect(200);

async function seedHousehold() {
  const account = { type: "checking" as const, initialBalance: "0.00", balance: "0.00" };
  await db.insert(accounts).values([
    { ...account, id: acct.shared, householdId: a, name: "A27 shared", currency: "ZMW", ownerUserId: owner.id, isPrivate: false },
    { ...account, id: acct.invest, householdId: a, name: "A27 shared invest", type: "investment", currency: "ZMW", ownerUserId: owner.id, isPrivate: false },
    { ...account, id: acct.ownerPrivate, householdId: a, name: "OWNER-PRIVATE account", type: "investment", currency: "ZMW", ownerUserId: owner.id, isPrivate: true },
    { ...account, id: acct.memberUsd, householdId: a, name: "A27 member USD", currency: "USD", ownerUserId: member.id, isPrivate: true },
    { ...account, id: acct.foreign, householdId: b, name: "HHB-SECRET account", currency: "ZMW", ownerUserId: outsider.id, isPrivate: false },
    // Sale cash destinations for the bond-sale cases.
    { ...account, id: acct.ownerCash, householdId: a, name: "OWNER-PRIVATE cash", currency: "ZMW", ownerUserId: owner.id, isPrivate: true },
    { ...account, id: acct.saleCash, householdId: a, name: "A27 shared sale cash", currency: "ZMW", ownerUserId: owner.id, isPrivate: false },
  ]);
  const base = { type: "expense" as const, currency: "ZMW", date: "2026-10-01", amount: "10.00" };
  await db.insert(transactions).values([
    { ...base, id: txn.shared, householdId: a, accountId: acct.shared, name: "A27 shared spend", isPrivate: false },
    { ...base, id: txn.ownerPrivate, householdId: a, accountId: acct.shared, name: "OWNER-PRIVATE spend", ownerUserId: owner.id, isPrivate: true },
    { ...base, id: txn.foreign, householdId: b, accountId: acct.foreign, name: "HHB-SECRET spend", isPrivate: false },
  ]);
  await db.insert(categories).values([
    { id: category.shared, householdId: a, name: "A27 groceries", displayOrder: 1 },
    { id: category.foreign, householdId: b, name: "HHB-SECRET category", displayOrder: 1 },
  ]);
  await db.insert(securities).values([
    { id: sec.visible, symbol: `A27V${a.slice(0, 6)}`, name: SECURITY_FORMULA, type: "etf", currency: "USD", currentPrice: null },
    { id: sec.ownerOnly, symbol: `A27O${a.slice(0, 6)}`, name: "OWNER-PRIVATE security", type: "stock", currency: "ZMW", currentPrice: "10.5000" },
    { id: sec.foreign, symbol: `A27F${a.slice(0, 6)}`, name: "HHB-SECRET security", type: "stock", currency: "ZMW", currentPrice: "1.0000" },
  ]);
  securityIds.push(...Object.values(sec));
  await db.insert(holdings).values([
    { id: holding.shared, householdId: a, accountId: acct.invest, securityId: sec.visible, quantity: "3.00000000", costBasis: "300.00" },
    { id: holding.ownerPrivate, householdId: a, accountId: acct.ownerPrivate, securityId: sec.ownerOnly, quantity: "9.00000000", costBasis: "900.00" },
    { id: holding.foreign, householdId: b, accountId: acct.foreign, securityId: sec.foreign, quantity: "1.00000000", costBasis: "1.00" },
  ]);
  await db.insert(goals).values([
    { id: goal.shared, householdId: a, createdBy: owner.id, name: GOAL_FORMULA, targetAmount: "5000.00", currentAmount: "120.00", currency: "USD" },
    { id: goal.privateSource, householdId: a, createdBy: owner.id, name: "A27 goal on a private source", targetAmount: "900.00",
      currentAmount: HIDDEN_PROGRESS, currency: "ZMW", linkedAccountId: acct.ownerPrivate },
    { id: goal.foreign, householdId: b, createdBy: outsider.id, name: "HHB-SECRET goal", targetAmount: "1.00", currentAmount: "0.00" },
  ]);
  await db.insert(budgets).values([
    { id: budget.shared, householdId: a, name: "A27 groceries budget", categoryId: category.shared, amount: "300.00", currency: "ZMW" },
    { id: budget.foreign, householdId: b, name: "HHB-SECRET budget", categoryId: category.foreign, amount: "1.00", currency: "ZMW" },
  ]);
  const ruleBase = { type: "expense" as const, frequency: "monthly" as const, startDate: "2026-11-01", nextDueDate: "2026-12-01", detectionMethod: "manual" };
  await db.insert(recurringTransactions).values([
    { ...ruleBase, id: rule.shared, householdId: a, accountId: acct.shared, name: "A27 shared rent", amount: "12.35" },
    { ...ruleBase, id: rule.memberUsd, householdId: a, accountId: acct.memberUsd, name: "A27 member USD subscription", amount: "45.00" },
    { ...ruleBase, id: rule.ownerPrivate, householdId: a, accountId: acct.ownerPrivate, name: "OWNER-PRIVATE rule", amount: "66.00" },
    { ...ruleBase, id: rule.foreign, householdId: b, accountId: acct.foreign, name: "HHB-SECRET rule", amount: "1.00" },
  ]);
  // The shared rule's unit is proven; the member's USD rule's is not.
  await db.insert(recurringTransactionHistory).values({ recurringTransactionId: rule.shared, action: "denomination_confirmed_v1",
    newState: { version: 1, currency: "ZMW", amount: "12.35", accountId: acct.shared, source: "manual_creation" }, performedBy: owner.id });
  const grz = { purchaseDate: "2026-01-05", status: "active" as const };
  await db.insert(grzBonds).values([
    { ...grz, id: bond.shared, householdId: a, accountId: acct.invest, bondName: "A27 shared bond", tenorYears: 2, faceValue: "2000.00",
      purchasePrice: "1900.00", couponRate: "0.1500", maturityDate: "2028-01-05" },
    { ...grz, id: bond.ownerPrivate, householdId: a, accountId: acct.ownerPrivate, bondName: "OWNER-PRIVATE bond", tenorYears: 2,
      faceValue: "8000.00", purchasePrice: "7900.00", couponRate: "0.1500", maturityDate: "2028-01-05" },
    { ...grz, id: bond.foreign, householdId: b, accountId: acct.foreign, bondName: "HHB-SECRET bond", tenorYears: 2,
      faceValue: "1.00", purchasePrice: "1.00", couponRate: "0.1000", maturityDate: "2028-01-05" },
  ]);
  await db.insert(grzBondPayments).values([
    { id: payment.shared, bondId: bond.shared, paymentDate: "2026-07-05", paymentType: "coupon", grossAmount: "150.00", withholdingTax: "22.50", netAmount: "127.50" },
    { id: payment.ownerPrivate, bondId: bond.ownerPrivate, paymentDate: "2026-07-05", paymentType: "coupon", grossAmount: "600.00", withholdingTax: "90.00", netAmount: "510.00" },
  ]);
  await db.insert(grzTBills).values([
    { id: bill.awaiting, householdId: a, accountId: acct.invest, tbillName: "A27 awaiting bill", tenorDays: 91, faceValue: "1000.00",
      purchasePrice: "950.00", purchaseDate: "2026-07-01", maturityDate: "2026-09-30", status: "awaiting_receipt", maturedDate: "2026-09-30",
      maturityWithholdingTax: "20.00", maturityNetProceeds: "980.00" },
    { id: bill.ownerPrivate, householdId: a, accountId: acct.ownerPrivate, tbillName: "OWNER-PRIVATE bill", tenorDays: 91, faceValue: "4000.00",
      purchasePrice: "3800.00", purchaseDate: "2026-07-01", maturityDate: "2026-12-30", status: "active" },
    { id: bill.foreign, householdId: b, accountId: acct.foreign, tbillName: "HHB-SECRET bill", tenorDays: 91, faceValue: "1.00",
      purchasePrice: "1.00", purchaseDate: "2026-07-01", maturityDate: "2026-12-30", status: "active" },
  ]);
  const file = { mimeType: "image/png", size: 10, ocrStatus: "completed", matchStatus: "pending" };
  await db.insert(pendingReceipts).values([
    { ...file, id: receipt.unlinked, householdId: a, uploadedBy: member.id, filename: "STORED-NAME-A27-1.png", originalFilename: "UPLOAD-NAME-A27-1.png",
      storagePath: "receipts/STORAGE-PATH-A27-1.png", thumbnailPath: "THUMB-PATH-A27-1.png", ocrData: { merchantName: "A27 corner shop", amount: "18.40", currency: "ZMW" } },
    { ...file, id: receipt.ownerPrivate, householdId: a, uploadedBy: owner.id, filename: "STORED-NAME-A27-2.png", originalFilename: "UPLOAD-NAME-A27-2.png",
      storagePath: "receipts/STORAGE-PATH-A27-2.png", matchStatus: "matched", matchedTransactionId: txn.ownerPrivate, ocrData: { merchantName: "OWNER-PRIVATE receipt" } },
    { ...file, id: receipt.foreign, householdId: b, uploadedBy: outsider.id, filename: "HHB-SECRET.png", originalFilename: "HHB-SECRET.png",
      storagePath: "receipts/HHB-SECRET.png", ocrData: { merchantName: "HHB-SECRET receipt" } },
  ]);
  await db.insert(tags).values([
    { id: tag.formula, householdId: a, name: TAG_FORMULA },
    { id: tag.foreign, householdId: b, name: "HHB-SECRET tag" },
  ]);
}

async function exportFor(actor: Actor) {
  await stepUp(actor);
  const created = await requestExport(actor).expect(201);
  const exportId: string = created.body.data.id;
  const response = await download(actor, exportId).expect(200);
  return { exportId, response, bytes: response.body as Buffer };
}
const csvRows = (entries: ReturnType<typeof readStoredZip>, section: (typeof PERSONAL_EXPORT_CSV_SECTIONS)[number]) =>
  parseCsv(entries.get(personalExportCsvEntry(section))!.data.toString("utf8"));
const allText = (entries: ReturnType<typeof readStoredZip>) => [...entries.values()].map(entry => entry.data.toString("utf8")).join("\n");

describe("A-27 personal export: full visible inventory as JSON plus CSV", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values([{ id: a, name: "A27 household", currency: "ZMW" }, { id: b, name: "HHB-SECRET household", currency: "ZMW" }]);
    owner = await fixture(a, "owner");
    member = await fixture(a, "member");
    outsider = await fixture(b, "owner");
    await seedHousehold();
  }, 90_000);

  afterAll(async () => {
    for (const userId of userIds) await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds));
    const written = await db.select({ id: dataExports.id }).from(dataExports).where(inArray(dataExports.userId, userIds));
    for (const row of written) await removePersonalExportFile(row.id);
    await db.delete(dataExports).where(inArray(dataExports.userId, userIds));
    // A settled bond sale and its cash may only go with the household, in one transaction (migration 0039).
    await db.transaction(async tx => {
      const households_ = [a, b];
      await tx.delete(tags).where(inArray(tags.householdId, households_));
      await tx.delete(pendingReceipts).where(inArray(pendingReceipts.householdId, households_));
      await tx.delete(grzBondPayments).where(inArray(grzBondPayments.bondId,
        tx.select({ id: grzBonds.id }).from(grzBonds).where(inArray(grzBonds.householdId, households_))));
      await tx.delete(grzBonds).where(inArray(grzBonds.householdId, households_));
      await tx.delete(grzTBills).where(inArray(grzTBills.householdId, households_));
      const rules = tx.select({ id: recurringTransactions.id }).from(recurringTransactions).where(inArray(recurringTransactions.householdId, households_));
      await tx.delete(recurringTransactionLinks).where(inArray(recurringTransactionLinks.recurringTransactionId, rules));
      await tx.delete(recurringTransactionHistory).where(inArray(recurringTransactionHistory.recurringTransactionId, rules));
      await tx.delete(recurringTransactions).where(inArray(recurringTransactions.householdId, households_));
      await tx.delete(budgets).where(inArray(budgets.householdId, households_));
      await tx.delete(goals).where(inArray(goals.householdId, households_));
      await tx.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, households_));
      await tx.delete(holdings).where(inArray(holdings.householdId, households_));
      await tx.delete(transactions).where(inArray(transactions.householdId, households_));
      await tx.delete(categories).where(inArray(categories.householdId, households_));
      await tx.delete(accounts).where(inArray(accounts.householdId, households_));
      await tx.delete(householdMembers).where(inArray(householdMembers.householdId, households_));
      await tx.delete(households).where(inArray(households.id, households_));
    });
    await db.delete(securities).where(inArray(securities.id, securityIds));
    for (const userId of userIds) await db.delete(users).where(eq(users.id, userId));
  });

  it("downloads one verified ZIP with the JSON document and a CSV for every section, and audits the counts", async () => {
    const { exportId, response, bytes } = await exportFor(member);
    expect(response.headers["content-type"]).toContain("application/zip");
    expect(response.headers["content-disposition"]).toContain(`personal-data-export-${exportId}.zip`);
    const [row] = await db.select().from(dataExports).where(eq(dataExports.id, exportId));
    const manifest = row.parameters as { version: number; sha256: string; sizeBytes: number; sections: Record<string, number> };
    expect(row.fileFormat).toBe("zip");
    expect(manifest.version).toBe(2);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.sha256);
    expect(manifest.sizeBytes).toBe(bytes.length);

    const entries = readStoredZip(bytes);
    expect([...entries.keys()].sort()).toEqual([PERSONAL_EXPORT_JSON_ENTRY, ...PERSONAL_EXPORT_CSV_SECTIONS.map(personalExportCsvEntry)].sort());
    for (const entry of entries.values()) expect(entry.flags & 0x0800).toBe(0);
    expect(new Set([...entries.values()].map(entry => `${entry.date}:${entry.time}`)).size).toBe(1);

    const expected = { goals: 2, budgets: 1, recurringRules: 2, holdings: 1, grzBonds: 1, grzBondPayments: 1, grzTBills: 1, receipts: 1, tags: 1 };
    expect(manifest.sections).toMatchObject(expected);
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "data_export"),
      eq(auditLogs.entityId, exportId), eq(auditLogs.action, "CREATE")));
    expect(audit).toMatchObject({ userId: member.id, householdId: null });
    expect(audit.details).toMatchObject({ fileFormat: "zip", sections: expected, sha256: manifest.sha256 });
  });

  it("JSON holds the member's own and shared entities, each amount in its own currency, and nothing hidden", async () => {
    const { bytes } = await exportFor(member);
    const entries = readStoredZip(bytes);
    const data = JSON.parse(entries.get(PERSONAL_EXPORT_JSON_ENTRY)!.data.toString("utf8"));
    expect(data.version).toBe(2);
    const ids = (section: string) => data[section].map((item: { id: string }) => item.id).sort();
    expect(ids("goals")).toEqual([goal.shared, goal.privateSource].sort());
    expect(ids("budgets")).toEqual([budget.shared]);
    expect(ids("recurringRules")).toEqual([rule.shared, rule.memberUsd].sort());
    expect(ids("holdings")).toEqual([holding.shared]);
    expect(ids("grzBonds")).toEqual([bond.shared]);
    expect(ids("grzBondPayments")).toEqual([payment.shared]);
    expect(ids("grzTBills")).toEqual([bill.awaiting]);
    expect(ids("receipts")).toEqual([receipt.unlinked]);
    expect(ids("tags")).toEqual([tag.formula]);

    const byId = <T extends { id: string }>(section: string, wanted: string): T => data[section].find((item: T) => item.id === wanted);
    expect(byId("goals", goal.shared)).toMatchObject({ name: GOAL_FORMULA, targetAmount: { amount: "5000.00", currency: "USD" },
      currentAmount: { amount: "120.00", currency: "USD" }, progressAvailability: "available" });
    expect(byId("goals", goal.privateSource)).toMatchObject({ currentAmount: { amount: null, currency: "ZMW" },
      progressAvailability: "unavailable", linkedAccountId: null });
    expect(byId("budgets", budget.shared)).toMatchObject({ amount: { amount: "300.00", currency: "ZMW" }, categoryId: category.shared });
    expect(byId("recurringRules", rule.shared)).toMatchObject({ amount: { amount: "12.35", currency: "ZMW" } });
    expect(byId("recurringRules", rule.memberUsd)).toMatchObject({ amount: { amount: "45.00", currency: null } });
    expect(byId("holdings", holding.shared)).toMatchObject({ securityName: SECURITY_FORMULA, quantity: "3.00000000",
      costBasis: { amount: "300.00", currency: "USD" }, currentPrice: { amount: null, currency: "USD" } });
    expect(byId("grzBonds", bond.shared)).toMatchObject({ faceValue: { amount: "2000.00", currency: "ZMW" } });
    expect(byId("grzTBills", bill.awaiting)).toMatchObject({ status: "awaiting_receipt", amountDue: { amount: "980.00", currency: "ZMW" } });
    expect(byId("receipts", receipt.unlinked)).toMatchObject({ merchantName: "A27 corner shop", amount: { amount: "18.40", currency: "ZMW" }, uploadedByYou: true });
    for (const key of ["filename", "originalFilename", "storagePath", "thumbnailPath", "imageHash", "uploadedBy"]) {
      expect(byId("receipts", receipt.unlinked)).not.toHaveProperty(key);
    }

    const text = allText(entries);
    const hidden = [
      "OWNER-PRIVATE", "HHB-SECRET", HIDDEN_PROGRESS, ...FILE_MARKERS, acct.ownerPrivate, holding.ownerPrivate, bond.ownerPrivate,
      payment.ownerPrivate, bill.ownerPrivate, rule.ownerPrivate, receipt.ownerPrivate, txn.ownerPrivate, owner.id, outsider.id,
      ...[acct.foreign, txn.foreign, goal.foreign, budget.foreign, rule.foreign, holding.foreign, bond.foreign, bill.foreign, receipt.foreign, tag.foreign, category.foreign, b],
    ];
    for (const value of hidden) expect({ value, leaked: text.includes(value) }).toEqual({ value, leaked: false });
  });

  it("CSV neutralises formula-leading text and writes amounts with their currency", async () => {
    const { bytes } = await exportFor(member);
    const entries = readStoredZip(bytes);
    const goalRow = csvRows(entries, "goals").find(row => row.id === goal.shared)!;
    expect(goalRow.name).toBe(`'${GOAL_FORMULA}`);
    expect(goalRow).toMatchObject({ targetAmount: "5000.00", targetAmountCurrency: "USD", currentAmount: "120.00", currentAmountCurrency: "USD" });
    expect(csvRows(entries, "goals").find(row => row.id === goal.privateSource)).toMatchObject({ currentAmount: PERSONAL_EXPORT_UNAVAILABLE });
    expect(csvRows(entries, "tags")).toEqual([expect.objectContaining({ id: tag.formula, name: `'${TAG_FORMULA}` })]);
    expect(csvRows(entries, "holdings")).toEqual([expect.objectContaining({ id: holding.shared, securityName: `'${SECURITY_FORMULA}`,
      costBasis: "300.00", costBasisCurrency: "USD", currentPrice: PERSONAL_EXPORT_UNAVAILABLE })]);
    expect(csvRows(entries, "recurringRules").find(row => row.id === rule.memberUsd))
      .toMatchObject({ amount: "45.00", amountCurrency: PERSONAL_EXPORT_UNAVAILABLE });
    expect(csvRows(entries, "grzTBills")).toEqual([expect.objectContaining({ id: bill.awaiting, status: "awaiting_receipt",
      amountDue: "980.00", amountDueCurrency: "ZMW" })]);
    expect(csvRows(entries, "budgets")).toEqual([expect.objectContaining({ id: budget.shared, amount: "300.00", amountCurrency: "ZMW" })]);
  });

  it("the peer's own export holds their private bond and holding; the member's never does", async () => {
    const { bytes } = await exportFor(owner);
    const data = JSON.parse(readStoredZip(bytes).get(PERSONAL_EXPORT_JSON_ENTRY)!.data.toString("utf8"));
    expect(data.grzBonds.map((item: { id: string }) => item.id).sort()).toEqual([bond.shared, bond.ownerPrivate].sort());
    expect(data.holdings.map((item: { id: string }) => item.id).sort()).toEqual([holding.shared, holding.ownerPrivate].sort());
    expect(data.goals.find((item: { id: string }) => item.id === goal.privateSource))
      .toMatchObject({ currentAmount: { amount: HIDDEN_PROGRESS, currency: "ZMW" } });
  });

  // Every exported account stays visible, so only the holding source check can catch this.
  it("revokes an export when an exported holding moves into another member's private account", async () => {
    const watcher = await fixture(a, "member");
    const { exportId } = await exportFor(watcher);
    await db.update(holdings).set({ accountId: acct.ownerPrivate }).where(eq(holdings.id, holding.shared));
    try {
      await download(watcher, exportId).expect(404);
      expect((await list(watcher)).body.data[0]).toMatchObject({ id: exportId, status: "revoked", downloadUrl: null });
    } finally {
      await db.update(holdings).set({ accountId: acct.invest }).where(eq(holdings.id, holding.shared));
    }
  });

  it("revokes an export when an exported receipt is relinked to another member's private transaction", async () => {
    const watcher = await fixture(a, "member");
    const { exportId } = await exportFor(watcher);
    const [stored] = await db.select({ parameters: dataExports.parameters }).from(dataExports).where(eq(dataExports.id, exportId));
    expect((stored.parameters as { sourceReceiptIds: string[] }).sourceReceiptIds).toEqual([receipt.unlinked]);
    await db.update(pendingReceipts).set({ matchedTransactionId: txn.ownerPrivate, matchStatus: "matched" }).where(eq(pendingReceipts.id, receipt.unlinked));
    try {
      await download(watcher, exportId).expect(404);
      expect((await list(watcher)).body.data[0]).toMatchObject({ id: exportId, status: "revoked" });
    } finally {
      await db.update(pendingReceipts).set({ matchedTransactionId: null, matchStatus: "pending" }).where(eq(pendingReceipts.id, receipt.unlinked));
    }
  });

  it("a version 1 JSON export made before this change still downloads as before", async () => {
    await stepUp(member);
    const exportId = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ format: "personal-data-export", version: 1, householdId: a, accounts: [] }, null, 2));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await fs.mkdir(personalExportRoot(), { recursive: true });
    await fs.writeFile(path.join(personalExportRoot(), `${exportId}.json`), bytes);
    await db.insert(dataExports).values({ id: exportId, userId: member.id, householdId: null, exportType: "personal_data", fileFormat: "json",
      fileUrl: `/api/settings/privacy/exports/${exportId}/download`, recordCount: 0, status: "ready",
      parameters: { kind: "personal_data", version: 1, householdId: a, sha256, sizeBytes: bytes.length,
        sections: { profile: 0, memberships: 0, preferences: 0, accounts: 0, transactions: 0, categories: 0, securityEvents: 0 },
        sourceAccountIds: [], sourceTransactionIds: [] } });
    const response = await download(member, exportId).expect(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toContain(`personal-data-export-${exportId}.json`);
    expect(Buffer.compare(response.body as Buffer, bytes)).toBe(0);
  });

  // Review of #350 (P1): an expense or a liability is a number in the sheet, not text.
  it("writes negative transaction amounts and account balances as numeric cells with their currency", async () => {
    const card = id(), spend = id();
    await db.insert(accounts).values({ id: card, householdId: a, name: "A27 shared card", type: "credit", currency: "ZMW",
      ownerUserId: owner.id, isPrivate: false, isAsset: false, initialBalance: "-250.00", balance: "-250.00", creditLimit: "1000.00" });
    await db.insert(transactions).values({ id: spend, householdId: a, accountId: card, name: "A27 card spend", type: "expense",
      currency: "ZMW", date: "2026-10-02", amount: "-10.00", isPrivate: false });
    try {
      const entries = readStoredZip((await exportFor(member)).bytes);
      expect(csvRows(entries, "transactions").find(row => row.id === spend)).toMatchObject({ amount: "-10.00", amountCurrency: "ZMW" });
      expect(csvRows(entries, "accounts").find(row => row.id === card)).toMatchObject({
        balance: "-250.00", balanceCurrency: "ZMW", initialBalance: "-250.00", initialBalanceCurrency: "ZMW",
        creditLimit: "1000.00", creditLimitCurrency: "ZMW", availableBalance: PERSONAL_EXPORT_NONE,
      });
    } finally {
      await db.delete(transactions).where(eq(transactions.id, spend));
      await db.delete(accounts).where(eq(accounts.id, card));
    }
  });

  // Re-review of #350: only the typed amount column is exempt from formula neutralisation.
  it("neutralises negative-looking free text while the same row's amount stays numeric", async () => {
    const spend = id();
    await db.insert(transactions).values({ id: spend, householdId: a, accountId: acct.shared, name: "-10.00", notes: "-1+1",
      type: "expense", currency: "ZMW", date: "2026-10-03", amount: "-10.00", isPrivate: false });
    try {
      const entries = readStoredZip((await exportFor(member)).bytes);
      expect(csvRows(entries, "transactions").find(row => row.id === spend)).toMatchObject({
        name: "'-10.00", notes: "'-1+1", amount: "-10.00", amountCurrency: "ZMW",
      });
    } finally {
      await db.delete(transactions).where(eq(transactions.id, spend));
    }
  });

  // Re-review of #350 (N2): a kwacha holding needs no acquisition rate, so it has none; a foreign one without it is unknown.
  it("writes a kwacha holding's absent acquisition FX rate as 'none' and a foreign one's as 'unavailable'", async () => {
    const rows = csvRows(readStoredZip((await exportFor(owner)).bytes), "holdings");
    expect(rows.find(row => row.id === holding.ownerPrivate)).toMatchObject({ securityCurrency: "ZMW", acquisitionFxRate: PERSONAL_EXPORT_NONE });
    expect(rows.find(row => row.id === holding.shared)).toMatchObject({ securityCurrency: "USD", acquisitionFxRate: PERSONAL_EXPORT_UNAVAILABLE });
  });

  it("keeps a header row on a section with no rows", async () => {
    // Household B has no bond payments, so that sheet is empty for the outsider.
    const entries = readStoredZip((await exportFor(outsider)).bytes);
    for (const section of PERSONAL_EXPORT_CSV_SECTIONS) {
      const [header] = entries.get(personalExportCsvEntry(section))!.data.toString("utf8").split("\n");
      expect({ section, hasHeader: header.trim().length > 0 }).toEqual({ section, hasHeader: true });
    }
    expect(csvRows(entries, "grzBondPayments")).toEqual([]);
    const [paymentHeader] = entries.get(personalExportCsvEntry("grzBondPayments"))!.data.toString("utf8").split("\n");
    expect(paymentHeader.split(",")).toEqual(expect.arrayContaining(["id", "bondId", "grossAmount", "grossAmountCurrency"]));
  });

  it("labels an amount that does not apply 'none' and a missing rate 'unavailable', and leaves stored image paths out", async () => {
    const noDefault = id(), legacySold = id();
    await db.update(users).set({ profilePictureUrl: "/uploads/PROFILE-PATH-A27.png", bannerUrl: "/uploads/BANNER-PATH-A27.png" })
      .where(eq(users.id, member.id));
    await db.insert(budgets).values({ id: noDefault, householdId: a, name: "A27 budget without a default", categoryId: category.shared, amount: null, currency: "ZMW" });
    // Sold before settlement tracking: no sale cash, fees, basis or gain were ever recorded.
    await db.insert(grzBonds).values({ id: legacySold, householdId: a, accountId: acct.invest, bondName: "A27 legacy sold bond", tenorYears: 2,
      faceValue: "2000.00", purchasePrice: "1900.00", couponRate: "0.1500", purchaseDate: "2025-01-05", maturityDate: "2027-01-05",
      status: "sold", soldDate: "2026-03-01", soldPrice: "1950.00" });
    try {
      const entries = readStoredZip((await exportFor(member)).bytes);
      const data = JSON.parse(entries.get(PERSONAL_EXPORT_JSON_ENTRY)!.data.toString("utf8"));
      expect(data.profile).not.toHaveProperty("profilePictureUrl");
      expect(data.profile).not.toHaveProperty("bannerUrl");
      expect(allText(entries)).not.toMatch(/PROFILE-PATH-A27|BANNER-PATH-A27/);
      expect(data.budgets.find((item: { id: string }) => item.id === noDefault)).toMatchObject({ amount: null });
      expect(csvRows(entries, "budgets").find(row => row.id === noDefault)).toMatchObject({ amount: PERSONAL_EXPORT_NONE });
      expect(csvRows(entries, "grzBonds").find(row => row.id === legacySold)).toMatchObject({ soldPrice: "1950.00",
        saleFees: PERSONAL_EXPORT_NONE, saleCostBasis: PERSONAL_EXPORT_NONE, saleRealizedGain: PERSONAL_EXPORT_NONE });
      expect(csvRows(entries, "grzBonds").find(row => row.id === bond.shared)).toMatchObject({ soldPrice: PERSONAL_EXPORT_NONE });
      expect(csvRows(entries, "holdings").find(row => row.id === holding.shared)).toMatchObject({ acquisitionFxRate: PERSONAL_EXPORT_UNAVAILABLE });
    } finally {
      await db.delete(grzBonds).where(eq(grzBonds.id, legacySold));
      await db.delete(budgets).where(eq(budgets.id, noDefault));
      await db.update(users).set({ profilePictureUrl: null, bannerUrl: null }).where(eq(users.id, member.id));
    }
  });

  // Each new source set alone revokes: every exported account and transaction stays visible.
  const privateIncome = id();
  const sourceChanges: Array<{ source: string; change: () => Promise<unknown>; restore: () => Promise<unknown> }> = [
    { source: "a goal's progress source",
      change: () => db.update(goals).set({ linkedAccountId: acct.ownerPrivate }).where(eq(goals.id, goal.shared)),
      restore: () => db.update(goals).set({ linkedAccountId: null }).where(eq(goals.id, goal.shared)) },
    { source: "a recurring rule",
      change: () => db.update(recurringTransactions).set({ accountId: acct.ownerPrivate }).where(eq(recurringTransactions.id, rule.shared)),
      restore: () => db.update(recurringTransactions).set({ accountId: acct.shared }).where(eq(recurringTransactions.id, rule.shared)) },
    { source: "a bond",
      change: () => db.update(grzBonds).set({ accountId: acct.ownerPrivate }).where(eq(grzBonds.id, bond.shared)),
      restore: () => db.update(grzBonds).set({ accountId: acct.invest }).where(eq(grzBonds.id, bond.shared)) },
    { source: "a bond payment",
      change: async () => {
        await db.insert(transactions).values({ id: privateIncome, householdId: a, accountId: acct.shared, name: "OWNER-PRIVATE coupon",
          type: "income", currency: "ZMW", date: "2026-07-05", amount: "127.50", ownerUserId: owner.id, isPrivate: true });
        await db.update(grzBondPayments).set({ incomeTransactionId: privateIncome }).where(eq(grzBondPayments.id, payment.shared));
      },
      restore: async () => {
        await db.update(grzBondPayments).set({ incomeTransactionId: null }).where(eq(grzBondPayments.id, payment.shared));
        await db.delete(transactions).where(eq(transactions.id, privateIncome));
      } },
    { source: "a T-bill",
      change: () => db.update(grzTBills).set({ accountId: acct.ownerPrivate }).where(eq(grzTBills.id, bill.awaiting)),
      restore: () => db.update(grzTBills).set({ accountId: acct.invest }).where(eq(grzTBills.id, bill.awaiting)) },
  ];
  it.each(sourceChanges)("revokes an export when $source becomes private to another member", async ({ change, restore }) => {
    const watcher = await fixture(a, "member");
    const { exportId } = await exportFor(watcher);
    await change();
    try {
      await download(watcher, exportId).expect(404);
      expect((await list(watcher)).body.data[0]).toMatchObject({ id: exportId, status: "revoked", downloadUrl: null });
    } finally {
      await restore();
    }
  });

  const documentOf = (bytes: Buffer) => JSON.parse(readStoredZip(bytes).get(PERSONAL_EXPORT_JSON_ENTRY)!.data.toString("utf8"));
  const idsIn = (items: Array<{ id: string }>) => items.map(item => item.id);

  it("withholds a shared rule linked to another member's private transaction, and linking one revokes the export", async () => {
    const watcher = await fixture(a, "member");
    const { exportId } = await exportFor(watcher);
    const [link] = await db.insert(recurringTransactionLinks).values({ recurringTransactionId: rule.shared, transactionId: txn.ownerPrivate }).returning();
    try {
      await download(watcher, exportId).expect(404);
      expect((await list(watcher)).body.data[0]).toMatchObject({ id: exportId, status: "revoked" });
      const later = (await exportFor(watcher)).bytes;
      expect(idsIn(documentOf(later).recurringRules)).not.toContain(rule.shared);
      expect(later.toString("utf8")).not.toContain(rule.shared);
      expect(idsIn(documentOf((await exportFor(owner)).bytes).recurringRules)).toContain(rule.shared);
    } finally {
      await db.delete(recurringTransactionLinks).where(eq(recurringTransactionLinks.id, link.id));
    }
  });

  it("shows a shared bond sold into private cash as sold with its sale figures withheld; cash going private revokes", async () => {
    const capital = (method: "post" | "put", route: string) => request(app)[method](route).set("Cookie", owner.cookie)
      .set("X-Capital-Subject", owner.id).set("X-Capital-Household", a);
    const createBond = async (isin: string) => (await capital("post", "/api/grz/bonds").send({ accountId: acct.invest, isin,
      bondName: "A27 sold bond", tenorYears: 2, faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0800", couponFrequency: 2,
      purchaseDate: "2025-06-30", firstCouponDate: "2025-12-31", maturityDate: "2027-12-31" }).expect(201)).body.data.id as string;
    const sale = { soldDate: "2026-08-15", soldPrice: "980.50", fees: "5.25" };
    const intoPrivate = await createBond("ZM0000000271");
    await capital("put", `/api/grz/bonds/${intoPrivate}/sell`).send({ ...sale, accountId: acct.ownerCash }).expect(200);
    const [{ saleCashTransactionId: privateCash }] = await db.select({ saleCashTransactionId: grzBonds.saleCashTransactionId })
      .from(grzBonds).where(eq(grzBonds.id, intoPrivate));

    const watcher = await fixture(a, "member");
    const seen = await exportFor(watcher);
    const entries = readStoredZip(seen.bytes);
    expect(documentOf(seen.bytes).grzBonds.find((item: { id: string }) => item.id === intoPrivate)).toMatchObject({
      status: "sold", soldDate: "2026-08-15", soldPrice: { amount: null, currency: "ZMW" },
      saleFees: { amount: null, currency: "ZMW" }, saleRealizedGain: { amount: null, currency: "ZMW" }, saleCashTransactionId: null });
    expect(csvRows(entries, "grzBonds").find(row => row.id === intoPrivate)).toMatchObject({ soldPrice: PERSONAL_EXPORT_UNAVAILABLE });
    expect(allText(entries)).not.toContain(privateCash!);
    expect(documentOf((await exportFor(owner)).bytes).grzBonds.find((item: { id: string }) => item.id === intoPrivate))
      .toMatchObject({ soldPrice: { amount: "980.50", currency: "ZMW" }, saleCashTransactionId: privateCash });

    const intoShared = await createBond("ZM0000000272");
    await capital("put", `/api/grz/bonds/${intoShared}/sell`).send({ ...sale, accountId: acct.saleCash }).expect(200);
    const { exportId, bytes } = await exportFor(watcher);
    expect(documentOf(bytes).grzBonds.find((item: { id: string }) => item.id === intoShared))
      .toMatchObject({ soldPrice: { amount: "980.50", currency: "ZMW" } });
    await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, acct.saleCash));
    try {
      await download(watcher, exportId).expect(404);
      expect((await list(watcher)).body.data[0]).toMatchObject({ id: exportId, status: "revoked" });
    } finally {
      await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, acct.saleCash));
    }
  });
});
