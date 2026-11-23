// This must run through client/vitest.config.ts: its jsdom/Vite transform
// previously treated the server guard's empty dotenv fixture as a web asset.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { expect, it } from "vitest";
import { prepareTestEnvironment } from "../../../server/testing/test-target.mjs";

it("retains an absolute empty dotenv fixture and disabled database/provider access in the client worker", () => {
  const env = {
    PFA_TEST_MODE: "unit",
    DATABASE_URL: "postgresql://synthetic@127.0.0.1:5432/finance_app",
    GEMINI_API_KEY: "synthetic-sentinel",
    SMTP_HOST: "mail.example.invalid",
  } as NodeJS.ProcessEnv;
  prepareTestEnvironment(env);
  expect(path.isAbsolute(env.DOTENV_CONFIG_PATH!)).toBe(true);
  expect(parse(readFileSync(env.DOTENV_CONFIG_PATH!, "utf8"))).toEqual({});
  expect(env.DATABASE_URL).toContain(":1/pfa_unit_database_disabled");
  expect(env.GEMINI_API_KEY).toBe("");
  expect(env.SMTP_HOST).toBe("");
  expect(env.PFA_TEST_OUTBOUND).toBe("deny");
});
