#!/usr/bin/env node
// The coordinator's tick: the status digest, the heavy-run lock, and what needs doing now.
// See docs/jarvis/README.md.
//
//   node scripts/jarvis/jarvis-tick.mjs [--no-stamp]
//
// It reads files only (the lane board, the owner's inbox, the lock folder, each working lane's
// transcript folder) and changes nothing but its own stamp, which lets the next tick see a gap: a
// sleep or a closed app. Acting on a flag is the coordinator's job.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STALE_LOCK_MS, lockAgeMs } from './file-lock.mjs';
import { formatFlags, tickFlags } from './jarvis-tick-core.mjs';
import { heavyLockPath, tickStampPath } from './jarvis-paths.mjs';
import { formatDigest } from './lane-board-digest.mjs';
import { otherOpenWorktrees, worktreeFolder } from './lane-board-core.mjs';
import { boardPath, loadBoard } from './lane-board.mjs';
import { inboxPath } from './owner-inbox-core.mjs';
import { readInboxOrNull } from './owner-inbox.mjs';

const stampPath = tickStampPath;
const lockPath = heavyLockPath;
const projectsDir = () => process.env.CAPITAL_CLAUDE_PROJECTS || join(homedir(), '.claude', 'projects');

/**
 * `{ ageMin, owner }` for the heavy-run lock, or null when it is free. A lock released while it is read
 * is free; any other failure is reported in `owner`, and the tick goes on.
 */
export function readLock(now, dir = lockPath()) {
  const ownerFile = join(dir, 'owner.txt');
  try {
    const held = existsSync(ownerFile) ? ownerFile : dir;
    const ageMin = Math.max(0, Math.floor((now - statSync(held).mtimeMs) / 60_000));
    const owner = held === ownerFile ? readFileSync(ownerFile, 'utf8').split('\n')[0].trim() : '';
    return { ageMin, owner };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return { ageMin: 0, owner: `a holder whose lock could not be read (${error?.code ?? error?.message})` };
  }
}

// The lane's own transcript when its row names one (`session`); when that transcript is not there,
// nothing, so the row's own time decides whether the lane is quiet. Only a row without a session
// falls back to the newest transcript in the worktree's folder, which can belong to another session
// opened there: a known limit, since a lane does not reliably know its own transcript id.
export function lastTranscriptWrite(worktree, session, otherWorktrees = []) {
  try {
    const folder = worktreeFolder(worktree);
    // Claude Code keeps the case of a transcript folder's name; worktreeFolder() is lower case.
    const names = readdirSync(projectsDir());
    const within = (name, prefix) => name.toLowerCase() === prefix || name.toLowerCase().startsWith(`${prefix}-`);
    if (session) {
      // The session may have started in a folder inside the worktree, which has its own transcript
      // folder.
      const inside = names.filter((name) => within(name, folder));
      const own = inside.map((name) => join(projectsDir(), name, `${session}.jsonl`)).find((file) => existsSync(file));
      // Another session's transcript must not stand in for this one's and hide a stalled lane.
      return own ? new Date(statSync(own).mtimeMs).toISOString() : '';
    }
    // No recorded session: the newest transcript in the worktree's folder or in the folder of a directory
    // inside it, leaving out folders that belong to another lane's worktree.
    const theirs = otherWorktrees.map(worktreeFolder).filter((other) => other.startsWith(`${folder}-`));
    const mine = names.filter((name) => within(name, folder) && !theirs.some((other) => within(name, other)));
    const files = mine.flatMap((name) => readdirSync(join(projectsDir(), name)).filter((file) => file.endsWith('.jsonl')).map((file) => join(projectsDir(), name, file)));
    const newest = Math.max(...files.map((file) => statSync(file).mtimeMs));
    return Number.isFinite(newest) ? new Date(newest).toISOString() : '';
  } catch {
    return ''; // no transcript folder yet: the row's own time stands
  }
}

function lastTick() {
  try {
    return JSON.parse(readFileSync(stampPath(), 'utf8')).lastTickAt ?? '';
  } catch {
    return ''; // first tick
  }
}

export function run(argv, { now = Date.now(), out = console.log } = {}) {
  const board = loadBoard();
  const waiting = readInboxOrNull(inboxPath());
  const lock = readLock(now);
  const activity = Object.fromEntries(board.lanes.filter((lane) => lane.worktree).map((lane) => [lane.id, lastTranscriptWrite(lane.worktree, lane.session, otherOpenWorktrees(board.lanes, lane.id))]));
  // A write lock left behind stops every writer of that file, silently unless it is reported here.
  const stateLocks = [boardPath(), inboxPath()]
    .map((file) => ({ file: basename(file), age: lockAgeMs(file) }))
    .filter((held) => held.age !== null && held.age > STALE_LOCK_MS)
    .map((held) => ({ file: held.file, ageSec: Math.round(held.age / 1000) }));
  const flags = tickFlags(board, { now, activity, lock, waiting, lastTickAt: lastTick(), stateLocks });
  out(formatDigest(board, { now, waiting }));
  out(`Heavy-run lock: ${lock ? `held for ${lock.ageMin} min by ${lock.owner || 'an unnamed holder'}` : 'free'}`);
  out(formatFlags(flags));
  if (!argv.includes('--no-stamp')) {
    mkdirSync(dirname(stampPath()), { recursive: true });
    writeFileSync(stampPath(), `${JSON.stringify({ lastTickAt: new Date(now).toISOString() })}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
