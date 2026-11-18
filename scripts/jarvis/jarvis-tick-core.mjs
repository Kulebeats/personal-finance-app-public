// The coordinator's tick, as pure checks over the lane board. The control-room mod's watchdog shows
// much the same in its pane; these run from a script, so the coordinator's loop and the hourly
// heartbeat can act on them, and a fresh session with no memory can run a tick: the board is the state.
// See docs/jarvis/README.md.

import { HOLDS_A_PLACE, MAX_RUNNING } from './lane-board-core.mjs';
import { age } from './lane-board-digest.mjs';

export { MAX_RUNNING };

// How long a silence, a held lock or an open question may last before the tick flags it.
export const QUIET_MIN = 30;
export const STALE_LOCK_MIN = 45;
export const WAITING_HOURS = 12;
/** The heartbeat is hourly, so a longer silence means the machine slept or the app was closed. */
export const TICK_GAP_MIN = 90;

// A lane whose silence means something stopped: its session should be writing.
const WORKING = new Set(['starting', 'building', 'in-review']);
// Which statuses hold one of the MAX_RUNNING places is the board's rule (lane-board-core.mjs), where
// the limit is enforced; the tick only reports it.
const minutesSince = (iso, now) => (Number.isNaN(Date.parse(iso ?? '')) ? null : Math.floor((now - Date.parse(iso)) / 60_000));
const latest = (...times) => times.filter((iso) => !Number.isNaN(Date.parse(iso ?? ''))).sort().at(-1) ?? '';

function startFlags(board) {
  const landed = new Set(board.lanes.filter((lane) => lane.status === 'landed').map((lane) => lane.id));
  const ready = board.lanes.filter((lane) => lane.status === 'planned' && lane.runsAfter.every((id) => landed.has(id)));
  const running = board.lanes.filter((lane) => HOLDS_A_PLACE.includes(lane.status)).length;
  if (ready.length && running >= MAX_RUNNING) {
    return [{ kind: 'capacity', message: `${running} lanes are running or hold a place, the limit; ${ready.map((lane) => lane.id).join(', ')} wait for a free place` }];
  }
  return ready.slice(0, MAX_RUNNING - running).map((lane) => ({ kind: 'ready', lane: lane.id, message: `${lane.title} can start: every lane it runs after has landed. Claim it first (lane-board.mjs claim)` }));
}

/**
 * What needs the coordinator now: `[{ kind, lane?, message }]`.
 * `activity` maps a lane id to its session's last transcript write; `lock` is `{ ageMin, owner }` or
 * null; `waiting` is the inbox's items; `lastTickAt` is the previous tick's time.
 */
export function tickFlags(board, { now = Date.now(), activity = {}, lock = null, waiting = [], lastTickAt = '', stateLocks = [] } = {}) {
  const flags = stateLocks.map((held) => ({
    kind: 'statelock',
    message: `${held.file} has a write lock ${held.ageSec} s old, left by a process that stopped; nothing can be written to it. Check no session is writing, then remove ${held.file}.lock by hand`,
  }));
  const gap = minutesSince(lastTickAt, now);
  if (gap !== null && gap > TICK_GAP_MIN) {
    flags.push({
      kind: 'gap',
      message: `No tick for ${age(lastTickAt, now)}: the machine slept or the app was closed. Before re-tasking, re-probe every running lane: its head, the lock owner and orphan child processes`,
    });
  }
  for (const lane of board.lanes.filter((row) => WORKING.has(row.status))) {
    const quiet = minutesSince(latest(lane.updatedAt, activity[lane.id]), now);
    if (quiet !== null && quiet >= QUIET_MIN) flags.push({ kind: 'quiet', lane: lane.id, message: `${lane.status}, quiet for ${quiet} min: check its session, then re-task it from its results file` });
  }
  if (lock && lock.ageMin >= STALE_LOCK_MIN) {
    flags.push({ kind: 'lock', message: `Heavy-run lock held for ${lock.ageMin} min by ${lock.owner || 'an unnamed holder'} (limit ${STALE_LOCK_MIN}): find the holder; only the owner releases a stale lock` });
  }
  if (waiting === null) flags.push({ kind: 'inbox', message: 'The inbox file cannot be read, so questions may be hidden: tell the owner; do not overwrite it' });
  const old = (waiting ?? []).filter((item) => !item.done && (minutesSince(item.since, now) ?? 0) >= WAITING_HOURS * 60).length;
  if (old) flags.push({ kind: 'waiting', message: `${old} question${old === 1 ? ' has' : 's have'} waited over ${WAITING_HOURS} hours: put the batch to the owner when they are next active` });
  return [...flags, ...startFlags(board)];
}

/** The flags as text for a terminal. */
export function formatFlags(flags) {
  if (flags.length === 0) return 'Flags: none';
  return ['Flags', ...flags.map((flag) => `  ${[flag.kind.padEnd(8), flag.lane ?? '', flag.message].filter(Boolean).join('  ')}`)].join('\n');
}
