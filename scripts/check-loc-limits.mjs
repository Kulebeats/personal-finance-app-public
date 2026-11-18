/**
 * LOC limit guard (CLAUDE.md Rule 2 / Rule 15).
 *
 * WHY THIS EXISTS
 * ---------------
 * Rule 2 originally named only `server/routes/`, `server/services/`, and
 * `server/modules/*\/controller.ts`. The P4 modular refactor moved most code to
 * `server/modules/{domain}/{domain}.service.ts` (and friends), which that
 * wording never covered — so the limit went unenforced across most of the
 * server. An audit on 2026-07-20 found 23 server files over 500 LOC while a
 * literal-scope reading found only 5.
 *
 * RATCHET SEMANTICS
 * -----------------
 * Widening the scope surfaces every pre-existing violation at once. Failing on
 * all of them would make the guard something people switch off, so instead:
 *
 *   - Files already over the limit are recorded in the baseline and tolerated.
 *   - A file NOT in the baseline that exceeds its limit => FAIL (new debt).
 *   - A baselined file that GROWS beyond its recorded size => FAIL (debt got
 *     worse — this is the case that caught ai.service.ts going 740 -> 891).
 *   - A baselined file that shrinks is reported so the baseline can be
 *     tightened via `--update`; it never fails the build.
 *
 * The baseline is a debt register, not a permission slip: every entry is a file
 * that should eventually be split.
 *
 * Usage:
 *   node scripts/check-loc-limits.mjs            # verify (used by npm run check)
 *   node scripts/check-loc-limits.mjs --update   # rewrite the baseline
 */
import { promises as fs } from "fs";
import path from "path";

const rootDir = process.cwd();
const baselinePath = path.join(rootDir, "scripts", "loc-baseline.json");

const SERVER_LIMIT = 500;
const MODULE_ROUTES_LIMIT = 100; // Rule 15: {domain}.routes.ts is router glue only
const CLIENT_COMPONENT_LIMIT = 300;

const normalize = (p) => p.replace(/\\/g, "/");

/** Directories we never police: deps, build output, agent worktrees, coverage. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".local",
  ".claude",
  ".git",
  "__tests__",
  "__mocks__",
]);

const isTestFile = (name) =>
  /\.(test|spec|property\.test)\.(ts|tsx)$/.test(name) ||
  name.endsWith(".d.ts");

/**
 * Resolve the limit for a file, or null if the file is out of scope.
 * Scope is defined by what the file IS, not by which directory it happens to
 * live in — that directory-shaped assumption is exactly what went stale.
 */
function limitFor(relPath) {
  if (relPath.startsWith("server/")) {
    // Module routers are glue: Rule 15 caps them far lower than other files.
    if (/^server\/modules\/[^/]+\/[^/]*routes\.ts$/.test(relPath)) {
      return { limit: MODULE_ROUTES_LIMIT, kind: "module route" };
    }
    if (!relPath.endsWith(".ts")) return null;
    return { limit: SERVER_LIMIT, kind: "server file" };
  }

  // Client: components only (.tsx). Plain .ts helpers are not size-capped.
  if (relPath.startsWith("client/src/") && relPath.endsWith(".tsx")) {
    return { limit: CLIENT_COMPONENT_LIMIT, kind: "client component" };
  }

  return null;
}

async function walk(dir, acc = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), acc);
    } else if (!isTestFile(entry.name)) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

async function collect() {
  const files = [
    ...(await walk(path.join(rootDir, "server"))),
    ...(await walk(path.join(rootDir, "client", "src"))),
  ];

  const measured = [];
  for (const file of files) {
    const rel = normalize(path.relative(rootDir, file));
    const scope = limitFor(rel);
    if (!scope) continue;
    const contents = await fs.readFile(file, "utf8");
    const loc = contents.split("\n").length;
    if (loc > scope.limit) {
      measured.push({ path: rel, loc, limit: scope.limit, kind: scope.kind });
    }
  }
  return measured.sort((a, b) => a.path.localeCompare(b.path));
}

async function readBaseline() {
  try {
    const raw = await fs.readFile(baselinePath, "utf8");
    return JSON.parse(raw.replace(/^﻿/, ""));
  } catch {
    return { files: {} };
  }
}

async function writeBaseline(violations) {
  const files = {};
  for (const v of violations) files[v.path] = v.loc;
  const payload = {
    _comment:
      "Debt register for CLAUDE.md Rule 2 LOC limits. Every entry is a file that " +
      "should eventually be split. New violations fail the build; baselined files " +
      "may shrink but never grow. Regenerate with: node scripts/check-loc-limits.mjs --update",
    generatedAt: new Date().toISOString().slice(0, 10),
    files,
  };
  await fs.writeFile(baselinePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function main() {
  const shouldUpdate = process.argv.includes("--update");
  const violations = await collect();

  if (shouldUpdate) {
    await writeBaseline(violations);
    console.log(
      `LOC baseline updated: ${violations.length} file(s) recorded as known debt.`
    );
    return;
  }

  const baseline = (await readBaseline()).files ?? {};
  const newViolations = [];
  const grown = [];
  const shrunk = [];

  for (const v of violations) {
    const baselined = baseline[v.path];
    if (baselined === undefined) newViolations.push(v);
    else if (v.loc > baselined) grown.push({ ...v, was: baselined });
    else if (v.loc < baselined) shrunk.push({ ...v, was: baselined });
  }

  if (newViolations.length > 0) {
    console.error(
      `\nLOC limit exceeded by ${newViolations.length} file(s) not in the baseline:`
    );
    for (const v of newViolations) {
      console.error(
        `  ${v.path} — ${v.loc} lines (${v.kind} limit ${v.limit}, over by ${v.loc - v.limit})`
      );
    }
    console.error("\nSplit the file (CLAUDE.md Rule 3 has the patterns).");
  }

  if (grown.length > 0) {
    console.error(`\n${grown.length} known-oversized file(s) grew further:`);
    for (const v of grown) {
      console.error(`  ${v.path} — ${v.was} -> ${v.loc} lines (limit ${v.limit})`);
    }
    console.error(
      "\nThese are already over the limit; adding to them deepens the debt. " +
        "Extract instead, or split as part of this change."
    );
  }

  if (newViolations.length > 0 || grown.length > 0) {
    process.exit(1);
  }

  if (shrunk.length > 0) {
    console.log(`LOC guard: ${shrunk.length} baselined file(s) shrank — nice.`);
    for (const v of shrunk) {
      console.log(`  ${v.path} — ${v.was} -> ${v.loc}`);
    }
    console.log("Run `node scripts/check-loc-limits.mjs --update` to lock in the gains.");
  }

  console.log(
    `LOC limit check passed: ${violations.length} known oversized file(s), 0 new, 0 grown.`
  );
}

main().catch((error) => {
  console.error("LOC limit guard failed:", error);
  process.exit(1);
});
