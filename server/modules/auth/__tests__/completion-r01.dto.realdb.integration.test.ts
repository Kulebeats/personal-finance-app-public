import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { users, households, householdMembers } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { authEmailService } from "../auth.email.service";
import { authMfaService } from "../auth.mfa.service";
import type { HouseholdMemberDto } from "@shared/household-members";

// Independently specified response contracts, not imported implementation keys.
const publicKeys = ["id", "username", "email", "emailVerified", "fullName", "firstName", "lastName", "displayName", "timezone", "profilePictureUrl", "bannerUrl", "bio", "createdAt", "lastLoginAt", "mfaEnabled", "mfaMethod"].sort();
const profileKeys = [...publicKeys, "birthday", "birthdayHideYear", "gender", "phoneNumberMobile", "phoneNumberWork", "phoneNumberHome", "address", "occupation", "occupationCustom", "company", "socialLinks", "nrc", "annualIncome", "incomeFrequency", "employmentStatus", "investmentGoal", "riskTolerance", "profileCompleteness", "updatedAt"].sort();
// AH-05 flat member DTO. Owners and admins also get email. The list is written
// out here, and the type check below fails the build if it drifts from
// shared/household-members.ts in either direction.
const managerMemberKeyList = ["email", "joinedAt", "name", "role", "userId"] as const satisfies readonly (keyof HouseholdMemberDto)[];
const memberKeysCoverDto: Exclude<keyof HouseholdMemberDto, (typeof managerMemberKeyList)[number]> extends never ? true : never = true;
void memberKeysCoverDto;
const memberKeys = managerMemberKeyList.filter((key) => key !== "email").sort();
const password = "SyntheticDtoPassword123!";
const secret = "r01-credential-sentinel";
const ids: string[] = [];
const householdId = randomUUID();
let app: Awaited<ReturnType<typeof getTestApp>>;
let owner: { id: string; email: string; cookie: string };
let member: typeof owner;

function assertKeys(value: Record<string, unknown>, keys: string[]) {
  expect(Object.keys(value).sort()).toEqual(keys);
  expect(JSON.stringify(value).includes(secret)).toBe(false);
}
async function login(email: string) {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { response, cookie: (response.headers["set-cookie"] as unknown as string[]).join("; ") };
}
async function fixture(role: "owner" | "member") {
  const id = randomUUID(), email = `r01-dto-${id}@example.invalid`;
  await db.insert(users).values({
    id, email, username: `dto-${id}`, passwordHash: await hashPassword(password), emailVerified: true,
    fullName: "Synthetic DTO", emailVerificationToken: secret, emailVerificationExpiry: new Date(Date.now() + 3600000),
    pendingEmail: "r01-private-pending@example.invalid", mfaCode: secret, mfaCodeExpiry: new Date(Date.now() + 3600000),
    mfaBackupCodes: [secret], mfaBackupCodesGeneratedAt: new Date(), failedLoginAttempts: 1, lastFailedLoginAt: new Date(),
    nrc: "R01PrivateNRC", annualIncome: "123.45", phoneNumberMobile: "+260970000001",
    address: { street: "Synthetic private street" }, socialLinks: { website: "https://example.invalid/profile" },
  });
  ids.push(id);
  await db.insert(householdMembers).values({ userId: id, householdId, role });
  return { id, email, cookie: (await login(email)).cookie };
}

describe("R01 purpose-specific HTTP DTOs", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic R01 DTO" });
    owner = await fixture("owner");
    member = await fixture("member");
  });
  afterAll(async () => {
    for (const id of ids) await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1 OR sess->>\'mfaPendingUserId\' = $1', [id]);
    await db.delete(households).where(eq(households.id, householdId));
    for (const id of ids) await db.delete(users).where(eq(users.id, id));
    vi.restoreAllMocks();
  });
  it("register returns the public contract without its persisted verification hash", async () => {
    const id = randomUUID(), email = `r01-register-${id}@example.invalid`;
    const mail = vi.spyOn(authEmailService, "sendVerificationEmail").mockResolvedValue(undefined);
    try {
      const response = await request(app).post("/api/auth/register").send({ email, username: `dto-${id}`, password }).expect(201);
      ids.push(response.body.data.user.id);
      const [stored] = await db.select().from(users).where(eq(users.id, response.body.data.user.id));
      expect(Boolean(stored.emailVerificationToken)).toBe(true);
      assertKeys(response.body.data.user, publicKeys);
      expect(JSON.stringify(response.body).includes(stored.emailVerificationToken!)).toBe(false);
    } finally { mail.mockRestore(); }
  });
  it("password login returns only public identity fields", async () => {
    assertKeys((await login(owner.email)).response.body.data.user, publicKeys);
  });
  it("current-user response excludes credential and private-profile sentinels", async () => {
    const response = await request(app).get("/api/auth/me").set("Cookie", owner.cookie).expect(200);
    assertKeys(response.body.data.user, publicKeys);
    expect(JSON.stringify(response.body).includes("R01PrivateNRC")).toBe(false);
  });
  it("MFA completion returns only public identity fields", async () => {
    const code = vi.spyOn(authMfaService, "generateMfaCode").mockReturnValue("123456");
    await db.update(users).set({ mfaEnabled: true, mfaMethod: "email" }).where(eq(users.id, owner.id));
    try {
      const pending = await login(owner.email);
      expect(pending.response.body.data.requiresMfa).toBe(true);
      const response = await request(app).post("/api/auth/mfa/verify").set("Cookie", pending.cookie).send({ code: "123456" }).expect(200);
      assertKeys(response.body.data.user, publicKeys);
    } finally {
      code.mockRestore();
      await db.update(users).set({ mfaEnabled: false }).where(eq(users.id, owner.id));
    }
  });
  it.each(["get", "put"] as const)("own-profile %s allows approved private profile fields without authentication material", async (method) => {
    const req = request(app)[method]("/api/settings/profile").set("Cookie", owner.cookie);
    const response = await (method === "put" ? req.send({ fullName: "Synthetic DTO Updated" }) : req).expect(200);
    assertKeys(response.body.data.profile, profileKeys);
    expect(response.body.data.profile.nrc).toBe("R01PrivateNRC");
    expect(response.body.data.profile.annualIncome).toBe("123.45");
  });
  it("picture upload and removal use the same own-profile DTO", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    try {
      const response = await request(app).post("/api/settings/profile/picture").set("Cookie", owner.cookie).attach("picture", png, { filename: "synthetic.png", contentType: "image/png" }).expect(200);
      assertKeys(response.body.data.profile, profileKeys);
    } finally {
      const response = await request(app).delete("/api/settings/profile/picture").set("Cookie", owner.cookie).expect(200);
      assertKeys(response.body.data.profile, profileKeys);
    }
  });
  it.each(["owner", "member"] as const)("%s member listing uses an exact purpose allowlist", async (role) => {
    const actor = role === "owner" ? owner : member;
    const response = await request(app).get("/api/household/members").set("Cookie", actor.cookie).expect(200);
    expect(response.body.data.members).toHaveLength(2);
    for (const value of response.body.data.members) assertKeys(value, role === "owner" ? [...managerMemberKeyList].sort() : memberKeys);
    expect(JSON.stringify(response.body).includes("R01PrivateNRC")).toBe(false);
  });
});
