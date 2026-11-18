#!/usr/bin/env node
// PreToolUse (Write|Edit): block new `as any`, `: any`, and `@ts-ignore` in TS/TSX.
import { readFileSync } from "node:fs";

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const ti = payload.tool_input || {};
const file = String(ti.file_path || ti.path || "");
const content = String(ti.content ?? ti.new_string ?? ti.new_str ?? "");

if (!/\.(ts|tsx)$/.test(file) || !content) process.exit(0);

if (/\bas any\b|:\s*any\b|@ts-ignore/.test(content)) {
  process.stderr.write(`BLOCKED: new 'as any' / ': any' / '@ts-ignore' in ${file}.\n`);
  process.stderr.write("Type it properly. The audit found type escapes hiding real contract drift.\n");
  process.exit(2);
}
process.exit(0);
