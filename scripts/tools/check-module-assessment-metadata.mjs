import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, "docs", "reviews", "module-assessments-index.json");
const METADATA_PATH = path.join(ROOT, "docs", "reviews", "module-assessments-metadata.json");
const RELEASE_GATE_ITEM_PATTERN = /^([A-Z0-9-]+)-(STAGING|ASSESS)-(\d{3}):\s+(.+)$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SECURITY_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const RELEASE_GATE_PREFIX_OVERRIDES = new Map([["ai-assistant", "AI"]]);

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeModuleName(name) {
  return String(name ?? "").toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-").trim();
}

function expectedReleaseGatePrefix(moduleName) {
  return RELEASE_GATE_PREFIX_OVERRIDES.get(moduleName) ?? moduleName.toUpperCase();
}

function extractScore(text) {
  const activeText = text.replace(/~~.*?~~/gs, "");
  const overallLine = activeText
    .split(/\r?\n/)
    .find((line) => /overall score/i.test(line));
  const match = (overallLine ?? activeText).match(/(\d+(?:\.\d+)?)\/100/);
  return match ? Number(match[1]) : null;
}

function hasAssessGate(entry) {
  return (entry?.releaseGateOpenItems ?? []).some((rawItem) => {
    const match = String(rawItem ?? "").match(RELEASE_GATE_ITEM_PATTERN);
    return match?.[2] === "ASSESS";
  });
}

function validateIndex(index) {
  const failures = [];
  const modules = new Map();

  if (!Array.isArray(index.modules)) {
    failures.push("module-assessments-index.json must expose a modules array");
    return { failures, modules };
  }

  for (const [position, entry] of index.modules.entries()) {
    const module = normalizeModuleName(entry.module);
    if (!module) {
      failures.push(`index entry ${position} is missing module`);
      continue;
    }

    if (modules.has(module)) {
      failures.push(`duplicate canonical module in index: ${module}`);
    }

    if (!entry.canonicalAssessmentPath) {
      failures.push(`${module} index entry is missing canonicalAssessmentPath`);
    }

    modules.set(module, entry);
  }

  return { failures, modules };
}

async function validateCanonicalPaths(modules) {
  const failures = [];

  for (const [module, entry] of modules.entries()) {
    const canonicalPath = entry.canonicalAssessmentPath;
    if (!canonicalPath) continue;

    const absolutePath = path.resolve(ROOT, canonicalPath);
    if (!(await pathExists(absolutePath))) {
      failures.push(`${module} canonical assessment file is missing: ${canonicalPath}`);
    }
  }

  return failures;
}

function validateMetadataEntries(metadata, modules) {
  const failures = [];
  const metadataByModule = new Map();
  const releaseGateIds = new Map();
  const stagingPrefixes = new Set();
  const assessPrefixes = new Set();

  if (!ISO_DATE_PATTERN.test(String(metadata.generatedAt ?? ""))) {
    failures.push("module-assessments-metadata.json generatedAt must be YYYY-MM-DD");
  }

  if (!Array.isArray(metadata.metadata)) {
    failures.push("module-assessments-metadata.json must expose a metadata array");
    return { failures, metadataByModule, releaseGateIds, stagingPrefixes, assessPrefixes };
  }

  for (const [position, entry] of metadata.metadata.entries()) {
    const module = normalizeModuleName(entry.module);
    if (!module) {
      failures.push(`metadata entry ${position} is missing module`);
      continue;
    }

    if (metadataByModule.has(module)) {
      failures.push(`duplicate metadata module entry: ${module}`);
    }
    metadataByModule.set(module, entry);

    if (!modules.has(module)) {
      failures.push(`metadata references unknown module: ${module}`);
    }

    if (!ISO_DATE_PATTERN.test(String(entry.lastVerified ?? ""))) {
      failures.push(`${module} lastVerified must be YYYY-MM-DD`);
    }

    if (!Array.isArray(entry.releaseGateOpenItems)) {
      failures.push(`${module} releaseGateOpenItems must be an array`);
      continue;
    }

    const expectedPrefix = expectedReleaseGatePrefix(module);
    const moduleItemIds = new Set();

    for (const [itemIndex, rawItem] of entry.releaseGateOpenItems.entries()) {
      const item = String(rawItem ?? "");
      const match = item.match(RELEASE_GATE_ITEM_PATTERN);

      if (!match) {
        failures.push(`${module} releaseGateOpenItems[${itemIndex}] must start with ID and reason`);
        continue;
      }

      const [, prefix, kind, sequence, reason] = match;
      const id = `${prefix}-${kind}-${sequence}`;

      if (prefix !== expectedPrefix) {
        failures.push(`${module} release gate ${id} prefix should be ${expectedPrefix}`);
      }

      if (moduleItemIds.has(id)) {
        failures.push(`${module} has duplicate release gate id: ${id}`);
      }
      moduleItemIds.add(id);

      if (releaseGateIds.has(id)) {
        failures.push(`${module} release gate id duplicates ${releaseGateIds.get(id)}: ${id}`);
      }
      releaseGateIds.set(id, module);

      if (kind === "STAGING") {
        stagingPrefixes.add(prefix);
        if (!/\b(W9|staging|smoke)\b/i.test(reason)) {
          failures.push(`${module} ${id} reason should describe W9 staging smoke evidence`);
        }
      }

      if (kind === "ASSESS") {
        assessPrefixes.add(prefix);
        if (!/\bW10\b/i.test(reason)) {
          failures.push(`${module} ${id} reason should describe W10 reassessment evidence`);
        }
      }
    }
  }

  for (const module of modules.keys()) {
    if (!metadataByModule.has(module)) {
      failures.push(`missing metadata entry for canonical module: ${module}`);
    }
  }

  for (const module of metadataByModule.keys()) {
    if (!modules.has(module)) {
      failures.push(`metadata entry has no matching canonical module: ${module}`);
    }
  }

  for (const prefix of stagingPrefixes) {
    if (!assessPrefixes.has(prefix)) {
      failures.push(`${prefix} has a staging release gate without a matching W10 assessment gate`);
    }
  }

  for (const prefix of assessPrefixes) {
    if (!stagingPrefixes.has(prefix)) {
      failures.push(`${prefix} has a W10 assessment gate without a matching staging release gate`);
    }
  }

  return { failures, metadataByModule, releaseGateIds, stagingPrefixes, assessPrefixes };
}

