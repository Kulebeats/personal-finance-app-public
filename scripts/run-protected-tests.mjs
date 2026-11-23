#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prepareTestEnvironment } from '../server/testing/test-target.mjs';
import { ENVIRONMENT_BLOCKED_EXIT, playwrightChromiumProblem } from '../server/testing/browser-build.mjs';

const [mode, runner, ...args] = process.argv.slice(2);
if (!['unit', 'database'].includes(mode) || !['vitest', 'playwright', 'tsx'].includes(runner)) {
  console.error('Usage: node scripts/run-protected-tests.mjs unit|database vitest|playwright|tsx [runner arguments]');
  process.exit(1);
}
process.env.PFA_TEST_MODE = mode;
prepareTestEnvironment();
// A missing browser build blocks the run before it starts (exit 4), so it is
// never read as an app failure (1) or a pass (0).
if (runner === 'playwright' && args[0] === 'test') {
  const problem = await playwrightChromiumProblem(args);
  if (problem) {
    console.error(problem);
    process.exit(ENVIRONMENT_BLOCKED_EXIT);
  }
}
const root = fileURLToPath(new URL('../', import.meta.url));
const server = runner === 'vitest' && args[0] === '--server';
if (server) args.shift();
const executable = runner === 'vitest' ? 'vitest/vitest.mjs' : '@playwright/test/cli.js';
const launch = runner === 'tsx' ? ['--import', 'tsx', path.join(root, 'server/testing/run-script.ts'), ...args] :
  [path.join(root, 'node_modules', executable), ...args];
const result = spawnSync(process.execPath, launch, {
  cwd: server ? path.join(root, 'server') : root, env: process.env, stdio: 'inherit',
});
// A runner that failed to start or was killed by a signal exits 3, so a
// caller (e2e-mutation-check.mjs) can tell it from an ordinary test failure (1).
const ABNORMAL_EXIT = 3;
if (result.error || result.signal) {
  console.error(`${runner} did not finish: ${result.error?.message ?? `terminated by ${result.signal}`}`);
  process.exitCode = ABNORMAL_EXIT;
} else {
  process.exitCode = result.status ?? ABNORMAL_EXIT;
}
