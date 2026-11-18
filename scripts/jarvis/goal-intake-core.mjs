// Goal intake: a goal plan (waves and lanes, drafted for one owner goal) becomes lane-board rows
// and one "done means" file per lane. See docs/jarvis/README.md.
// Pure: a plan and a board come in; errors, rows or text go out.
//
// A plan is JSON: { goal, title, lanes: [{ id, title, wave, model, branch, worktree, base, auditId,
// runsAfter?, signOffIds?, rulingOwed?, do: [..], doNotTouch?: [..],
// checks: [{ command, expect }], landed?: [..], turnCap? }] }.
// Drafting the plan is model work; this module only refuses a plan a lane could not run from.

import { LANE_MODELS, validateRow } from './lane-board-core.mjs';

/** At most this many related lanes are planned into one wave. */
export const MAX_LANES_PER_WAVE = 5;
/** The turn cap written into a lane's goal line: 60 on Opus, 40 on Sonnet. Haiku lanes take the Sonnet cap. */
export const TURN_CAPS = Object.freeze({ opus: 60, sonnet: 40, haiku: 40 });

const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : []);
const lanesOf = (plan) => (Array.isArray(plan?.lanes) ? plan.lanes.filter((lane) => lane && typeof lane === 'object') : []);

// A lane that waits for an owner ruling before any code goes on the board `held`, with the ruling
// named, so the tick never calls it ready; the coordinator sets it to `planned` once the ruling exists.
const RULING_OWED = 'ruling owed before any code: ';
function rulingOwed(lane) {
  return lane.rulingOwed ? `${RULING_OWED}${String(lane.rulingOwed).replace(/\s+/g, ' ').trim()}`.slice(0, 200) : '';
}

const rowFor = (plan, lane, doneMeans = '') => ({
  id: lane.id,
  title: lane.title ?? '',
  branch: lane.branch ?? '',
  worktree: lane.worktree ?? '',
  session: '',
  status: lane.rulingOwed ? 'held' : 'planned',
  reviewRound: 0,
  head: '',
  runsAfter: list(lane.runsAfter),
  waitingOn: rulingOwed(lane),
  signOffIds: list(lane.signOffIds),
  doneMeans,
  goal: plan.goal ?? '',
  wave: String(lane.wave ?? ''),
  model: lane.model ?? '',
  updatedAt: '',
  updatedBy: 'goal plan',
});

// A held lane is checked as it will be once released, or a clash only shows when the coordinator
// releases it, after the lanes are on the board.
const released = (plan, lane, doneMeans = '') => ({ ...rowFor(plan, lane, doneMeans), status: 'planned', waitingOn: '' });

function laneErrors(plan, lane, others, doneMeans) {
  const errors = validateRow(released(plan, lane, doneMeans), others);
  if (!lane.branch) errors.push('branch is required');
  if (!lane.model) errors.push(`model must be one of: ${LANE_MODELS.join(', ')}`);
  if (!String(lane.wave ?? '').trim()) errors.push('wave is required');
  if (list(lane.do).length === 0) errors.push('"do" needs at least one item');
  // A list given as text, or with an empty entry, is refused: read leniently it would be dropped, and a
  // lane would lose its prerequisite.
  for (const field of ['runsAfter', 'signOffIds']) {
    const given = lane[field];
    if (given !== undefined && !(Array.isArray(given) && given.every((item) => typeof item === 'string' && item.trim()))) errors.push(`${field} must be a list of names`);
  }
  const checks = Array.isArray(lane.checks) ? lane.checks : [];
  if (checks.length === 0) errors.push('needs at least one check that proves it');
  checks.forEach((check, index) => {
    if (!check?.command || !check?.expect) errors.push(`check ${index + 1} needs a command and the summary line expected`);
  });
  return errors.map((error) => `${lane.id}: ${error}`);
}

/**
 * Every reason the plan cannot be put on `board`. Empty when it can. With `dir`, each row carries the
 * done-means path apply will write, so `check` refuses what apply would.
 */
export function validatePlan(plan, board, { dir = null, now = Date.now() } = {}) {
  const doneMeansOf = (lane) => (dir ? doneMeansPath(dir, lane, now) : '');
  const lanes = lanesOf(plan);
  const errors = [];
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(plan?.goal ?? '')) errors.push('goal must be lower-case letters, digits and dashes, at most 48');
  if (lanes.length === 0) errors.push('a goal plan needs at least one lane');
  // The title is written into every done-means file.
  const title = plan?.title;
  if (title !== undefined && (typeof title !== 'string' || /[\r\n]/.test(title))) errors.push('title must be one line of text');
  const ids = lanes.map((lane) => lane.id);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) errors.push(`"${id}" is used by more than one lane`);
  const rows = lanes.map((lane) => released(plan, lane, doneMeansOf(lane)));
  lanes.forEach((lane, index) => {
    const onBoard = board.lanes.find((row) => row.id === lane.id);
    if (onBoard && onBoard.goal !== plan.goal) errors.push(`"${lane.id}" is already on the board under goal "${onBoard.goal}"; pick another id`);
    const others = [...board.lanes.filter((row) => !ids.includes(row.id)), ...rows.filter((_, at) => at !== index)];
    errors.push(...laneErrors(plan, lane, others, doneMeansOf(lane)));
  });
  const waves = new Map();
  for (const lane of lanes) waves.set(String(lane.wave ?? ''), (waves.get(String(lane.wave ?? '')) ?? 0) + 1);
  for (const [wave, count] of waves) {
    if (count > MAX_LANES_PER_WAVE) errors.push(`wave ${wave} has ${count} lanes; at most ${MAX_LANES_PER_WAVE} lanes go in one wave`);
  }
  return [...new Set(errors)];
}

