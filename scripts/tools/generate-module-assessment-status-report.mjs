import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INDEX_FILE = "module-assessments-index.json";
const METADATA_FILE = "module-assessments-metadata.json";
const INDEX_PATH = path.join(ROOT, "docs", "reviews", INDEX_FILE);
const METADATA_PATH = path.join(ROOT, "docs", "reviews", METADATA_FILE);
const MODULE_STATUS_DIR = path.join(ROOT, "docs", "module-status");
const OUTPUT_PATH = path.join(ROOT, "docs", "reviews", "module-assessment-status-report.md");
const REQUIRE_FINAL_READY = process.argv.includes("--require-final-ready");
const CHECK_REPORT_CURRENT = process.argv.includes("--check") || REQUIRE_FINAL_READY;

function normalizeModuleName(name) {
  return name.toLowerCase().replace(/_/g, "-").trim();
}

function singularizeModuleName(name) {
  if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
  if (name.endsWith("s")) return name.slice(0, -1);
  return name;
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const sanitized = raw.replace(/^\uFEFF/, "");
  return JSON.parse(sanitized);
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

function extractScore(text) {
  const activeText = text.replace(/~~.*?~~/gs, "");
  const overallLine = activeText
    .split(/\r?\n/)
    .find((line) => /overall score/i.test(line));
  const match = (overallLine ?? activeText).match(/(\d+(?:\.\d+)?)\/100/);
  return match ? Number(match[1]) : null;
}

function extractStatus(text) {
  const activeText = text.replace(/~~.*?~~/gs, "");
  const overallLine = activeText
    .split(/\r?\n/)
    .find((line) => /overall score/i.test(line) && /status/i.test(line));

  if (overallLine) {
    const overallStatus = overallLine.match(/status:?\s*(?:\*\*)?\s*([^\n|*]+)/i);
    if (overallStatus) return overallStatus[1].trim();
  }

  const boldMatch = activeText.match(/\*\*Status:\*\*\s*([^\n|]+)/i);
  if (boldMatch) return boldMatch[1].trim();

  const tableMatch = activeText.match(/^\|\s*Status\s*\|\s*([^|]+)\|/im);
  if (tableMatch) return tableMatch[1].trim();

  return "Status not found";
}

function extractRuleStatus(text, ruleNumber) {
  const regex = new RegExp(`^\\|\\s*Rule ${ruleNumber}[^|]*\\|\\s*([^|]+)\\|`, "im");
  const match = text.match(regex);
  if (!match) return "-";
  const cleaned = match[1].replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
  return cleaned || "-";
}

function classifyScore(score) {
  if (score === null || Number.isNaN(score)) return "Not Assessed";
  if (score >= 80) return "PASS (80-100)";
  if (score >= 65) return "Needs Fixes (65-79)";
  if (score >= 50) return "FAIL (50-64)";
  return "CRITICAL (<50)";
}

function formatScore(score) {
  return score === null ? "-" : `${score}/100`;
}

function formatDate(dateString) {
  return dateString ?? "-";
}

function toTitleCase(name) {
  const acronymOverrides = new Map([["ai", "AI"]]);
  return name
    .split("-")
    .map((part) =>
      acronymOverrides.get(part) ??
      (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1))
    )
    .join(" ");
}

function sortByModuleName(a, b) {
  return a.module.localeCompare(b.module);
}

function sortSecurityGate(items) {
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...items].sort((a, b) => {
    const severityDiff = (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99);
    if (severityDiff !== 0) return severityDiff;
    if (a.crossHouseholdRisk !== b.crossHouseholdRisk) {
      return a.crossHouseholdRisk ? -1 : 1;
    }
    return a.module.localeCompare(b.module);
  });
}

async function findModuleStatusEvidence(moduleName) {
  const entries = await fs.readdir(MODULE_STATUS_DIR, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);

  const candidates = new Set([
    moduleName,
    singularizeModuleName(moduleName),
    moduleName.replace(/-/g, ""),
    singularizeModuleName(moduleName).replace(/-/g, ""),
  ]);

  const upperCandidates = [...candidates].map((c) => c.toUpperCase());

  const match = files.find((file) => {
    const upperFile = file.toUpperCase();
    return upperCandidates.some((candidate) => upperFile.includes(candidate));
  });

  return match ? path.join("docs", "module-status", match).replace(/\\/g, "/") : "-";
}

