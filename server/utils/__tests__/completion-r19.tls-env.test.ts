import { expect, it } from "vitest";
import { validateEnv } from "../validateEnv";

const production = { NODE_ENV: "production", DATABASE_URL: "postgresql://synthetic@db.example.invalid/db",
  SESSION_SECRET: "synthetic-session-secret-not-real-use", CLIENT_URL: "https://app.example.invalid",
  APP_URL: "https://app.example.invalid", REDIS_URL: "rediss://redis.example.invalid:6380",
  CRON_SECRET: "synthetic-cron-secret-not-real-use" };

it.each([{ DATABASE_SSL: "false" }, { DATABASE_SSL_REJECT_UNAUTHORIZED: "false" },
  { DATABASE_URL: `${production.DATABASE_URL}?sslmode=no-verify` }])("refuses insecure production configuration %j", (override) => {
  const result = validateEnv({ ...production, ...override });
  expect(result.success).toBe(false);
  expect(result.errors?.map((error) => error.variable)).toEqual(Object.keys(override));
});

it("accepts verified production defaults and explicit protected local test mode", () => {
  expect(validateEnv(production).success).toBe(true);
  expect(validateEnv({ DATABASE_URL: "postgresql://synthetic@127.0.0.1:55432/pfa_fixture_test",
    NODE_ENV: "test", PFA_TEST_MODE: "database", SESSION_SECRET: production.SESSION_SECRET }).success).toBe(true);
});