/** The `/goal` line for a lane's brief. `/goal` has no turn setting, so the cap is words in the condition. */
export function goalLine(lane, doneMeansPath) {
  const cap = Number.isInteger(lane.turnCap) && lane.turnCap > 0 ? lane.turnCap : (TURN_CAPS[lane.model] ?? TURN_CAPS.sonnet);
  return (
    `/goal every check in section 3 of ${doneMeansPath} passes with its expected summary line, the results file is written ` +
    `and the board row says built; or a ruling is needed and the row says waiting-owner; or stop after ${cap} turns`
  );
}

const bullets = (items, mark = '- ') => items.map((item) => `${mark}${item}`).join('\n');

/** `text` as a code span in a table cell: a pipe escaped, a fence longer than any backtick run in it. */
function codeCell(text) {
  const plain = String(text).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
  const fence = '`'.repeat(Math.max(0, ...(plain.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  const pad = fence.length > 1 || plain.startsWith('`') || plain.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${plain}${pad}${fence}`;
}

function signOffSection(lane) {
  const ids = list(lane.signOffIds);
  if (ids.length === 0 && !lane.rulingOwed) return '- none: this lane needs no owner ruling or sign-off';
  const lines = ids.map((id) => `- \`${id}\``);
  if (lane.rulingOwed) lines.push(`- Ruling owed before any code: ${lane.rulingOwed}`);
  return lines.join('\n');
}

/** The lane's "done means" file, every heading of the template filled. */
export function renderDoneMeans(plan, lane) {
  const after = list(lane.runsAfter);
  const untouched = list(lane.doNotTouch);
  return [
    `# Done means: ${lane.title}`,
    '',
    `> Goal \`${plan.goal}\` (${plan.title ?? plan.goal}), wave ${lane.wave}. Written by goal intake before the lane starts.`,
    '> The lane brief (`docs/jarvis/lane-brief-template.md`) applies in full; this file says what THIS lane owes.',
    '',
    `- **Lane id:** \`${lane.id}\``,
    `- **Branch / worktree:** \`${lane.branch}\` in \`${lane.worktree || 'the worktree its session is given'}\`, cut from \`${lane.base || 'the base named in the brief'}\``,
    `- **Audit ID:** \`${lane.auditId || 'none yet: the lane names one before its first review'}\` (one per branch)`,
    `- **Runs after:** ${after.length ? after.map((id) => `\`${id}\``).join(', ') : 'nothing'}`,
    `- **Model:** ${lane.model}`,
    '',
    '## 1. Do',
    '',
    bullets(list(lane.do), '- [ ] '),
    '',
    '## 2. Do not touch',
    '',
    untouched.length ? bullets(untouched) : '- Everything outside the items in section 1.',
    '',
    '## 3. Checks that prove it',
    '',
    '| Command | Expected summary line |',
    '|---|---|',
    ...lane.checks.map((check) => `| ${codeCell(check.command)} | ${codeCell(check.expect)} |`),
    '',
    '## 4. Owner rulings and sign-offs needed, by ID',
    '',
    signOffSection(lane),
    '',
    '## 5. What "landed" requires',
    '',
    '- A pull request against `main` from the lane\'s branch, with GitHub CI green at the final head.',
    '- At most 2 review rounds; every finding fixed in its own commit or set out for the owner to decide.',
    '- The owner merges the pull request. A lane never merges, and never pushes to `main`.',
    ...list(lane.landed).map((item) => `- ${item}`),
    '',
  ].join('\n');
}

const pad = (number) => String(number).padStart(2, '0');
const dated = (now) => {
  const date = new Date(now);
  return `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}`;
};

/** The done-means file path for a lane: `<dir>/DD-MM-YYYY_<lane id>-done-means.md`. */
export const doneMeansPath = (dir, lane, now) => `${String(dir).replace(/\\/g, '/').replace(/\/$/, '')}/${dated(now)}_${lane.id}-done-means.md`;

/** Board changes for every lane, `[{ id, changes }]`, a lane after the lanes it runs after. For a valid plan. */
export function planToRows(plan, { dir, now = Date.now() }) {
  const pending = [...lanesOf(plan)];
  const placed = [];
  while (pending.length) {
    const at = pending.findIndex((lane) => list(lane.runsAfter).every((id) => !pending.some((other) => other.id === id)));
    if (at === -1) throw new Error('goal intake: runsAfter makes a loop; validate the plan first');
    placed.push(pending.splice(at, 1)[0]);
  }
  return placed.map((lane) => {
    const { id, session, reviewRound, head, updatedAt, updatedBy, ...changes } = rowFor(plan, lane, doneMeansPath(dir, lane, now));
    return { id, changes };
  });
}
