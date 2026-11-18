#!/usr/bin/env node
// PreToolUse (Write|Edit): block raw float money math in financial code paths.
// Drizzle returns `decimal` columns as strings, so the live risk is parseFloat/Number
// on an amount then arithmetic. This guard stops those patterns entering high-risk files.
//
// PRECISION FIX (2026-07-20): the previous version scanned the whole file body with
// `[^;]*` spans, which cross newlines. That produced false positives on PROSE — a
// JSDoc containing the word "amount", a `*` line marker, and any word containing the
// letters r-a-t-e (delibe.., sepa.., accu.., st..gy) matched the amount/rate patterns
// and blocked a pure refactor three times during the ImportService split. Now:
//   1. matching is LINE BY LINE, so a span cannot straddle a comment block, and
//   2. comment-only lines and trailing line comments are skipped, since a comment
//      cannot execute float math.
// Detection of real violations is UNCHANGED; `npm run test:hooks:money` proves both
// directions (real patterns still blocked, prose no longer blocked).
import { readFileSync } from "node:fs";

// A line is comment-only when it starts with //, *, or /* (JSDoc bodies included).
const isCommentLine = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

// Anchored within a single line: [^;\n] cannot cross into neighbouring prose.
const BAD_PATTERNS = [
  /\.toFixed\(/i,
  /parseFloat\(/i,
  /Number\([^)]*amount/i,
  /amount[^;\n]*\*[^;\n]*rate/i,
  /rate[^;\n]*\*[^;\n]*amount/i,
];

/** Exported for the self-test. Returns [{line, text}] for offending code lines. */
export function findMoneyFloatViolations(content) {
  const offending = [];
  content.split("\n").forEach((line, index) => {
    if (isCommentLine(line)) return;
    const code = line.replace(/\/\/.*$/, "");
    if (BAD_PATTERNS.some((pattern) => pattern.test(code))) {
      offending.push({ line: index + 1, text: line.trim().slice(0, 100) });
    }
  });
  return offending;
}

export const isMoneyPath = (file) =>
  /(server[\/\\]services|server[\/\\]routes[\/\\]grz|core[\/\\]calculations|currency|budget|Money)/i.test(
    file,
  );

// Running as a hook (stdin payload) rather than being imported by the self-test.
if (process.argv[1] && process.argv[1].endsWith("block-money-floats.mjs")) {
  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const ti = payload.tool_input || {};
  const file = String(ti.file_path || ti.path || "");
  const content = String(ti.content ?? ti.new_string ?? ti.new_str ?? "");

  if (!isMoneyPath(file) || !content) process.exit(0);

  const offending = findMoneyFloatViolations(content);
  if (offending.length > 0) {
    process.stderr.write(
      `BLOCKED: raw float money pattern in a financial path (${file}).\n`,
    );
    for (const o of offending) {
      process.stderr.write(`  line ${o.line}: ${o.text}\n`);
    }
    process.stderr.write(
      "Use the Money class and sumMoneyDto. No parseFloat / Number(amount) / .toFixed / amount*rate.\n",
    );
    process.stderr.write("See .claude/skills/money-correctness/SKILL.md\n");
    process.exit(2);
  }
  process.exit(0);
}
