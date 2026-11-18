#!/usr/bin/env node
// The lane board CLI: the one way sessions write the board, so every row passes validation.
// See docs/jarvis/README.md.
//
//   node scripts/jarvis/lane-board.mjs list
//   node scripts/jarvis/lane-board.mjs show <id>
//   node scripts/jarvis/lane-board.mjs set <id> key=value ... --by "<lane or session>"
//   node scripts/jarvis/lane-board.mjs claim <id> --by "<coordinator>"   (before starting a lane's session; succeeds once)
//   node scripts/jarvis/lane-board.mjs digest      (status by goal and wave, and what waits on the owner)
//
// The board lives in the main checkout's ignored `.local/jarvis/` folder (jarvis-paths.mjs), so every
// worktree reads the same file. CAPITAL_LANE_BOARD overrides the path; tests use it. Every change is
// one locked read-change-write (file-lock.mjs).

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { withFileLock, writeFileAtomic } from './file-lock.mjs';
import { boardPath } from './jarvis-paths.mjs';
import { applyClaim, applySet, formatBoard, parseAssignments, parseBoard } from './lane-board-core.mjs';
import { formatDigest } from './lane-board-digest.mjs';
import { inboxPath } from './owner-inbox-core.mjs';
import { readInboxOrNull } from './owner-inbox.mjs';

export { boardPath };

const readBoard = (path) => parseBoard(existsSync(path) ? readFileSync(path, 'utf8') : '');

/** The board as it is on disk now. */
export const loadBoard = () => readBoard(boardPath());

/**
 * One locked read-change-write. `change(board)` returns `{ board, result }`; the new board is
 * written whole and `result` is returned. When `change` throws, nothing is written.
 */
export function changeBoard(change) {
  const path = boardPath();
  return withFileLock(
    path,
    () => {
      const { board, result } = change(readBoard(path));
      writeFileAtomic(path, `${JSON.stringify(board, null, 2)}\n`);
      return result;
    },
    'lane board',
  );
}

/** Add or change one lane; returns the saved row. Throws with every reason when refused. */
export function saveLane(id, changes, { by, now = Date.now() }) {
  return changeBoard((board) => {
    const saved = applySet(board, id, changes, { by, now });
    return { board: saved.board, result: saved.row };
  });
}

/** Claim a planned lane before starting its session. Throws when it is already claimed or started. */
export function claimLane(id, { by, now = Date.now() }) {
  return changeBoard((board) => {
    const claimed = applyClaim(board, id, { by, now });
    return { board: claimed.board, result: claimed.row };
  });
}

function takeBy(args) {
  const at = args.indexOf('--by');
  if (at === -1) return { by: '', rest: args };
  return { by: args[at + 1] ?? '', rest: [...args.slice(0, at), ...args.slice(at + 2)] };
}

export function run(argv, { now = Date.now(), out = console.log } = {}) {
  const [command = 'list', id, ...args] = argv;
  const path = boardPath();
  if (command === 'list') {
    out(formatBoard(readBoard(path)));
    return 0;
  }
  if (command === 'digest') {
    out(formatDigest(readBoard(path), { now, waiting: readInboxOrNull(inboxPath()) }));
    return 0;
  }
  if (command === 'show') {
    const lane = readBoard(path).lanes.find((row) => row.id === id);
    if (!lane) throw new Error(`lane board: no lane "${id}"`);
    out(JSON.stringify(lane, null, 2));
    return 0;
  }
  if (command === 'set' || command === 'claim') {
    if (!id) throw new Error(`lane board: ${command} needs a lane id`);
    const { by, rest } = takeBy(args);
    const row = command === 'claim' ? claimLane(id, { by, now }) : saveLane(id, parseAssignments(rest), { by, now });
    out(`${command === 'claim' ? 'claimed' : 'saved'} ${row.id}: ${row.status}${row.head ? ` at ${row.head.slice(0, 9)}` : ''}`);
    return 0;
  }
  throw new Error(`lane board: unknown command "${command}" (list, show, set, claim, digest)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
