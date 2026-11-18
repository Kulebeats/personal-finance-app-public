// The lane board's status digest: one screen that answers "status now?" without asking a session.
// See docs/jarvis/README.md.
// Pure: the board and the inbox items come in, text goes out.

// Most active first, so the count line leads with what is moving.
const STATUS_ORDER = ['building', 'starting', 'in-review', 'built', 'ready-to-land', 'blocked', 'waiting-owner', 'planned', 'held', 'landed'];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "12 min", "3 h" or "4 d" since `iso`; empty when the time is missing or unreadable. */
export function age(iso, now) {
  const then = Date.parse(iso ?? '');
  if (Number.isNaN(then)) return '';
  const ms = Math.max(0, now - then);
  if (ms < 90 * MINUTE) return `${Math.round(ms / MINUTE)} min`;
  if (ms < 48 * HOUR) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / (24 * HOUR))} d`;
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const aged = (iso, now) => (age(iso, now) ? `  (${age(iso, now)})` : '');

function counts(lanes) {
  return STATUS_ORDER.map((status) => [status, lanes.filter((lane) => lane.status === status).length])
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status}`)
    .join(', ');
}

function laneLine(lane, now) {
  const parts = [lane.status.padEnd(13), lane.id.padEnd(24), lane.head ? lane.head.slice(0, 9) : '-'.padEnd(9), `r${lane.reviewRound}`, lane.title];
  const after = lane.runsAfter.length ? `  (after ${lane.runsAfter.join(', ')})` : '';
  const waiting = lane.waitingOn ? `  [waiting: ${lane.waitingOn}]` : '';
  return `    ${parts.join('  ')}${after}${waiting}${aged(lane.updatedAt, now)}`;
}

function goalBlock(goal, lanes, now) {
  const lines = [`${goal ? `Goal ${goal}` : 'No goal'}: ${plural(lanes.length, 'lane')} (${counts(lanes)})`];
  const waves = [...new Set(lanes.map((lane) => lane.wave ?? ''))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const wave of waves) {
    if (wave) lines.push(`  Wave ${wave}`);
    lines.push(...lanes.filter((lane) => (lane.wave ?? '') === wave).map((lane) => laneLine(lane, now)));
  }
  return lines;
}

// The item's `line` (the exact text the owner would type) is never printed: a digest is pasted around.
// `waiting` is null when the inbox file cannot be read: the digest says so and never says "nothing".
function waitingBlock(waiting, now) {
  if (waiting === null) return ['Waiting on the owner: the inbox file cannot be read; repair it by hand before trusting this list.'];
  const open = waiting.filter((item) => !item.done).sort((a, b) => String(a.since).localeCompare(String(b.since)));
  if (open.length === 0) return ['Waiting on the owner: nothing.'];
  return [`Waiting on the owner: ${open.length} open`, ...open.map((item) => `  ${[item.id, item.lane, item.ask].join('  ')}${aged(item.since, now)}`)];
}

/** The digest: lanes by goal and wave with a count line per goal, then what waits on the owner. */
export function formatDigest(board, { now = Date.now(), waiting = [] } = {}) {
  const goals = [...new Set(board.lanes.map((lane) => lane.goal ?? ''))].sort((a, b) => (a === '') - (b === ''));
  const lanes = board.lanes.length === 0 ? ['The lane board is empty.'] : goals.flatMap((goal) => goalBlock(goal, board.lanes.filter((lane) => (lane.goal ?? '') === goal), now));
  return [...lanes, ...waitingBlock(waiting, now)].join('\n');
}
