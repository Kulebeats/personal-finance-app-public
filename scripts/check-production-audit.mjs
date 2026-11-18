#!/usr/bin/env node
/**
 * Production dependency audit gate.
 *
 * Runs `npm audit --omit=dev` and fails on every advisory that is not listed in
 * scripts/production-audit-exceptions.json. An exception names one advisory,
 * says why it is accepted, and carries an expiry date. The gate also fails when
 * an exception has expired or is no longer needed, so the list cannot rot.
 *
 * Usage:  node scripts/check-production-audit.mjs
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXCEPTIONS_URL = new URL("./production-audit-exceptions.json", import.meta.url);
const ADVISORY_ID = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AUDIT_OUTPUT_BYTES = 64 * 1024 * 1024;

function advisoryId(source) {
  const match = ADVISORY_ID.exec(String(source.url ?? ""));
  return match ? match[0].toUpperCase() : `UNIDENTIFIED:${source.name}:${source.title}`;
}

/** Collect each distinct advisory the audit report names, with the packages it reaches. */
export function collectAdvisories(report) {
  const advisories = new Map();
  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    for (const source of vulnerability.via ?? []) {
      if (typeof source !== "object" || source === null) continue;
      const id = advisoryId(source);
      const known = advisories.get(id);
      if (known) {
        known.packages.add(packageName);
        continue;
      }
      advisories.set(id, {
        id,
        severity: source.severity ?? vulnerability.severity ?? "unknown",
        title: source.title ?? "(no title)",
        url: source.url ?? "",
        packages: new Set([packageName]),
      });
    }
  }
  return [...advisories.values()];
}

export function validateExceptions(exceptions) {
  if (!Array.isArray(exceptions)) throw new Error("Audit exceptions must be a JSON array");
  for (const exception of exceptions) {
    for (const field of ["advisory", "package", "reason", "approvedBy", "approvedOn", "expires"]) {
      if (typeof exception[field] !== "string" || exception[field].trim() === "") {
        throw new Error(`Audit exception is missing "${field}": ${JSON.stringify(exception)}`);
      }
    }
    if (!ADVISORY_ID.test(exception.advisory)) {
      throw new Error(`Audit exception has an invalid advisory id: ${exception.advisory}`);
    }
    if (!ISO_DATE.test(exception.expires) || !ISO_DATE.test(exception.approvedOn)) {
      throw new Error(`Audit exception dates must be YYYY-MM-DD: ${exception.advisory}`);
    }
  }
  return exceptions;
}

/**
 * Decide which advisories block. `today` is a YYYY-MM-DD string; ISO dates
 * compare correctly as strings.
 */
export function evaluateAudit(report, exceptions, today) {
  const byAdvisory = new Map(exceptions.map((exception) => [exception.advisory.toUpperCase(), exception]));
  const blocking = [];
  const accepted = [];
  const expired = [];
  const reported = new Set();
  for (const advisory of collectAdvisories(report)) {
    reported.add(advisory.id);
    const exception = byAdvisory.get(advisory.id);
    if (!exception) {
      blocking.push(advisory);
    } else if (exception.expires < today) {
      expired.push({ advisory, exception });
    } else {
      accepted.push({ advisory, exception });
    }
  }
  const unused = exceptions.filter((exception) => !reported.has(exception.advisory.toUpperCase()));
  const passed = blocking.length === 0 && expired.length === 0 && unused.length === 0;
  return { passed, blocking, accepted, expired, unused };
}

function runNpmAudit() {
  const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    maxBuffer: MAX_AUDIT_OUTPUT_BYTES,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  // npm exits non-zero when it finds advisories; the JSON on stdout is still the report.
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit did not return JSON (exit ${result.status}): ${result.stderr.slice(0, 500)}`);
  }
  if (report.error) throw new Error(`npm audit failed: ${JSON.stringify(report.error).slice(0, 500)}`);
  return report;
}

function describe(advisory) {
  return `${advisory.id} [${advisory.severity}] ${[...advisory.packages].sort().join(", ")}: ${advisory.title} ${advisory.url}`;
}

function main() {
  const exceptions = validateExceptions(JSON.parse(readFileSync(EXCEPTIONS_URL, "utf8")));
  const today = new Date().toISOString().slice(0, 10);
  const outcome = evaluateAudit(runNpmAudit(), exceptions, today);

  for (const { advisory, exception } of outcome.accepted) {
    console.log(`ACCEPTED until ${exception.expires}: ${describe(advisory)}`);
    console.log(`  reason: ${exception.reason}`);
  }
  for (const advisory of outcome.blocking) {
    console.error(`BLOCKING: ${describe(advisory)}`);
  }
  for (const { advisory, exception } of outcome.expired) {
    console.error(`EXCEPTION EXPIRED on ${exception.expires}: ${describe(advisory)}`);
  }
  for (const exception of outcome.unused) {
    console.error(`EXCEPTION NO LONGER NEEDED, remove it: ${exception.advisory} (${exception.package})`);
  }

  if (!outcome.passed) {
    console.error("Production dependency audit failed.");
    process.exit(1);
  }
  console.log(`Production dependency audit passed (${outcome.accepted.length} accepted exception(s)).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