async function buildModuleRows(index, metadataByModule) {
  const rows = [];

  for (const entry of index.modules) {
    const moduleName = normalizeModuleName(entry.module);
    const canonicalPath = entry.canonicalAssessmentPath
      ? path.join(ROOT, entry.canonicalAssessmentPath)
      : null;

    const metadata = metadataByModule.get(moduleName) ?? {
      lastVerified: null,
      releaseGateOpenItems: [],
    };

    let score = null;
    let status = "Not assessed";
    let rules = { rule1: "-", rule9: "-", rule12: "-", rule17: "-" };

    if (canonicalPath) {
      const text = await readIfExists(canonicalPath);
      if (text) {
        score = extractScore(text);
        status = extractStatus(text);
        rules = {
          rule1: extractRuleStatus(text, 1),
          rule9: extractRuleStatus(text, 9),
          rule12: extractRuleStatus(text, 12),
          rule17: extractRuleStatus(text, 17),
        };
      } else {
        status = "Canonical assessment missing";
      }
    }

    const band = classifyScore(score);
    const statusDoc = await findModuleStatusEvidence(moduleName);

    rows.push({
      module: moduleName,
      moduleLabel: toTitleCase(moduleName),
      canonicalAssessmentPath: entry.canonicalAssessmentPath,
      statusDoc,
      notes: entry.notes ?? "",
      score,
      scoreDisplay: formatScore(score),
      band,
      status,
      rules,
      lastVerified: metadata.lastVerified,
      releaseGateOpenItems: metadata.releaseGateOpenItems ?? [],
    });
  }

  return rows.sort(sortByModuleName);
}

function groupBands(rows) {
  const bands = new Map();
  for (const row of rows) {
    if (!bands.has(row.band)) bands.set(row.band, []);
    bands.get(row.band).push(row);
  }
  return bands;
}

function renderExecutiveSummary(rows) {
  const bands = groupBands(rows);
  const order = [
    "PASS (80-100)",
    "Needs Fixes (65-79)",
    "FAIL (50-64)",
    "CRITICAL (<50)",
    "Not Assessed",
  ];

  const lines = [];
  lines.push("## Executive Summary (Generated)");
  lines.push("");
  lines.push("| Status Band | Count | Modules |" );
  lines.push("|-------------|-------|---------|");

  for (const band of order) {
    const entries = bands.get(band) ?? [];
    const moduleList = entries.map((e) => e.moduleLabel).join(", ") || "-";
    lines.push(`| ${band} | ${entries.length} | ${moduleList} |`);
  }

  lines.push("");
  lines.push("Notes:");
  lines.push("- Status bands are derived from the numeric score in each canonical module assessment.");
  lines.push("- Final readiness is stricter: a module must be 100/100 and have zero open release-gate items.");
  lines.push(`- Canonical assessment sources are defined in \`docs/reviews/${INDEX_FILE}\`.`);
  return lines.join("\n");
}

function isFinalReady(row) {
  return row.score === 100 && row.releaseGateOpenItems.length === 0;
}

function renderFinalReadinessGate(rows, securityGate) {
  const finalReadyCount = rows.filter(isFinalReady).length;
  const atPerfectScoreCount = rows.filter((row) => row.score === 100).length;
  const belowPerfectCount = rows.filter((row) => row.score !== 100).length;
  const openGateModuleCount = rows.filter((row) => row.releaseGateOpenItems.length > 0).length;

  const lines = [];
  lines.push("## Final Readiness Gate (Generated)");
  lines.push("");
  lines.push(
    "A module is final-ready only when its canonical score is 100/100 and `releaseGateOpenItems` is empty."
  );
  lines.push("");
  lines.push("| Metric | Current | Required For 100% Closeout |" );
  lines.push("|--------|---------|-----------------------------|");
  lines.push(`| Modules final-ready | ${finalReadyCount}/${rows.length} | ${rows.length}/${rows.length} |`);
  lines.push(`| Modules at 100/100 | ${atPerfectScoreCount}/${rows.length} | ${rows.length}/${rows.length} |`);
  lines.push(`| Modules below 100/100 | ${belowPerfectCount} | 0 |`);
  lines.push(`| Modules with open release-gate items | ${openGateModuleCount} | 0 |`);
  lines.push(`| Security release-gate entries | ${securityGate.length} | 0 |`);

  return lines.join("\n");
}

