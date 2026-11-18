// The lane board: one row per lane, the fleet's state in a form a script can read.
// See docs/jarvis/README.md.
//
// Pure functions only (no file access), so the CLI in lane-board.mjs and the tests share them.
// Every change returns a NEW board; nothing here mutates its input.

export const BOARD_VERSION = 1;

export const STATUSES = Object.freeze([
  'planned',
  'starting',
  'building',
  'built',
  'in-review',
  'blocked',
  'waiting-owner',
  'ready-to-land',
  'landed',
  'held',
]);

/** At most this many lanes hold a running place at once on this machine. The one place the cap is set. */
export const MAX_RUNNING = 3;
// The statuses that hold one of those places. A lane waiting on the owner keeps working on what the
// question does not block, and a claimed lane is about to run, so both count. Defined here, once,
// because the limit is enforced where a row changes (applySet) and reported by the tick.
// A built lane keeps its place until its review starts, so no new lane takes it while it waits for
// review; it may then go to review, or back to building, at once.
export const HOLDS_A_PLACE = Object.freeze(['starting', 'building', 'built', 'in-review', 'waiting-owner']);

// The lane rules cap a wave at 2 review rounds; a third is reported, not run.
export const MAX_REVIEW_ROUND = 2;

const MAX_TEXT = 200;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/;
const SIGN_OFF_PATTERN = /^[A-Z0-9][A-Za-z0-9.-]{1,47}$/;

const TEXT_FIELDS = ['title', 'branch', 'worktree', 'session', 'waitingOn', 'doneMeans', 'goal', 'wave', 'model'];
// Fields added for goal intake. A row written before them reads as empty.
const LATER_FIELDS = Object.freeze({ goal: '', wave: '', model: '' });
// The tier a lane's session runs on: exactly these three. Planning and advising models are not lanes.
export const LANE_MODELS = Object.freeze(['opus', 'sonnet', 'haiku']);
const LIST_FIELDS = ['runsAfter', 'signOffIds'];
export const SETTABLE_FIELDS = Object.freeze([...TEXT_FIELDS, 'status', 'reviewRound', 'head', ...LIST_FIELDS]);

export const emptyBoard = () => ({ version: BOARD_VERSION, lanes: [] });

/**
 * Parse the board file's text. An empty or missing file is an empty board. Every row is checked
 * on read too, so a hand edit that broke one row is named here,
 * by row, instead of failing later inside some other lane's write.
 */
export function parseBoard(text) {
  if (!text || !text.trim()) return emptyBoard();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`lane board: the file is not valid JSON (${err.message}); repair it by hand`);
  }
  if (!json || typeof json !== 'object' || json.version !== BOARD_VERSION || !Array.isArray(json.lanes)) {
    throw new Error(`lane board: expected {"version": ${BOARD_VERSION}, "lanes": [...]}`);
  }
  const lanes = json.lanes.map((row) => (row && typeof row === 'object' && !Array.isArray(row) ? { ...LATER_FIELDS, ...row } : row));
  lanes.forEach((row, index) => {
    const isObject = row && typeof row === 'object' && !Array.isArray(row);
    const others = lanes.filter((_, i) => i !== index && _ && typeof _.id === 'string');
    const errors = isObject ? validateRow(row, others) : ['not an object'];
    if (errors.length) {
      throw new Error(`lane board: row ${index + 1} (${isObject ? row.id : '?'}) is invalid; repair it by hand:\n  - ${errors.join('\n  - ')}`);
    }
  });
  return { version: BOARD_VERSION, lanes };
}

