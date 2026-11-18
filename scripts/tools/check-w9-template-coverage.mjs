import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_MAP_PATH = path.join(ROOT, "docs", "reviews", "w9-smoke-release-gate-map.json");
const RELEASE_GATE_ID_PATTERN = /^([A-Z0-9-]+):/;
const STAGING_GATE_PATTERN = /^[A-Z0-9-]+-STAGING-\d+$/;
const TEMPLATE_ROW_ID_PATTERN = /^[A-Z0-9-]+-\d+$/;

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

function parseTemplateRowIds(templateText) {
  const ids = new Set();
  const duplicates = new Set();

  for (const line of templateText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;

    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map(normalizeCell);

    if (cells.length === 0) continue;
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;

    const id = cells[0];
    if (!TEMPLATE_ROW_ID_PATTERN.test(id)) continue;

    if (ids.has(id)) duplicates.add(id);
    ids.add(id);
  }

  return { ids, duplicates };
}

function getStagingReleaseGateItems(metadata) {
  const items = new Map();

  for (const entry of metadata.metadata ?? []) {
    for (const rawItem of entry.releaseGateOpenItems ?? []) {
      const match = String(rawItem).match(RELEASE_GATE_ID_PATTERN);
      if (!match) continue;

      const releaseGateId = match[1];
      if (!STAGING_GATE_PATTERN.test(releaseGateId)) continue;

      items.set(releaseGateId, {
        module: entry.module,
        text: rawItem,
      });
    }
  }

  return items;
}

function validateMapping({ map, stagingItems, templateRowIds, duplicateTemplateRowIds }) {
  const failures = [];
  const mappedGateIds = new Set();

  if (map.schemaVersion !== 1) {
    failures.push(`unsupported schemaVersion: ${map.schemaVersion ?? "missing"}`);
  }

  for (const duplicate of duplicateTemplateRowIds) {
    failures.push(`duplicate W9 template row id: ${duplicate}`);
  }

  for (const [index, mapping] of (map.mappings ?? []).entries()) {
    const label = mapping.releaseGateId ?? `mapping at index ${index}`;

    if (!mapping.releaseGateId) {
      failures.push(`missing releaseGateId for mapping at index ${index}`);
      continue;
    }

    if (mappedGateIds.has(mapping.releaseGateId)) {
      failures.push(`duplicate releaseGateId mapping: ${mapping.releaseGateId}`);
    }
    mappedGateIds.add(mapping.releaseGateId);

    if (!stagingItems.has(mapping.releaseGateId)) {
      failures.push(`mapping references unknown staging release gate: ${mapping.releaseGateId}`);
    }

    if (!Array.isArray(mapping.templateRowIds) || mapping.templateRowIds.length === 0) {
      failures.push(`${label} has no templateRowIds`);
      continue;
    }

    for (const rowId of mapping.templateRowIds) {
      if (!templateRowIds.has(rowId)) {
        failures.push(`${label} maps to missing W9 template row: ${rowId}`);
      }
    }
  }

  for (const releaseGateId of stagingItems.keys()) {
    if (!mappedGateIds.has(releaseGateId)) {
      const item = stagingItems.get(releaseGateId);
      failures.push(`staging release gate is not mapped: ${releaseGateId} (${item.module})`);
    }
  }

  return failures;
}

async function main() {
  const map = await loadJson(DEFAULT_MAP_PATH);
  const templatePath = path.resolve(ROOT, map.templatePath);
  const metadataPath = path.resolve(ROOT, map.metadataPath);

  const [templateText, metadata] = await Promise.all([
    readText(templatePath),
    loadJson(metadataPath),
  ]);

  const { ids: templateRowIds, duplicates: duplicateTemplateRowIds } = parseTemplateRowIds(templateText);
  const stagingItems = getStagingReleaseGateItems(metadata);

  const failures = validateMapping({
    map,
    stagingItems,
    templateRowIds,
    duplicateTemplateRowIds,
  });

  if (failures.length > 0) {
    console.error("W9 template coverage check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `W9 template coverage check passed: ${stagingItems.size} staging release-gate item(s) mapped to existing smoke rows.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