function formatFinalReadinessBlockers(row) {
  const blockers = [];
  if (row.score !== 100) {
    blockers.push(`score ${row.scoreDisplay}`);
  }
  if (row.releaseGateOpenItems.length > 0) {
    blockers.push(`${row.releaseGateOpenItems.length} open release-gate item(s)`);
  }
  return blockers.join("; ") || "-";
}

function renderFinalReadinessBlockers(rows) {
  const blockers = rows.filter((row) => !isFinalReady(row));
  const sorted = blockers.sort((a, b) => {
    const openItemDiff = b.releaseGateOpenItems.length - a.releaseGateOpenItems.length;
    if (openItemDiff !== 0) return openItemDiff;

    const aScore = a.score ?? -1;
    const bScore = b.score ?? -1;
    const scoreDiff = aScore - bScore;
    if (scoreDiff !== 0) return scoreDiff;

    return a.module.localeCompare(b.module);
  });

  const lines = [];
  lines.push("## Final Readiness Blockers (Generated)");
  lines.push("");
  lines.push("This is the complete W10 closeout queue. A row drops out only when the canonical score is 100/100 and release-gate metadata has no open items.");
  lines.push("");
  lines.push("| Priority | Module | Score | Open Release Gate Items | Blockers | Canonical Assessment |");
  lines.push("|----------|--------|-------|--------------------------|----------|----------------------|");

  sorted.forEach((row, index) => {
    const canonicalPath = row.canonicalAssessmentPath ?? "-";
    lines.push(
      `| ${index + 1} | ${row.moduleLabel} | ${row.scoreDisplay} | ${row.releaseGateOpenItems.length} | ${formatFinalReadinessBlockers(row)} | ${canonicalPath} |`
    );
  });

  return lines.join("\n");
}

function getFinalReadinessFailures(rows, securityGate) {
  const notReady = rows.filter((row) => !isFinalReady(row));
  const missingAssessments = rows.filter((row) => row.score === null);
  const belowPerfect = rows.filter((row) => row.score !== 100);
  const openGateRows = rows.filter((row) => row.releaseGateOpenItems.length > 0);

  const failures = [];
  if (notReady.length > 0) {
    failures.push(`${notReady.length}/${rows.length} module(s) are not final-ready`);
  }
  if (missingAssessments.length > 0) {
    failures.push(`${missingAssessments.length} module(s) are missing canonical assessment scores`);
  }
  if (belowPerfect.length > 0) {
    failures.push(`${belowPerfect.length} module(s) are below 100/100`);
  }
  if (openGateRows.length > 0) {
    failures.push(`${openGateRows.length} module(s) have open release-gate items`);
  }
  if (securityGate.length > 0) {
    const noun = securityGate.length === 1 ? "entry" : "entries";
    failures.push(`${securityGate.length} security release-gate ${noun} remain`);
  }

  return { failures, notReady };
}

function renderDetailedScores(rows) {
  const assessed = rows.filter((r) => r.score !== null);
  const lines = [];
  lines.push("## Detailed Module Scores (Canonical Assessments)");
  lines.push("");
  lines.push("| Module | Score | Assessment Status | Release Gate Open Items | Final Gate Ready | Canonical Assessment |" );
  lines.push("|--------|-------|-------------------|--------------------------|------------------|----------------------|");

  for (const row of assessed) {
    const openItems = row.releaseGateOpenItems.length;
    const canonicalPath = row.canonicalAssessmentPath ?? "-";
    const finalGateReady = isFinalReady(row) ? "Yes" : "No";
    lines.push(
      `| ${row.moduleLabel} | ${row.scoreDisplay} | ${row.status} | ${openItems} | ${finalGateReady} | ${canonicalPath} |`
    );
  }

  return lines.join("\n");
}

