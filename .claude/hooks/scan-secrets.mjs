#!/usr/bin/env node
// PreToolUse (Bash): before a git commit, scan staged content for obvious secrets.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const cmd = String((payload.tool_input || {}).command || "");
if (!/git\s+commit/.test(cmd)) process.exit(0);

let staged = "";
try { staged = execSync("git diff --cached", { encoding: "utf8" }); } catch { process.exit(0); }

const secret = /AIza[0-9A-Za-z_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|GEMINI_API_KEY\s*=\s*["']?[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9]{20,}/;
if (secret.test(staged)) {
  process.stderr.write("BLOCKED: a possible secret is staged for commit.\n");
  process.stderr.write("Move it to an environment variable and unstage it before committing.\n");
  process.exit(2);
}
process.exit(0);
