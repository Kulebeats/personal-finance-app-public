#!/usr/bin/env node
/**
 * QA-01 / R20.2 CI mutation check.
 *
 * Runs each mutation-checked spec with PFA_E2E_MUTATION=each-step and only its
 * `mutant:` tests (e2e/utils/mutants.ts). A corrupt mutant sends one submit
 * with one field changed, so the write succeeds with a wrong value and only
 * the spec's read-back can catch it (e2e/utils/submit.ts). A green mutant
 * means the spec's assertions do not depend on that write, so this fails.
 *
 * A red mutant counts as killed only when the test annotated it
 * mutation-killed-by: the server accepted the rewritten request (its own
 * 2xx) and the failure came from the read-back the spec declares for that
 * step. A mutation-invalid annotation (field never sent, write rejected,
 * failure outside the read-back), or a red mutant with neither annotation
 * (e.g. a test timeout), fails this script. It also fails when a spec yields
 * no mutants, or
 * when Playwright itself errors outside a test (a config or server failure is
 * not a red mutant).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const COMPLETION = 'playwright.completion.config.ts';
const SMOKE = 'playwright.config.ts';
const SPECS = [
  { spec: 'e2e/completion-r12-holdings-currency.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r13-bond-entry.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r13-grz-evidence.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r13-holding-delete.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r13-sip-plan.spec.ts', config: COMPLETION },
  { spec: 'e2e/journey-first-household.spec.ts', config: COMPLETION },
  { spec: 'e2e/accounts.spec.ts', config: SMOKE },
  { spec: 'e2e/transactions.spec.ts', config: SMOKE },
  { spec: 'e2e/budget.spec.ts', config: SMOKE },
  { spec: 'e2e/organization.spec.ts', config: SMOKE },
  { spec: 'e2e/goals.spec.ts', config: SMOKE },
  { spec: 'e2e/recurring.spec.ts', config: SMOKE },
  { spec: 'e2e/completion-ah13-shared-views.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-fin17-summary-refresh.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r02.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r02-defaults.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r04-shared-owner.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r04-transaction-rule.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r05-notification-recap.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r05-personal-preferences.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r08-reconcile-balance.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r08-split-save.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r20.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-r05-report-preferences.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-imp01-import-wizard.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-ops012-thandi-local.spec.ts', config: COMPLETION },
  { spec: 'e2e/completion-ah05-invitations.spec.ts', config: COMPLETION },
];
const INVALID = 'mutation-invalid';
const KILLED_BY = 'mutation-killed-by';
/** Each spec's mutants write to their own output dir, so a later run cannot clear an earlier one's screenshots. */
const OUTPUT_ROOT = 'test-results/mutants';

function collectTests(suite, out = []) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const annotations = [...(test.annotations ?? []), ...(test.results ?? []).flatMap((result) => result.annotations ?? [])];
      out.push({ title: spec.title, status: test.status,
        invalid: annotations.find((note) => note.type === INVALID), killedBy: annotations.find((note) => note.type === KILLED_BY) });
    }
  }
  for (const child of suite.suites ?? []) collectTests(child, out);
  return out;
}

function runMutants({ spec, config }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pfa-mutants-'));
  const reportFile = path.join(dir, 'report.json');
  const result = spawnSync(process.execPath, [
    path.join(root, 'scripts/run-protected-tests.mjs'), 'database', 'playwright', 'test',
    '--config', config, '--project=chromium', '--grep', 'mutant:', '--retries=0', '--reporter=json',
    '--output', path.join(OUTPUT_ROOT, path.basename(spec, '.spec.ts')), spec,
  ], {
    cwd: root,
    env: { ...process.env, PFA_E2E_MUTATION: 'each-step', PW_REPORTER: 'json', PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  try {
    assertNormalExit(spec, result);
    let report;
    try {
      report = JSON.parse(readFileSync(reportFile, 'utf8'));
    } catch {
      throw new Error(`${spec}: Playwright produced no JSON report (exit ${result.status})`);
    }
    assertExitMatchesReport(spec, result.status, report);
    return report;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The child ran to completion: not killed by a signal, not failed to start,
 * and exited 0 (all passed) or 1 (some failed). A report left behind by a
 * child that was then killed is not trusted.
 */
function assertNormalExit(spec, result) {
  if (result.error) throw new Error(`${spec}: Playwright could not run: ${result.error.message}`);
  if (result.signal) throw new Error(`${spec}: Playwright was terminated by ${result.signal}`);
  if (result.status !== 0 && result.status !== 1) throw new Error(`${spec}: Playwright exited abnormally (status ${result.status})`);
}

/** Exit 1 exactly when the report has a failure; otherwise the report is not this run's. */
function assertExitMatchesReport(spec, status, report) {
  const failures = (report.stats?.unexpected ?? 0) + (report.stats?.flaky ?? 0) + (report.errors ?? []).length;
  if ((status === 1) !== (failures > 0)) {
    throw new Error(`${spec}: Playwright exited ${status} but its report has ${failures} failure(s); the report does not describe this run`);
  }
}

let failed = false;
for (const entry of SPECS) {
  const { spec } = entry;
  const report = runMutants(entry);
  if ((report.errors ?? []).length > 0) {
    console.error(`${spec}: Playwright reported ${report.errors.length} error(s) outside tests; mutants are not trustworthy.`);
    for (const error of report.errors) console.error(`  ${error.message?.split('\n')[0] ?? 'unknown error'}`);
    failed = true;
    continue;
  }
  const mutants = (report.suites ?? []).flatMap((suite) => collectTests(suite)).filter((test) => test.title.startsWith('mutant:'));
  if (mutants.length === 0) {
    console.error(`${spec}: no mutant tests were defined.`);
    failed = true;
    continue;
  }
  for (const mutant of mutants) {
    if (mutant.invalid) {
      console.error(`INVALID  ${spec} > ${mutant.title}: ${mutant.invalid.description ?? 'mutation not applied'}`);
      failed = true;
      continue;
    }
    // "unexpected" = the mutant failed, which is the wanted outcome, but only
    // a failure the test attributed to the step's read-back counts.
    if (mutant.status === 'unexpected' && !mutant.killedBy) {
      console.error(`INVALID  ${spec} > ${mutant.title}: failed without read-back evidence (e.g. a timeout)`);
      failed = true;
      continue;
    }
    const isKilled = mutant.status === 'unexpected';
    console.log(`${isKilled ? `KILLED   (${mutant.killedBy.description})` : 'SURVIVED'} ${spec} > ${mutant.title} (${mutant.status})`);
    if (!isKilled) failed = true;
  }
}
if (failed) {
  console.error('E2E mutation check FAILED: a mutant left its spec green, or the run was not valid.');
  process.exitCode = 1;
} else {
  console.log('E2E mutation check passed: every skipped or corrupted write turned its spec red.');
}