function renderUnassessed(rows) {
  const unassessed = rows.filter((r) => r.score === null);
  const lines = [];
  lines.push("## Modules Not Yet Assessed (Canonical Assessment Missing)");
  lines.push("");
  lines.push("| Module | Module Status Evidence | Notes |" );
  lines.push("|--------|------------------------|-------|");

  for (const row of unassessed) {
    lines.push(`| ${row.moduleLabel} | ${row.statusDoc} | ${row.notes} |`);
  }

  return lines.join("\n");
}

function renderSecurityGate(securityReleaseGate, rowsByModule) {
  const lines = [];
  lines.push("## Security Release Gate (Cross-Household Risks First)");
  lines.push("");
  lines.push(`This gate is derived from \`docs/reviews/${METADATA_FILE}\` and prioritizes cross-household data exposure risks ahead of other issues.`);
  lines.push("");
  lines.push("| Priority | Module | Severity | Cross-Household Risk | Reason | Score | Status |" );
  lines.push("|----------|--------|----------|----------------------|--------|-------|--------|");

  const sortedGate = sortSecurityGate(securityReleaseGate);
  sortedGate.forEach((item, idx) => {
    const row = rowsByModule.get(item.module);
    const scoreDisplay = row?.scoreDisplay ?? "-";
    const status = row?.status ?? "-";
    const crossRisk = item.crossHouseholdRisk ? "Yes" : "No";
    lines.push(
      `| ${idx + 1} | ${toTitleCase(item.module)} | ${item.severity} | ${crossRisk} | ${item.reason} | ${scoreDisplay} | ${status} |`
    );
  });

  return lines.join("\n");
}

function renderComplianceMatrix(rows) {
  const lines = [];
  lines.push("## CLAUDE.md Compliance Matrix (From Canonical Assessments)");
  lines.push("");
  lines.push("Legend: PASS, PARTIAL, FAIL, N/A, or \"-\" when not explicitly stated in the canonical assessment.");
  lines.push("");
  lines.push("| Module | Rule 1 (Money) | Rule 9 (Audit) | Rule 12 (Rate) | Rule 17 (Tests) |" );
  lines.push("|--------|-----------------|----------------|----------------|-----------------|");

  for (const row of rows) {
    lines.push(
      `| ${row.moduleLabel} | ${row.rules.rule1} | ${row.rules.rule9} | ${row.rules.rule12} | ${row.rules.rule17} |`
    );
  }

  return lines.join("\n");
}

function renderMachineReadableTable(rows) {
  const lines = [];
  lines.push("## Machine-Readable Release Gate Tracking");
  lines.push("");
  lines.push(`Source of truth: \`docs/reviews/${METADATA_FILE}\`. Update that file and re-run the generator.`);
  lines.push("");
  lines.push("| Module | Last Verified | Open Release Gate Items | Items |" );
  lines.push("|--------|---------------|-------------------------|-------|");

  for (const row of rows) {
    const count = row.releaseGateOpenItems.length;
    const items = count === 0 ? "-" : row.releaseGateOpenItems.join("; ");
    lines.push(`| ${row.moduleLabel} | ${formatDate(row.lastVerified)} | ${count} | ${items} |`);
  }

  return lines.join("\n");
}

function renderCanonicalSources(rows) {
  const lines = [];
  lines.push("## Canonical Assessment Sources");
  lines.push("");
  lines.push(`Canonical paths are defined in \`docs/reviews/${INDEX_FILE}\` to prevent drift between root and subfolder variants.`);
  lines.push("");
  lines.push("| Module | Canonical Assessment | Notes |" );
  lines.push("|--------|----------------------|-------|");

  for (const row of rows) {
    const canonical = row.canonicalAssessmentPath ?? "-";
    const notes = row.notes || "-";
    lines.push(`| ${row.moduleLabel} | ${canonical} | ${notes} |`);
  }

  return lines.join("\n");
}

