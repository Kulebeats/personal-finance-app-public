import request from 'supertest';
import { getTestApp } from './__tests__/fixtures.js';
import { db } from './db.js';
import { users, households, householdMembers } from '../shared/schema.js';
import { hashPassword } from './auth/index.js';

const timestamp = Date.now();

const app = await getTestApp();
const passwordHash = await hashPassword("TestPassword123");

const [household] = await db
  .insert(households)
  .values({ name: `Test ${timestamp}`, currency: "ZMW" })
  .returning();

const [user] = await db
  .insert(users)
  .values({
    email: `test-${timestamp}@test.com`,
    username: `test-${timestamp}`,
    passwordHash,
    emailVerified: true,
  })
  .returning();

await db.insert(householdMembers).values({
  householdId: household.id,
  userId: user.id,
  role: "owner",
});

console.log("User ID:", user.id);
console.log("Household ID:", household.id);

const loginRes = await request(app)
  .post("/api/auth/login")
  .send({ email: `test-${timestamp}@test.com`, password: "TestPassword123" });

console.log("Login status:", loginRes.status);
console.log("Login body:", JSON.stringify(loginRes.body, null, 2));

const cookie = loginRes.headers["set-cookie"]
  ? loginRes.headers["set-cookie"].join("; ")
  : "";

console.log("Cookie:", cookie.substring(0, 100));

const csrfRes = await request(app)
  .get("/api/csrf-token")
  .set("Cookie", cookie);

console.log("CSRF status:", csrfRes.status);
console.log("CSRF body:", JSON.stringify(csrfRes.body, null, 2));

const csrfToken = csrfRes.body.csrfToken;

const testRes = await request(app)
  .post("/api/weekly-recap/feedback")
  .set("Cookie", cookie)
  .set("X-CSRF-Token", csrfToken)
  .send({
    weekStart: "2024-01-01",
    weekEnd: "2024-01-07",
    step: "spending",
    feedback: "positive",
  });

console.log("POST status:", testRes.status);
console.log("POST body:", JSON.stringify(testRes.body, null, 2));

// Cleanup
await db.delete(householdMembers).where({ householdId: household.id });
await db.delete(households).where({ id: household.id });
await db.delete(users).where({ id: user.id });

process.exit(0);
