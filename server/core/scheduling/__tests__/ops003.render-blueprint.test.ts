/**
 * OPS-003: the Render blueprint (render.yaml), parsed rather than matched by
 * substring (scripts/verify-deploy-readiness.mjs), agrees with the code it
 * deploys. The blueprint's single web service runs every catalogued job
 * in-process (no Render cron or worker service), with the scheduler switched
 * on and CRON_SECRET generated, and its deploy health check is the app's
 * database-gated readiness probe.
 */
import { readFileSync } from "node:fs";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config/session-store", async () => {
  const { default: library } = await import("express-session");
  return { sessionStore: new library.MemoryStore() };
});
vi.mock("../../../db", () => ({ pool: { query: vi.fn().mockRejectedValue(new Error("synthetic DB outage")) } }));
vi.mock("../../../config/redis", () => ({ redis: null, productionRedis: null, assertRequiredJobCapabilities: vi.fn() }));
vi.mock("../../../routes", () => ({ registerRoutes: vi.fn() }));
vi.mock("../../../startup", () => ({ initializeServices: vi.fn() }));
vi.mock("../../../auth", () => ({
  attachUser: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../../../middleware/householdGuard", () => ({ householdGuard: (_req: Request, _res: Response, next: NextFunction) => next() }));
vi.mock("../../../middleware/uploadsAuth", () => ({ serveUpload: vi.fn() }));

import { app } from "../../../app";
import { parseBlockYaml, type YamlMap, type YamlValue } from "../../../testing/blueprint-yaml";
import { SCHEDULED_JOB_SPECS } from "../jobCatalog";
import { isSchedulerEnabled } from "../schedulerConfig";

function asMap(value: YamlValue | undefined, where: string): YamlMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${where} is not a mapping`);
  return value as YamlMap;
}

function asList(value: YamlValue | undefined, where: string): readonly YamlValue[] {
  if (!Array.isArray(value)) throw new Error(`${where} is not a list`);
  return value;
}

const blueprint = asMap(parseBlockYaml(readFileSync(new URL("../../../../render.yaml", import.meta.url), "utf8")), "render.yaml");
const services = asList(blueprint.services, "services").map((service, index) => asMap(service, `services[${index}]`));
const webServices = services.filter((service) => service.type === "web");
const web = webServices[0];
const envVars = asList(web?.envVars, "web envVars").map((entry, index) => asMap(entry, `envVars[${index}]`));

/** A quoted or plain string value: Render reads env values as strings, so a plain `true` is a mismatch. */
function text(value: YamlValue | undefined, where: string): string {
  if (typeof value !== "string") throw new Error(`${where} is not a string: ${JSON.stringify(value)}`);
  return value;
}

function envVar(key: string): YamlMap {
  const matches = envVars.filter((entry) => entry.key === key);
  if (matches.length !== 1) throw new Error(`expected one ${key} env var, found ${matches.length}`);
  return matches[0];
}

describe("render.yaml declares the deployment the scheduler and readiness code expect (OPS-003)", () => {
  it("has exactly one web service, on one instance", () => {
    expect(webServices).toHaveLength(1);
    expect(web.numInstances).toBe(1);
  });

  it("declares no Render cron or worker service: the web service runs every catalogued job in-process", () => {
    expect(services.map((service) => service.type)).toEqual(["web", "keyvalue"]);
    expect(SCHEDULED_JOB_SPECS.length).toBeGreaterThan(0);
    const env = {
      NODE_ENV: text(envVar("NODE_ENV").value, "NODE_ENV"),
      SCHEDULER_ENABLED: text(envVar("SCHEDULER_ENABLED").value, "SCHEDULER_ENABLED"),
    };
    expect(env).toEqual({ NODE_ENV: "production", SCHEDULER_ENABLED: "true" });
    expect(isSchedulerEnabled(env)).toBe(true);
  });

  it("generates CRON_SECRET, which production refuses to start without, and leaves the cron door mounted", () => {
    expect(envVar("CRON_SECRET")).toEqual({ key: "CRON_SECRET", generateValue: true });
    expect(envVars.some((entry) => entry.key === "CRON_HTTP_ENABLED")).toBe(false);
  });

  it("checks deploy health on the readiness probe, which fails while the database is down and liveness stays up", async () => {
    const path = web.healthCheckPath;
    expect(path).toBe("/health/ready");

    expect((await request(app).get(String(path))).status).toBe(503);
    expect((await request(app).get("/health/live")).status).toBe(200);
  });
});

describe("the blueprint parser fails closed outside its subset", () => {
  it("keeps quoted and plain scalars distinct", () => {
    expect(parseBlockYaml('a: "true"\nb: true\nc: 1\nd: "1"\ne: https://x.test/a#b # note')).toEqual({
      a: "true", b: true, c: 1, d: "1", e: "https://x.test/a#b",
    });
  });

  it("reads a sequence of mappings and of scalars", () => {
    expect(parseBlockYaml("list:\n  - key: A\n    value: one\n  - plain\n")).toEqual({ list: [{ key: "A", value: "one" }, "plain"] });
  });

  it.each([
    ["a flow sequence", "a: [1, 2]"],
    ["a flow mapping", "a: { b: 1 }"],
    ["an anchor", "a: &anchor 1"],
    ["an alias", "a: *anchor"],
    ["a block scalar", "a: |\n  text"],
    ["a duplicate key", "a: 1\na: 2"],
    ["tab indentation", "a:\n\tb: 1"],
    ["a second document", "a: 1\n---\nb: 2"],
    ["an escape", 'a: "x\\ny"'],
    ["an ambiguous plain value", "a: yes"],
    ["a key with no value", "a:\nb: 1"],
    ["stray indentation", "a: 1\n  b: 2"],
  ])("rejects %s", (_name, source) => {
    expect(() => parseBlockYaml(source)).toThrow();
  });
});