function renderPriorities(securityReleaseGate, rows) {
  const rowsByModule = new Map(rows.map((r) => [r.module, r]));
  const securityFirst = sortSecurityGate(securityReleaseGate);

  const securityModules = new Set(securityFirst.map((s) => s.module));

  const remainingWithOpenItems = rows
    .filter((r) => !securityModules.has(r.module) && r.releaseGateOpenItems.length > 0)
    .sort(sortByModuleName);

  const lines = [];
  lines.push("## Priority Remediation Order (Generated)");
  lines.push("");
  lines.push("### P0 - Security and Cross-Household Risks");
  lines.push("");
  securityFirst.forEach((item, idx) => {
    const row = rowsByModule.get(item.module);
    const label = row?.moduleLabel ?? toTitleCase(item.module);
    lines.push(`${idx + 1}. ${label}: ${item.reason}`);
  });

  lines.push("");
  lines.push("### P1 - Release Gate Open Items (Non-Security Gate)");
  lines.push("");

  if (remainingWithOpenItems.length === 0) {
    lines.push("1. No non-security release gate items recorded.");
  } else {
    remainingWithOpenItems.forEach((row, idx) => {
      const sample = row.releaseGateOpenItems[0] ?? "Open items recorded";
      lines.push(`${idx + 1}. ${row.moduleLabel}: ${sample}`);
    });
  }

  lines.push("");
  lines.push("### P2 - Assessment Coverage and Hygiene");
  lines.push("");
  const unassessed = rows.filter((r) => r.score === null);
  if (unassessed.length === 0) {
    lines.push("1. All modules have canonical assessments.");
  } else {
    const list = unassessed.map((r) => r.moduleLabel).join(", ");
    lines.push(`1. Complete canonical assessments for: ${list}.`);
    lines.push("2. Keep canonical index and metadata files updated when assessments change.");
  }

  return lines.join("\n");
}

function renderHeader(totalModules, assessedCount) {
  const today = new Date().toISOString().slice(0, 10);
  const assessedPercent = Math.round((assessedCount / totalModules) * 100);

  const lines = [];
  lines.push("# Module Assessment Status Report");
  lines.push("");
  lines.push(`Generated: ${today}`);
  lines.push(`Total Modules: ${totalModules}`);
  lines.push(`Assessed (canonical assessment found): ${assessedCount} (${assessedPercent}%)`);
  lines.push("");
  lines.push("This report is generated. Do not edit it directly. Instead:");
  lines.push(`- Update \`docs/reviews/${INDEX_FILE}\` (canonical sources)`);
  lines.push(`- Update \`docs/reviews/${METADATA_FILE}\` (release gate tracking)`);
  lines.push("- Run `npm run check:module-metadata` to verify canonical source and release-gate metadata consistency");
  lines.push("- Run `npm run check:modules-report` to verify this generated report is current");
  lines.push("- Run `npm run report:modules` to regenerate this file");
  lines.push("");
  lines.push("---");
  return lines.join("\n");
}

function renderConclusion(securityGate, rows) {
  if (securityGate.length > 0) {
    return "Security release gate risks should be addressed before any broader production push. Keep the canonical index and metadata files updated, then regenerate this report.";
  }

  const finalReadyCount = rows.filter(isFinalReady).length;
  if (finalReadyCount < rows.length) {
    const openGateModuleCount = rows.filter((row) => row.releaseGateOpenItems.length > 0).length;
    return `Final readiness is not achieved yet: ${finalReadyCount}/${rows.length} modules are final-ready. Remaining work is score gaps plus ${openGateModuleCount} modules with open release-gate items; update canonical assessments and metadata only when W9/W10 evidence supports closure.`;
  }

  const modulesBelowPerfect = rows.filter((row) => row.score !== 100);
  if (modulesBelowPerfect.length > 0) {
    return "No security release gate risks are currently listed. Remaining release-readiness work is tracked in module open items and score gaps; update canonical assessments and regenerate this report as evidence changes.";
  }

  return "All assessed modules are at 100/100 and no security release gate risks are currently listed. Keep the canonical index and metadata files updated, then regenerate this report after future assessment changes.";
}

