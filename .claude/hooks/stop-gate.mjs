#!/usr/bin/env node
// Stop hook: block the agent from ending its turn while the repo is red.
// Runs the type check (always) and the fast pure-logic core tests (no DB needed).
// Cross-platform: works in the Claude desktop app on Windows, in WSL, and in CI,
// because it invokes node-resolved npm scripts rather than a shell-specific .sh.
// Set REMEDIATION_GATE=off to bypass during a deliberate exploratory session.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

if (process.env.REMEDIATION_GATE === "off") process.exit(0);
if (!existsSync("package.json")) process.exit(0); // not at project root; do not block

function block(msg) {
  // Exit code 2 tells Claude Code to block the Stop and feed stderr back to the agent.
  process.stderr.write(`STOP BLOCKED by Definition of Done gate: ${msg}\n`);
  process.stderr.write("Fix the above, or set REMEDIATION_GATE=off for a deliberate exploratory session.\n");
  process.exit(2);
}

function run(cmd, label) {
  try {
    execSync(cmd, { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    const tail = (e.stderr?.toString() || e.stdout?.toString() || "").split("\n").slice(-15).join("\n");
    block(`${label} failed.\n${tail}`);
  }
}

run("npm run check", "npm run check (type + storage-import guard)");
// Fast, DB-free correctness tests. Adjust the path to your repo if it differs.
run("npx vitest run server/core/calculations --reporter=dot", "core/calculations tests (budget, goals, shadow_mode)");
process.exit(0);
