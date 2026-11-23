import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, auditLogs, householdMembers, households, tags, transactionTags, transactions, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

export const roles = ["owner", "admin", "member", "view_only", "professional"] as const;
export type Role = (typeof roles)[number];
export const a = randomUUID(), b = randomUUID();
export const actors = new Map<Role | "outsider", { id: string; cookie: string }>();
export let app: Awaited<ReturnType<typeof getTestApp>>;
export const ids = { privateAccount: randomUUID(), sharedAccount: randomUUID(), foreignAccount: randomUUID(), privateTx: randomUUID(), sharedTx: randomUUID(), foreignTx: randomUUID(), tag: randomUUID(), foreignTag: randomUUID() };

export async function start() {
  app = await getTestApp();
  await db.insert(households).values([{ id: a, name: "Synthetic A5 A", currency: "ZMW" }, { id: b, name: "Synthetic A5 B", currency: "ZMW" }]);
  const password = "SyntheticR04Tags123!", passwordHash = await hashPassword(password);
  for (const role of [...roles, "outsider"] as const) {
    const id = randomUUID(), email = `r04-tag-${id}@example.invalid`;
    await db.insert(users).values({ id, email, username: `r04-tag-${id}`, passwordHash, emailVerified: true, timezone: "Africa/Lusaka" });
    await db.insert(householdMembers).values({ householdId: role === "outsider" ? b : a, userId: id, role: role === "outsider" ? "owner" : role });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    actors.set(role, { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
  }
}
export async function resetAccountsAndMembership() {
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(accounts).where(inArray(accounts.householdId, [a, b]));
  await db.delete(tags).where(inArray(tags.householdId, [a, b]));
  await db.delete(auditLogs).where(inArray(auditLogs.userId, [...actors.values()].map(({ id }) => id)));
  for (const role of roles) await db.insert(householdMembers).values({ householdId: a, userId: actors.get(role)!.id, role })
    .onConflictDoUpdate({ target: [householdMembers.householdId, householdMembers.userId], set: { role } });
  const owner = actors.get("owner")!.id, outsider = actors.get("outsider")!.id;
  // Accepted A5 literals: initial 5000/1000, after expenses 4222.23/988.89.
  await db.insert(accounts).values([
    { id: ids.privateAccount, householdId: a, name: "A5 PRIVATE", type: "savings", currency: "ZMW", initialBalance: "5000.00", balance: "4222.23", isPrivate: true, ownerUserId: owner },
    { id: ids.sharedAccount, householdId: a, name: "A5 SHARED", type: "checking", currency: "ZMW", initialBalance: "1000.00", balance: "988.89", isPrivate: false, ownerUserId: owner },
    { id: ids.foreignAccount, householdId: b, name: "Foreign parent", type: "checking", currency: "ZMW", balance: "0", isPrivate: false, ownerUserId: outsider },
  ]);
}
export async function reset() {
  await resetAccountsAndMembership();
  const owner = actors.get("owner")!.id, outsider = actors.get("outsider")!.id;
  await db.insert(transactions).values([
    { id: ids.privateTx, householdId: a, accountId: ids.privateAccount, ownerUserId: owner, date: "2026-10-05", name: "PRIVSECRET purchase", amount: "777.77", type: "expense", isPrivate: false },
    { id: ids.sharedTx, householdId: a, accountId: ids.sharedAccount, ownerUserId: owner, date: "2026-10-05", name: "SHAREDTXN coffee", amount: "11.11", type: "expense", isPrivate: false },
    { id: ids.foreignTx, householdId: b, accountId: ids.foreignAccount, ownerUserId: outsider, date: "2026-10-05", name: "FOREIGN transaction", amount: "22.22", type: "expense", isPrivate: false },
  ]);
  await db.insert(tags).values([
    { id: ids.tag, householdId: a, name: "A5Tag", color: "#112233", usageCount: 2 },
    { id: ids.foreignTag, householdId: b, name: "FOREIGN tag", color: "#332211", usageCount: 0 },
  ]);
  await db.insert(transactionTags).values([{ transactionId: ids.privateTx, tagId: ids.tag }, { transactionId: ids.sharedTx, tagId: ids.tag }]);
}
export const get = (path: string, role: Role | "outsider" = "member") => request(app).get(`/api/tags${path}`).set("Cookie", actors.get(role)!.cookie);
export async function snapshot() {
  return {
    tags: await db.select().from(tags).where(inArray(tags.householdId, [a, b])).orderBy(tags.id),
    links: await db.select().from(transactionTags).innerJoin(transactions, eq(transactionTags.transactionId, transactions.id))
      .where(inArray(transactions.householdId, [a, b])).orderBy(transactionTags.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, [a, b])).orderBy(accounts.id),
    audit: await db.select().from(auditLogs).where(inArray(auditLogs.userId, [...actors.values()].map(({ id }) => id))).orderBy(auditLogs.id),
  };
}
export async function stop() {
  await db.delete(transactions).where(inArray(transactions.householdId, [a, b]));
  await db.delete(auditLogs).where(inArray(auditLogs.userId, [...actors.values()].map(({ id }) => id)));
  await db.delete(households).where(inArray(households.id, [a, b]));
  for (const { id } of actors.values()) {
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
    await db.delete(users).where(eq(users.id, id));
  }
}
