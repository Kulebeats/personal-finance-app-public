// Goal intake: a goal plan becomes board rows and done-means files, or is refused with every reason.
// See docs/jarvis/README.md.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { goalLine, planToRows, renderDoneMeans, validatePlan } from './goal-intake-core.mjs';
import { applySet, emptyBoard } from './lane-board-core.mjs';

const CLI = fileURLToPath(new URL('./goal-intake.mjs', import.meta.url));
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const lane = (id, extra = {}) => ({
  id,
  title: `Lane ${id}`,
  wave: '1',
  model: 'opus',
  branch: `claude/${id}`,
  worktree: `C:/Dev/pfa-${id}`,
  base: 'abc1234',
  auditId: 'REVIEW-GOALS-001',
  do: ['Show the cart error in the modal'],
  doNotTouch: ['server/modules/goals/ - another lane owns it'],
  checks: [{ command: 'node vitest.mjs run cart --maxWorkers=1', expect: 'Test Files 3 passed' }],
  ...extra,
});
const plan = (lanes = [lane('cart'), lane('notice', { wave: '2', model: 'sonnet', runsAfter: ['cart'] })]) => ({
  goal: 'u5-followups',
  title: 'Under-Five follow-ups',
  lanes,
});
const errorsOf = (p, board = emptyBoard()) => validatePlan(p, board).join('\n');

describe('validatePlan', () => {
  it('accepts a complete plan', () => {
    expect(validatePlan(plan(), emptyBoard())).toEqual([]);
  });

  it('refuses a lane with nothing to do or no check that proves it', () => {
    expect(errorsOf(plan([lane('cart', { do: [] })]))).toMatch(/cart: "do" needs at least one item/);
    expect(errorsOf(plan([lane('cart', { checks: [] })]))).toMatch(/cart: needs at least one check/);
    expect(errorsOf(plan([lane('cart', { checks: [{ command: 'run it' }] })]))).toMatch(/cart: check 1 needs a command and the summary line expected/);
  });

  it('refuses a model that is not a lane tier, a missing branch and a duplicate id', () => {
    const errors = errorsOf(plan([lane('cart', { model: 'fable', branch: '' }), lane('cart')]));
    expect(errors).toMatch(/cart: model must be one of/);
    expect(errors).toMatch(/cart: branch is required/);
    expect(errors).toMatch(/"cart" is used by more than one lane/);
  });

  it('refuses a dependency that exists nowhere, and a loop', () => {
    expect(errorsOf(plan([lane('cart', { runsAfter: ['ghost'] })]))).toMatch(/cart: runsAfter names "ghost"/);
    expect(errorsOf(plan([lane('a', { runsAfter: ['b'] }), lane('b', { runsAfter: ['a'] })]))).toMatch(/runsAfter makes a loop/);
  });

  it('accepts a dependency on a lane already on the board, and refuses to take over a lane of another goal', () => {
    const board = applySet(emptyBoard(), 'pr2', { title: 'PR 2', goal: 'u5-pr2' }, { by: 'test', now: NOW }).board;
    expect(validatePlan(plan([lane('cart', { runsAfter: ['pr2'] })]), board)).toEqual([]);
    expect(errorsOf(plan([lane('pr2')]), board)).toMatch(/"pr2" is already on the board under goal "u5-pr2"/);
  });

  it('refuses more than five lanes in one wave', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => lane(id));
    expect(errorsOf(plan(six))).toMatch(/wave 1 has 6 lanes; at most 5 lanes go in one wave/);
    expect(validatePlan(plan(six.slice(0, 5)), emptyBoard())).toEqual([]);
  });

  it('accepts exactly the opus, sonnet and haiku lane tiers', () => {
    for (const model of ['opus', 'sonnet', 'haiku']) expect(validatePlan(plan([lane('cart', { model })]), emptyBoard())).toEqual([]);
    for (const model of ['fable', 'gpt', 'Opus']) expect(errorsOf(plan([lane('cart', { model })]))).toMatch(/cart: model must be one of: opus, sonnet, haiku/);
  });
});

