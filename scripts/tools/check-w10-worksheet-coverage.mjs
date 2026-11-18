import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const WORKSHEET_PATH = path.join(
  ROOT,
  "docs",
  "reviews",
  "production-readiness-w10-reassessment-worksheet-2026-07-07.md",
);
const INDEX_PATH = path.join(ROOT, "docs", "reviews", "module-assessments-index.json");
const METADATA_PATH = path.join(ROOT, "docs", "reviews", "module-assessments-metadata.json");
const ASSESS_GATE_ID_PATTERN = /^([A-Z0-9-]+-ASSESS-\d{3}):/;

function normalizeModuleName(name) {
  return name.toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-").trim();
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

function normalizeCell(value) {
  return value.replace(/\\\|/g, "|").replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function parseMarkdownTables(text) {
  const tables = [];
  let currentHeaders = null;
  let currentRows = [];

  function flushTable() {
    if (currentHeaders && currentRows.length > 0) {
      tables.push({ headers: currentHeaders, rows: currentRows });
    }
    currentHeaders = null;
    currentRows = [];
  }

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) {
      flushTable();
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

    currentRows.push(cells);
  }

  flushTable();
  return tables;
}

function findModuleMatrix(text) {
  const tables = parseMarkdownTables(text);
  const expectedHeaders = [
    "Module",
    "Current Score",
    "Canonical Assessment",
    "W10 Gate ID",
    "W10 Evidence Required",
  ];

  const table = tables.find((candidate) =>
    expectedHeaders.every((header, index) => candidate.headers[index] === header)
  );

  if (!table) {
    throw new Error("W10 module reassessment matrix table not found.");
  }

  return table.rows.map((cells) => ({
    module: normalizeModuleName(cells[0] ?? ""),
    moduleLabel: cells[0] ?? "",
    currentScore: cells[1] ?? "",
    canonicalAssessmentPath: cells[2] ?? "",
    assessGateId: cells[3] ?? "",
    evidenceRequired: cells[4] ?? "",
  }));
}

function extractScore(text) {
  const activeText = text.replace(/~~.*?~~/gs, "");
  const overallLine = activeText
    .split(/\r?\n/)
    .find((line) => /overall score/i.test(line));
  const match = (overallLine ?? activeText).match(/(\d+(?:\.\d+)?)\/100/);
  return match ? Number(match[1]) : null;
}

function formatScore(score) {
  return score === null ? "-" : `${score}/100`;
}

function isPlaceholder(value) {
  const normalized = normalizeCell(value);
  return (
    normalized.length === 0 ||
    /^(todo|tbd|pending|not started|not recorded|-|n\/a|na)$/i.test(normalized)
  );
}

async function buildCanonicalRows(index) {
  const rows = [];

  for (const entry of index.modules ?? []) {
    const module = normalizeModuleName(entry.module);
    const canonicalAssessmentPath = entry.canonicalAssessmentPath ?? "";
    const canonicalPath = path.resolve(ROOT, canonicalAssessmentPath);
    const text = await readText(canonicalPath);
    const score = extractScore(text);

    rows.push({
      module,
      canonicalAssessmentPath: canonicalAssessmentPath.replace(/\\/g, "/"),
      scoreDisplay: formatScore(score),
    });
  }

  return rows;
}

function getAssessGateIds(metadata) {
  const byModule = new Map();
  const failures = [];

  for (const entry of metadata.metadata ?? []) {
    const module = normalizeModuleName(entry.module ?? "");
    if (!module) continue;

    const assessItems = (entry.releaseGateOpenItems ?? [])
      .map((item) => String(item ?? "").match(ASSESS_GATE_ID_PATTERN)?.[1] ?? null)
      .filter(Boolean);

    if (assessItems.length === 0) {
      failures.push(`${module} has no W10 ASSESS release-gate item`);
      continue;
    }

    if (assessItems.length > 1) {
      failures.push(`${module} has multiple W10 ASSESS release-gate items: ${assessItems.join(", ")}`);
    }

    byModule.set(module, assessItems[0]);
  }

  return { byModule, failures };
}

function validateRows({ worksheetRows, canonicalRows, assessGateIds }) {
  const failures = [];
  const worksheetByModule = new Map();
  const duplicates = new Set();

  for (const row of worksheetRows) {
    if (worksheetByModule.has(row.module)) duplicates.add(row.moduleLabel || row.module);
    worksheetByModule.set(row.module, row);
  }

  for (const duplicate of duplicates) {
    failures.push(`duplicate W10 worksheet module row: ${duplicate}`);
  }

  for (const canonical of canonicalRows) {
    const worksheet = worksheetByModule.get(canonical.module);
    if (!worksheet) {
      failures.push(`missing W10 worksheet module row: ${canonical.module}`);
      continue;
    }

    if (worksheet.canonicalAssessmentPath !== canonical.canonicalAssessmentPath) {
      failures.push(
        `${canonical.module} canonical path mismatch: worksheet=${worksheet.canonicalAssessmentPath}; index=${canonical.canonicalAssessmentPath}`
      );
    }

    if (worksheet.currentScore !== canonical.scoreDisplay) {
      failures.push(
        `${canonical.module} score mismatch: worksheet=${worksheet.currentScore}; canonical=${canonical.scoreDisplay}`
      );
    }

    const expectedAssessGateId = assessGateIds.get(canonical.module);
    if (!expectedAssessGateId) {
      failures.push(`${canonical.module} has no W10 ASSESS release-gate metadata`);
    } else if (worksheet.assessGateId !== expectedAssessGateId) {
      failures.push(
        `${canonical.module} W10 gate mismatch: worksheet=${worksheet.assessGateId}; metadata=${expectedAssessGateId}`
      );
    }

    if (isPlaceholder(worksheet.evidenceRequired)) {
      failures.push(`${canonical.module} is missing W10 evidence requirement text`);
    }
  }

  const canonicalModules = new Set(canonicalRows.map((row) => row.module));
  for (const worksheet of worksheetRows) {
    if (!canonicalModules.has(worksheet.module)) {
      failures.push(`W10 worksheet has unknown module row: ${worksheet.moduleLabel || worksheet.module}`);
    }
  }

  return failures;
}

async function main() {
  const [worksheetText, index, metadata] = await Promise.all([
    readText(WORKSHEET_PATH),
    loadJson(INDEX_PATH),
    loadJson(METADATA_PATH),
  ]);

  const worksheetRows = findModuleMatrix(worksheetText);
  const canonicalRows = await buildCanonicalRows(index);
  const assessGateResult = getAssessGateIds(metadata);
  const failures = [
    ...assessGateResult.failures,
    ...validateRows({ worksheetRows, canonicalRows, assessGateIds: assessGateResult.byModule }),
  ];

  if (failures.length > 0) {
    console.error("W10 worksheet coverage check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `W10 worksheet coverage check passed: ${canonicalRows.length} module row(s) match canonical assessment paths, scores, and W10 gate IDs.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