async function validateScoreGapTracking(modules, metadataByModule) {
  const failures = [];

  for (const [module, entry] of modules.entries()) {
    if (!entry.canonicalAssessmentPath) continue;

    const text = await readIfExists(path.resolve(ROOT, entry.canonicalAssessmentPath));
    if (text === null) continue;

    const score = extractScore(text);
    if (score === 100) continue;

    const metadata = metadataByModule.get(module);
    if (!hasAssessGate(metadata)) {
      const scoreLabel = score === null ? "missing score" : `${score}/100`;
      failures.push(`${module} is ${scoreLabel} but has no W10 ASSESS release gate item`);
    }
  }

  return failures;
}

function validateSecurityReleaseGate(metadata, modules) {
  const failures = [];
  const gate = metadata.securityReleaseGate ?? [];

  if (!Array.isArray(gate)) {
    failures.push("securityReleaseGate must be an array");
    return failures;
  }

  for (const [position, item] of gate.entries()) {
    const module = normalizeModuleName(item.module);
    if (!module) {
      failures.push(`securityReleaseGate[${position}] is missing module`);
    } else if (!modules.has(module)) {
      failures.push(`securityReleaseGate[${position}] references unknown module: ${module}`);
    }

    if (!SECURITY_SEVERITIES.has(String(item.severity ?? "").toLowerCase())) {
      failures.push(`securityReleaseGate[${position}] has invalid severity: ${item.severity ?? "missing"}`);
    }

    if (typeof item.crossHouseholdRisk !== "boolean") {
      failures.push(`securityReleaseGate[${position}] crossHouseholdRisk must be boolean`);
    }

    if (!String(item.reason ?? "").trim()) {
      failures.push(`securityReleaseGate[${position}] reason must be non-empty`);
    }
  }

  return failures;
}

async function main() {
  const [index, metadata] = await Promise.all([loadJson(INDEX_PATH), loadJson(METADATA_PATH)]);

  const indexResult = validateIndex(index);
  const canonicalPathFailures = await validateCanonicalPaths(indexResult.modules);
  const metadataResult = validateMetadataEntries(metadata, indexResult.modules);
  const scoreGateFailures = await validateScoreGapTracking(indexResult.modules, metadataResult.metadataByModule);
  const securityFailures = validateSecurityReleaseGate(metadata, indexResult.modules);

  const failures = [
    ...indexResult.failures,
    ...canonicalPathFailures,
    ...metadataResult.failures,
    ...scoreGateFailures,
    ...securityFailures,
  ];

  if (failures.length > 0) {
    console.error("Module assessment metadata check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Module assessment metadata check passed: ${indexResult.modules.size} canonical module(s), ${metadataResult.releaseGateIds.size} release-gate item(s), ${(metadata.securityReleaseGate ?? []).length} security gate item(s).`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
