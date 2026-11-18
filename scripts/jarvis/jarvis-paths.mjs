// Where the Jarvis state lives. One place, so every CLI and every test agrees.
//
// State (the lane board, its lock, the tick stamp, the heavy-run lock) lives in the ignored
// `.local/jarvis/` folder of the repository's MAIN checkout, found through git's common directory,
// so a lane in any worktree reads and writes the same board. CAPITAL_JARVIS_DIR moves the whole
// folder; each file also has its own override (CAPITAL_LANE_BOARD, CAPITAL_TICK_STAMP,
// CAPITAL_HEAVY_LOCK). Tests set these to a temporary folder.
//
// Done-means files are tracked documents: by default they go to `docs/jarvis/done-means/` of the
// checkout the script runs from, and `goal-intake.mjs apply --out <folder>` names another folder.

import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout these scripts run from (scripts/jarvis/../..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let mainCheckoutCache = '';

/**
 * The main checkout: the parent of git's common directory, which every worktree shares. When git
 * cannot answer (no git on PATH, not a repository), the checkout the scripts run from is used.
 */
export function mainCheckout() {
  if (mainCheckoutCache) return mainCheckoutCache;
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    mainCheckoutCache = common ? dirname(common) : REPO_ROOT;
  } catch {
    mainCheckoutCache = REPO_ROOT;
  }
  return mainCheckoutCache;
}

/** The state folder: CAPITAL_JARVIS_DIR, else `<main checkout>/.local/jarvis`. */
export const stateDir = () => process.env.CAPITAL_JARVIS_DIR || join(mainCheckout(), '.local', 'jarvis');

export const boardPath = () => process.env.CAPITAL_LANE_BOARD || join(stateDir(), 'lane-board.json');
export const tickStampPath = () => process.env.CAPITAL_TICK_STAMP || join(stateDir(), 'jarvis-tick.json');
export const heavyLockPath = () => process.env.CAPITAL_HEAVY_LOCK || join(stateDir(), 'heavy-run.lock');

/** The default folder for done-means files, tracked in the repository. */
export const defaultDoneMeansDir = () => join(REPO_ROOT, 'docs', 'jarvis', 'done-means');