// Git Bash writes /c/Dev/...; Claude Code names transcript folders from the Windows form, so the
// board keeps C:/Dev/... and the watchdog can find the lane's transcripts.
// A trailing separator is dropped: with it the folder name below would not match.
export const windowsPath = (path) => path.replace(/^\/([a-zA-Z])\//, (_, drive) => `${drive.toUpperCase()}:/`).replace(/[\\/]+$/, '');

/**
 * The name Claude Code gives a session's transcript folder: the directory it started in, with every
 * character that is not a letter or a digit as a dash (an underscore or a space too, not only : \ / .).
 * The hooks and the tick know a lane's session by this name, so it is defined once.
 */
export const worktreeFolder = (path) => windowsPath(String(path)).replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();

// A lane that has landed or is held is not being worked on, so its worktree may be named again.
const isOpen = (row) => row.status !== 'landed' && row.status !== 'held';
/** The worktrees of the open lanes other than `id`: only these own their transcript folders. */
export const otherOpenWorktrees = (lanes, id) => lanes.filter((lane) => lane.id !== id && lane.worktree && isOpen(lane)).map((lane) => lane.worktree);

const splitList = (value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** Turn `key=value` arguments into typed changes. An empty value clears the field. */
export function parseAssignments(args) {
  const changes = {};
  for (const arg of args) {
    const at = arg.indexOf('=');
    if (at < 1) throw new Error(`lane board: "${arg}" is not key=value`);
    const key = arg.slice(0, at);
    const value = arg.slice(at + 1).trim();
    if (!SETTABLE_FIELDS.includes(key)) {
      throw new Error(`lane board: unknown field "${key}" (fields: ${SETTABLE_FIELDS.join(', ')})`);
    }
    if (key === 'reviewRound') changes[key] = value === '' ? 0 : Number(value);
    else if (LIST_FIELDS.includes(key)) changes[key] = splitList(value);
    else changes[key] = value;
  }
  return changes;
}

// The board's lanes, in run order, reached from `id` through runsAfter: a cycle means no lane in it can start.
function cycleThrough(id, runsAfter, lanes) {
  const after = new Map(lanes.map((lane) => [lane.id, lane.runsAfter ?? []]));
  after.set(id, runsAfter);
  const seen = new Set();
  const stack = [...runsAfter];
  while (stack.length) {
    const next = stack.pop();
    if (next === id) return true;
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...(after.get(next) ?? []));
  }
  return false;
}

/** Every reason the row cannot be stored, given the board's other lanes. Empty when it is valid. */
export function validateRow(row, otherLanes) {
  const errors = [];
  const laneIds = otherLanes.map((lane) => lane.id);
  if (!ID_PATTERN.test(row.id ?? '')) errors.push('id must be lower-case letters, digits and dashes, at most 48');
  if (!row.title) errors.push('title is required');
  if (!STATUSES.includes(row.status)) errors.push(`status must be one of: ${STATUSES.join(', ')}`);
  for (const field of [...TEXT_FIELDS, 'updatedBy']) {
    if (typeof row[field] !== 'string') errors.push(`${field} must be text`);
    else if (row[field].length > MAX_TEXT) errors.push(`${field} is longer than ${MAX_TEXT} characters`);
    else if (/[\r\n]/.test(row[field])) errors.push(`${field} must be one line`);
  }
  for (const field of LIST_FIELDS) {
    if (!Array.isArray(row[field]) || row[field].some((item) => typeof item !== 'string')) errors.push(`${field} must be a list of text`);
  }
  if (errors.length) return errors;
  if (!Number.isInteger(row.reviewRound) || row.reviewRound < 0 || row.reviewRound > MAX_REVIEW_ROUND) {
    errors.push(`reviewRound must be a whole number from 0 to ${MAX_REVIEW_ROUND} (the lane rules' cap)`);
  }
  if (row.head && !SHA_PATTERN.test(row.head)) errors.push('head must be a lower-case hex SHA of 7 to 40 characters');
  for (const dep of row.runsAfter ?? []) {
    if (dep === row.id) errors.push('a lane cannot run after itself');
    else if (!laneIds.includes(dep)) errors.push(`runsAfter names "${dep}", which is not on the board`);
  }
  if (cycleThrough(row.id, row.runsAfter, otherLanes)) errors.push('runsAfter makes a loop: no lane in it could ever start');
  for (const id of row.signOffIds ?? []) {
    if (!SIGN_OFF_PATTERN.test(id)) errors.push(`signOffIds: "${id}" is not a sign-off ID (for example SO-GOALS-4)`);
  }
  if (row.model && !LANE_MODELS.includes(row.model)) errors.push(`model must be one of: ${LANE_MODELS.join(', ')}`);
  // A session started in `lane-a/docs` and one started in a worktree `lane-a-docs` get the same transcript
  // folder, so the lane hooks could not tell which lane either is: one folder may not begin
  // with another's followed by a dash.
  const confused = (a, b) => a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
  const twin = row.worktree && isOpen(row) ? otherLanes.find((lane) => lane.worktree && isOpen(lane) && confused(worktreeFolder(lane.worktree), worktreeFolder(row.worktree))) : null;
  if (twin) errors.push(`worktree's transcript folder can be confused with lane "${twin.id}"'s; give each open lane a worktree whose name does not begin with another's followed by a dash`);
  if (row.status === 'waiting-owner' && !row.waitingOn) errors.push('waiting-owner needs waitingOn (the inbox item or the ask)');
  if (row.status === 'landed' && !row.head) errors.push('landed needs the head that landed');
  return errors;
}

const blankRow = (id) => ({
  id,
  title: '',
  branch: '',
  worktree: '',
  session: '',
  status: 'planned',
  reviewRound: 0,
  head: '',
  runsAfter: [],
  waitingOn: '',
  signOffIds: [],
  doneMeans: '',
  ...LATER_FIELDS,
  updatedAt: '',
  updatedBy: '',
});

/**
 * Add the lane or change its fields. Returns { board, row } as new objects; throws with every
 * validation error when the result would be invalid, so a bad call changes nothing.
 */
export function applySet(board, id, changes, { by, now }) {
  if (!by || !String(by).trim()) throw new Error('lane board: say who is writing (--by "<lane or session>")');
  const existing = board.lanes.find((lane) => lane.id === id);
  const row = {
    ...(existing ?? blankRow(id)),
    ...changes,
    ...(changes.worktree === undefined ? {} : { worktree: windowsPath(changes.worktree) }),
    id,
    updatedAt: new Date(now).toISOString(),
    updatedBy: String(by).trim(),
  };
  const errors = validateRow(
    row,
    board.lanes.filter((lane) => lane.id !== id),
  );
  // The round count only rises on one head; a new head (a rebuild onto a -r2 branch) may restart it.
  if (existing && row.reviewRound < existing.reviewRound && row.head === existing.head) {
    errors.push(`reviewRound cannot go down from ${existing.reviewRound} on the same head; the lane rules cap a wave at ${MAX_REVIEW_ROUND}`);
  }
  // The limit is checked here, under the writer's lock, and not only by the tick that suggested the
  // start: between a tick and a claim another lane can take the last place. A lane that
  // already holds a place may change status freely; `built` holds one.
  const takesPlace = HOLDS_A_PLACE.includes(row.status) && !(existing && HOLDS_A_PLACE.includes(existing.status));
  const holders = board.lanes.filter((lane) => lane.id !== id && HOLDS_A_PLACE.includes(lane.status)).map((lane) => lane.id);
  if (takesPlace && holders.length >= MAX_RUNNING) {
    errors.push(`${holders.length} lanes already hold a place (${holders.join(', ')}); another cannot start or resume until one of them finishes`);
  }
  if (errors.length) throw new Error(`lane board: ${id} not saved:\n  - ${errors.join('\n  - ')}`);
  const lanes = existing ? board.lanes.map((lane) => (lane.id === id ? row : lane)) : [...board.lanes, row];
  return { board: { version: BOARD_VERSION, lanes }, row };
}

/**
 * Claim a planned lane before its session is started: planned becomes `starting`, once. A second
 * claim throws, so two coordinators cannot both start the lane.
 */
export function applyClaim(board, id, { by, now }) {
  const row = board.lanes.find((lane) => lane.id === id);
  if (!row) throw new Error(`lane board: no lane "${id}"`);
  if (row.status === 'starting') throw new Error(`lane board: ${id} is already starting (claimed by ${row.updatedBy} at ${row.updatedAt})`);
  if (row.status !== 'planned') throw new Error(`lane board: ${id} is ${row.status}, not planned; only a planned lane can be claimed`);
  return applySet(board, id, { status: 'starting' }, { by, now });
}

/** One line per lane, for a terminal. */
export function formatBoard(board) {
  if (board.lanes.length === 0) return 'The lane board is empty.';
  return board.lanes
    .map((lane) => {
      const parts = [
        lane.status.padEnd(13),
        lane.id.padEnd(24),
        lane.head ? lane.head.slice(0, 9) : '-'.padEnd(9),
        `r${lane.reviewRound}`,
        lane.title,
      ];
      const after = lane.runsAfter.length ? `  (after ${lane.runsAfter.join(', ')})` : '';
      const waiting = lane.waitingOn ? `  [waiting: ${lane.waitingOn}]` : '';
      return `${parts.join('  ')}${after}${waiting}`;
    })
    .join('\n');
}
