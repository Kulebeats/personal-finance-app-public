const request = require('supertest');
const { getTestApp } = require('./__tests__/fixtures');
const { db } = require('./db');
const { users, households, householdMembers } = require('../shared/schema');
const { hashPassword } = require('./auth');

async function test() {
  const app = await getTestApp();
  const timestamp = Date.now();
  const passwordHash = await hashPassword("TestPassword123");

  // Create household
  const [household] = await db
    .insert(households)
    .values({ name: `Test ${timestamp}`, currency: "ZMW" })
    .returning();

  // Create user
  const [user] = await db
    .insert(users)
    .values({
      email: `test-${timestamp}@test.com`,
      username: `test-${timestamp}`,
      passwordHash,
      emailVerified: true,
    })
    .returning();

  // Add to household
  await db.insert(householdMembers).values({
    householdId: household.id,
    userId: user.id,
    role: "owner",
  });

  console.log("Created user:", user.id);
  console.log("Created household:", household.id);

  // Login
  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({ email: `test-${timestamp}@test.com`, password: "TestPassword123" });

  console.log("Login status:", loginRes.status);
  console.log("Login body:", loginRes.body);
  console.log("Set-Cookie header:", loginRes.headers["set-cookie"]);

  const cookie = loginRes.headers["set-cookie"]
    ? loginRes.headers["set-cookie"].join("; ")
    : "";
  
  console.log("Joined cookie:", cookie);

  // Try a protected route
  const testRes = await request(app)
    .get("/api/weekly-recap")
    .set("Cookie", cookie);

  console.log("Protected route status:", testRes.status);
  console.log("Protected route body:", testRes.body);

  process.exit(0);
}

test().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
