// OPS-011: a Playwright run on a host that lacks the Chromium build this
// Playwright version expects used to fail every test at browserType.launch,
// which reads like 71 product failures. The runner checks first and reports
// the run as ENVIRONMENT BLOCKED instead: not an app failure, not a pass.
import fs from 'node:fs';
import path from 'node:path';

/** Exit code for a run that could not start because the host is missing something. */
export const ENVIRONMENT_BLOCKED_EXIT = 4;
const WINDOWED_FLAGS = new Set(['--headed', '--ui', '--debug']);
const MARKER = 'INSTALLATION_COMPLETE';

/**
 * The install folder a run needs, from Playwright's own full-Chromium path:
 * headless runs use the headless shell of the same revision, windowed runs
 * the full browser. Undefined when the path is not a standard Playwright
 * install (a custom executable), so Playwright reports that itself.
 */
export function requiredChromiumFolder(executablePath, args) {
  let dir = path.dirname(executablePath);
  while (!/^chromium-\d+$/.test(path.basename(dir))) {
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  const revision = path.basename(dir).slice('chromium-'.length);
  const isWindowed = args.some((arg) => WINDOWED_FLAGS.has(arg));
  return { root: path.dirname(dir), folder: `${isWindowed ? 'chromium' : 'chromium_headless_shell'}-${revision}` };
}

function listDirectory(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

/** A message naming the missing build, or undefined when the host has it. */
export function chromiumBuildProblem({ executablePath, args, version,
  exists = fs.existsSync, list = listDirectory }) {
  const need = requiredChromiumFolder(executablePath, args);
  if (!need || exists(path.join(need.root, need.folder, MARKER))) return undefined;
  const installed = list(need.root).filter((name) => name.startsWith('chromium')).sort();
  return `ENVIRONMENT BLOCKED (not a test result): Playwright ${version} needs the Chromium build ` +
    `${need.folder} in ${need.root}, but this host has ${installed.length ? installed.join(', ') : 'no Chromium build'}. ` +
    'Install the matching build with "npx playwright install chromium" (a download), then run the suite again.';
}

/** Checks the host against the installed playwright-core; used by run-protected-tests.mjs. */
export async function playwrightChromiumProblem(args) {
  const { chromium } = await import('playwright-core');
  const { default: manifest } = await import('playwright-core/package.json', { with: { type: 'json' } });
  return chromiumBuildProblem({ executablePath: chromium.executablePath(), args, version: manifest.version });
}
