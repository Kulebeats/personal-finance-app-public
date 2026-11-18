import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_TEMPLATE = path.join(
  ROOT,
  "docs",
  "reviews",
  "production-readiness-w9-smoke-evidence-template-2026-07-07.md",
);
const ISO_DATE_IN_NAME_PATTERN = /\d{4}-\d{2}-\d{2}/;

function readArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function usage() {
  return [
    "Usage:",
    "  npm run check:w9-evidence -- --file docs/reviews/<completed-w9-evidence>.md",
    "",
    "Options:",
    "  --file <path>      Completed W9 smoke evidence file to validate.",
    "  --template <path>  Optional template path. Defaults to the tracked W9 template.",
  ].join("\n");
}

function readPositionalFile() {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const previous = args[index - 1];
    if (!arg || arg.startsWith("--")) continue;
    if (previous === "--template" || previous === "--file") continue;
    return arg;
  }
  return null;
}

function comparablePath(filePath) {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isSamePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function validateEvidenceFileName(evidencePath) {
  const fileName = path.basename(evidencePath);

  if (path.extname(fileName).toLowerCase() !== ".md") {
    throw new Error("Completed W9 evidence must be saved as a Markdown file.");
  }

  if (!ISO_DATE_IN_NAME_PATTERN.test(fileName)) {
    throw new Error("Completed W9 evidence file name must include a YYYY-MM-DD date.");
  }
}

function normalizeCell(value) {
  return value.replace(/\\\|/g, "|").replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function parseTableRows(text) {
  const rows = [];
  let currentHeaders = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) {
      currentHeaders = null;
      continue;
    }

    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map(normalizeCell);

    const isSeparator = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
    if (isSeparator) continue;

    if (!currentHeaders) {
      currentHeaders = cells;
      continue;
    }

    if (cells.length !== currentHeaders.length) {
      rows.push({
        key: cells[0] ?? "",
        headers: currentHeaders,
        cells,
        malformed: true,
      });
      continue;
    }

    rows.push({
      key: cells[0],
      headers: currentHeaders,
      cells,
      malformed: false,
    });
  }

  return rows.filter((row) => row.key && row.key !== "---");
}

function keyForRow(row) {
  return row.key.toLowerCase().replace(/\s+/g, " ").trim();
}

function getEvidenceCell(row) {
  return row.cells[row.cells.length - 1] ?? "";
}

function isPlaceholder(value) {
  const normalized = normalizeCell(value);
  if (normalized.length === 0) return true;
  if (/^(todo|tbd|pending|not started|not recorded)$/i.test(normalized)) return true;
  if (/^(n\/a|na|none|-|—)$/i.test(normalized)) return true;
  if (/\b(todo|tbd)\b/i.test(normalized)) return true;
  return false;
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }
}

function requiredRowsFromTemplate(templateText) {
  const rows = parseTableRows(templateText);
  const required = rows.filter((row) => isPlaceholder(getEvidenceCell(row)));

  if (required.length === 0) {
    throw new Error("Template did not expose any TODO evidence rows to validate against.");
  }

  return required;
}

function validateEvidence(templateText, evidenceText, evidenceFile) {
  const requiredRows = requiredRowsFromTemplate(templateText);
  const evidenceRows = parseTableRows(evidenceText);
  const byKey = new Map();
  const duplicateKeys = new Set();

  for (const row of evidenceRows) {
    const key = keyForRow(row);
    if (byKey.has(key)) duplicateKeys.add(row.key);
    byKey.set(key, row);
  }

  const failures = [];

  if (/\bTODO\b/i.test(evidenceText)) {
    failures.push("evidence file still contains TODO placeholders");
  }

  for (const key of duplicateKeys) {
    failures.push(`duplicate evidence row key: ${key}`);
  }

  for (const required of requiredRows) {
    const key = keyForRow(required);
    const found = byKey.get(key);
    if (!found) {
      failures.push(`missing required row: ${required.key}`);
      continue;
    }

    if (found.malformed) {
      failures.push(`malformed table row: ${found.key}`);
      continue;
    }

    const evidence = getEvidenceCell(found);
    if (isPlaceholder(evidence)) {
      failures.push(`missing evidence for ${found.key}`);
    }
  }

  return {
    evidenceFile,
    requiredRowCount: requiredRows.length,
    checkedRowCount: evidenceRows.length,
    failures,
  };
}

async function main() {
  const evidenceArg = readArg("--file") ?? process.env.W9_EVIDENCE_FILE ?? readPositionalFile();
  if (!evidenceArg) {
    throw new Error(`Missing completed evidence file.\n\n${usage()}`);
  }

  const templateArg = readArg("--template") ?? DEFAULT_TEMPLATE;
  const evidencePath = path.resolve(ROOT, evidenceArg);
  const templatePath = path.resolve(ROOT, templateArg);

  if (isSamePath(evidencePath, templatePath)) {
    throw new Error(
      "Completed W9 evidence must be saved as a dated evidence file, not the tracked template."
    );
  }
  validateEvidenceFileName(evidencePath);

  const [templateText, evidenceText] = await Promise.all([
    readText(templatePath),
    readText(evidencePath),
  ]);

  const result = validateEvidence(templateText, evidenceText, path.relative(ROOT, evidencePath));

  if (result.failures.length > 0) {
    console.error(`W9 evidence validation failed for ${result.evidenceFile}:`);
    for (const failure of result.failures.slice(0, 40)) {
      console.error(`- ${failure}`);
    }
    if (result.failures.length > 40) {
      console.error(`- ... ${result.failures.length - 40} more failure(s)`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `W9 evidence validation passed for ${result.evidenceFile}: ${result.requiredRowCount} required evidence rows complete.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