describe('renderDoneMeans and goalLine', () => {
  it('fills every heading of the template and leaves no placeholder', () => {
    const text = renderDoneMeans(plan(), plan().lanes[1]);
    expect(text).toMatch(/^# Done means: Lane notice$/m);
    expect(text).toMatch(/\*\*Runs after:\*\* `cart`/);
    expect(text).toMatch(/## 1\. Do\n\n- \[ \] Show the cart error in the modal/);
    expect(text).toMatch(/\| `node vitest\.mjs run cart --maxWorkers=1` \| `Test Files 3 passed` \|/);
    expect(text).toMatch(/## 4\. Owner rulings and sign-offs needed, by ID\n\n- none: this lane needs no owner ruling or sign-off/);
    expect(text).not.toMatch(/<[^>\n]*>/);
  });

  it('names the sign-offs and the ruling a lane waits for', () => {
    const waiting = lane('cart', { signOffIds: ['SO-GOALS-7'], rulingOwed: 'The owner rules on the wording' });
    const text = renderDoneMeans(plan([waiting]), waiting);
    expect(text).toMatch(/- `SO-GOALS-7`/);
    expect(text).toMatch(/Ruling owed before any code: The owner rules on the wording/);
  });

  it('caps the goal by turns: 60 on Opus, 40 on Sonnet, or the number the lane gives', () => {
    expect(goalLine(lane('cart'), 'docs/x-done-means.md')).toBe(
      '/goal every check in section 3 of docs/x-done-means.md passes with its expected summary line, the results file is written and the board row says built; or a ruling is needed and the row says waiting-owner; or stop after 60 turns',
    );
    expect(goalLine(lane('n', { model: 'sonnet' }), 'd.md')).toMatch(/stop after 40 turns$/);
    expect(goalLine(lane('n', { model: 'haiku' }), 'd.md')).toMatch(/stop after 40 turns$/);
    expect(goalLine(lane('n', { turnCap: 25 }), 'd.md')).toMatch(/stop after 25 turns$/);
  });
});

describe('the example plan in docs/jarvis', () => {
  it('is a plan goal intake accepts', () => {
    const example = fileURLToPath(new URL('../../docs/jarvis/goal-plan.example.json', import.meta.url));
    expect(validatePlan(JSON.parse(readFileSync(example, 'utf8')), emptyBoard())).toEqual([]);
  });
});

describe('planToRows', () => {
  it('orders rows so that a lane comes after the lanes it runs after', () => {
    const rows = planToRows(plan([lane('notice', { runsAfter: ['cart'] }), lane('cart')]), { dir: 'docs/jarvis/done-means', now: NOW });
    expect(rows.map((row) => row.id)).toEqual(['cart', 'notice']);
    expect(rows[1].changes).toMatchObject({
      title: 'Lane notice',
      status: 'planned',
      goal: 'u5-followups',
      wave: '1',
      model: 'opus',
      branch: 'claude/notice',
      runsAfter: ['cart'],
      signOffIds: [],
      doneMeans: 'docs/jarvis/done-means/12-11-2026_notice-done-means.md',
    });
  });
});

describe('the CLI', () => {
  let dir = '';
  let env = {};
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'goal-intake-'));
    env = { ...process.env, CAPITAL_LANE_BOARD: join(dir, 'lane-board.json') };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const cli = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', stdio: 'pipe' });
  const save = (p) => {
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(p));
    return join(dir, 'plan.json');
  };

  it('checks a plan without writing anything', () => {
    expect(cli('check', save(plan()))).toMatch(/2 lanes in 2 waves[\s\S]*cart[\s\S]*notice/);
    expect(() => readFileSync(env.CAPITAL_LANE_BOARD)).toThrow();
  });

  it('applies a plan: planned rows on the board and one done-means file per lane', () => {
    // The owner's words are quoted as given: letters untouched, runs of whitespace as one space.
    expect(cli('apply', save(plan()), '--by', 'coordinator', '--out', dir, '--approved', 'Yes,  this passes\nas written')).toMatch(/2 lanes planned/);
    const board = JSON.parse(readFileSync(env.CAPITAL_LANE_BOARD, 'utf8'));
    expect(readFileSync(board.lanes[1].doneMeans, 'utf8')).toMatch(/The owner approved this goal's plan: "Yes, this passes as written" \(recorded by coordinator, \d{4}-\d\d-\d\dT/);
    expect(board.lanes.map((row) => [row.id, row.status, row.goal, row.updatedBy])).toEqual([
      ['cart', 'planned', 'u5-followups', 'coordinator'],
      ['notice', 'planned', 'u5-followups', 'coordinator'],
    ]);
    expect(readFileSync(board.lanes[0].doneMeans, 'utf8')).toMatch(/^# Done means: Lane cart/);
  });

  it('puts nothing on the board before the owner has approved the plan', () => {
    expect(() => cli('apply', save(plan()), '--by', 'coordinator', '--out', dir)).toThrow(/approved/);
    expect(() => readFileSync(env.CAPITAL_LANE_BOARD)).toThrow();
  });

  it('exits 1 with every reason and writes nothing when the plan is refused', () => {
    let failure = null;
    try {
      cli('apply', save(plan([lane('cart', { do: [], checks: [] })])), '--by', 'coordinator', '--out', dir, '--approved', 'ok');
    } catch (err) {
      failure = err;
    }
    expect(failure?.status).toBe(1);
    expect(String(failure.stderr)).toMatch(/"do" needs at least one item[\s\S]*needs at least one check/);
    expect(() => readFileSync(env.CAPITAL_LANE_BOARD)).toThrow();
  });
});