function normalizeReportForComparison(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^Generated: .+$/m, "Generated: <date>")
    .trimEnd();
}

async function checkReportCurrent(expectedOutput) {
  const existingOutput = await readIfExists(OUTPUT_PATH);
  if (existingOutput === null) {
    // eslint-disable-next-line no-console
    console.error(`Generated module assessment report is missing: ${path.relative(ROOT, OUTPUT_PATH)}`);
    process.exitCode = 1;
    return false;
  }

  if (normalizeReportForComparison(existingOutput) !== normalizeReportForComparison(expectedOutput)) {
    // eslint-disable-next-line no-console
    console.error(
      `Generated module assessment report is stale: run npm run report:modules and commit ${path.relative(ROOT, OUTPUT_PATH)}`
    );
    process.exitCode = 1;
    return false;
  }

  return true;
}

async function main() {
  const index = await loadJson(INDEX_PATH);
  const metadata = await loadJson(METADATA_PATH);
  const securityGate = metadata.securityReleaseGate ?? [];

  const metadataByModule = new Map(
    (metadata.metadata ?? []).map((item) => [normalizeModuleName(item.module), item])
  );

  const rows = await buildModuleRows(index, metadataByModule);
  const rowsByModule = new Map(rows.map((r) => [r.module, r]));

  const totalModules = rows.length;
  const assessedCount = rows.filter((r) => r.score !== null).length;

  const parts = [];
  parts.push(renderHeader(totalModules, assessedCount));
  parts.push("");
  parts.push(renderExecutiveSummary(rows));
  parts.push("");
  parts.push(renderFinalReadinessGate(rows, securityGate));
  parts.push("");
  parts.push(renderFinalReadinessBlockers(rows));
  parts.push("");
  parts.push(renderSecurityGate(securityGate, rowsByModule));
  parts.push("");
  parts.push(renderDetailedScores(rows));
  parts.push("");
  parts.push(renderUnassessed(rows));
  parts.push("");
  parts.push(renderComplianceMatrix(rows));
  parts.push("");
  parts.push(renderMachineReadableTable(rows));
  parts.push("");
  parts.push(renderCanonicalSources(rows));
  parts.push("");
  parts.push(renderPriorities(securityGate, rows));
  parts.push("");
  parts.push("## Conclusion");
  parts.push("");
  parts.push(renderConclusion(securityGate, rows));
  parts.push("");

  const output = parts.join("\n");

  const securityCount = securityGate.length;
  const finalReadyCount = rows.filter(isFinalReady).length;
  if (CHECK_REPORT_CURRENT) {
    const isCurrent = await checkReportCurrent(output);
    if (isCurrent) {
      // eslint-disable-next-line no-console
      console.log(`Module assessment status report check passed: ${assessedCount}/${totalModules} assessed modules, ${finalReadyCount}/${totalModules} final-ready modules, and ${securityCount} security gate entries.`);
    }
  } else {
    await fs.writeFile(OUTPUT_PATH, output, "utf8");
    // eslint-disable-next-line no-console
    console.log(`Generated ${path.relative(ROOT, OUTPUT_PATH)} with ${assessedCount}/${totalModules} assessed modules, ${finalReadyCount}/${totalModules} final-ready modules, and ${securityCount} security gate entries.`);
  }

  if (REQUIRE_FINAL_READY) {
    const { failures, notReady } = getFinalReadinessFailures(rows, securityGate);
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.error("Final module readiness check failed:");
      for (const failure of failures) {
        // eslint-disable-next-line no-console
        console.error(`- ${failure}`);
      }

      const sample = notReady.slice(0, 10);
      if (sample.length > 0) {
        // eslint-disable-next-line no-console
        console.error("Top not-ready modules:");
        for (const row of sample) {
          // eslint-disable-next-line no-console
          console.error(
            `- ${row.moduleLabel}: ${row.scoreDisplay}, ${row.releaseGateOpenItems.length} open gate item(s)`
          );
        }
      }

      process.exitCode = 1;
    } else {
      // eslint-disable-next-line no-console
      console.log(`Final module readiness check passed: ${finalReadyCount}/${totalModules} modules are final-ready.`);
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
