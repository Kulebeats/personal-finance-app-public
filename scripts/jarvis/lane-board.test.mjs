// Lane board contract. See docs/jarvis/README.md.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { applySet, emptyBoard, formatBoard, parseAssignments, parseBoard } from './lane-board-core.mjs';

const NOW = Date.UTC(2026, 10, 12, 1, 0, 0);
const BY = { by: 'test lane', now: NOW };
const CLI = fileURLToPath(new URL('./lane-board.mjs', import.meta.url));

const withLane = (id, changes = {}) =>
  applySet(emptyBoard(), id, { title: `Lane ${id}`, ...changes }, BY).board;

describe('applySet', () => {
  it('adds a new lane with defaults and stamps who wrote it and when', () => {
    const { board, row } = applySet(emptyBoard(), 'fp-wave-5', { title: 'FP wave 5' }, BY);
    expect(board.lanes).toHaveLength(1);
    expect(row).toMatchObject({ id: 'fp-wave-5', status: 'planned', reviewRound: 0, runsAfter: [], updatedBy: 'test lane' });
    expect(row.updatedAt).toBe('2026-11-12T01:00:00.000Z');
  });

  it('returns a new board and leaves the old one unchanged', () => {
    const before = withLane('a');
    const after = applySet(before, 'a', { status: 'building' }, BY).board;
    expect(before.lanes[0].status).toBe('planned');
    expect(after.lanes[0].status).toBe('building');
  });

  it('refuses a status outside the list', () => {
    expect(() => applySet(emptyBoard(), 'a', { title: 'A', status: 'done' }, BY)).toThrow(/status must be one of/);
  });

  it('refuses a third review round, the lane rules cap', () => {
    expect(() => applySet(withLane('a'), 'a', { reviewRound: 3 }, BY)).toThrow(/reviewRound/);
  });

  it('refuses runsAfter naming a lane not on the board, or itself', () => {
    expect(() => applySet(withLane('a'), 'b', { title: 'B', runsAfter: ['zzz'] }, BY)).toThrow(/not on the board/);
    expect(() => applySet(withLane('a'), 'a', { runsAfter: ['a'] }, BY)).toThrow(/after itself/);
    expect(applySet(withLane('a'), 'b', { title: 'B', runsAfter: ['a'] }, BY).row.runsAfter).toEqual(['a']);
  });

  it('refuses a fourth lane taking a running place while three hold one', () => {
    let board = emptyBoard();
    for (const id of ['a', 'b', 'c']) board = applySet(board, id, { title: `Lane ${id}`, status: 'building' }, BY).board;
    board = applySet(board, 'd', { title: 'Lane d' }, BY).board;
    expect(() => applySet(board, 'd', { status: 'starting' }, BY)).toThrow(/3 lanes already hold a place/);
    expect(applySet(board, 'a', { status: 'built' }, BY).row.status).toBe('built');
  });

  it('needs waitingOn for waiting-owner, a head for landed, and a writer', () => {
    expect(() => applySet(withLane('a'), 'a', { status: 'waiting-owner' }, BY)).toThrow(/waitingOn/);
    expect(() => applySet(withLane('a'), 'a', { status: 'landed' }, BY)).toThrow(/head/);
    expect(() => applySet(withLane('a'), 'a', { status: 'built' }, { by: ' ', now: NOW })).toThrow(/--by/);
  });

  it('refuses a head that is not a hex SHA', () => {
    expect(() => applySet(withLane('a'), 'a', { head: 'main' }, BY)).toThrow(/hex SHA/);
  });
});

describe('parseAssignments and parseBoard', () => {
  it('types numbers and lists and clears on an empty value', () => {
    expect(parseAssignments(['reviewRound=1', 'signOffIds=SO-GOALS-4, SO-BUDGET-2', 'waitingOn='])).toEqual({
      reviewRound: 1,
      signOffIds: ['SO-GOALS-4', 'SO-BUDGET-2'],
      waitingOn: '',
    });
  });

  it('refuses an unknown field and a missing =', () => {
    expect(() => parseAssignments(['updatedBy=me'])).toThrow(/unknown field/);
    expect(() => parseAssignments(['status'])).toThrow(/key=value/);
  });

  it('reads an empty file as an empty board and refuses another shape', () => {
    expect(parseBoard('')).toEqual(emptyBoard());
    expect(() => parseBoard('{"lanes": {}}')).toThrow(/expected/);
  });

  it('formats one line per lane', () => {
    expect(formatBoard(emptyBoard())).toBe('The lane board is empty.');
    expect(formatBoard(withLane('a', { status: 'building' }))).toMatch(/^building\s+a\s+/);
  });
});

describe('the CLI on a real file', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('writes through set, reads back through show, and exits 1 on a refused row', () => {
    dir = mkdtempSync(join(tmpdir(), 'lane-board-'));
    const file = join(dir, 'lane-board.json');
    const env = { ...process.env, CAPITAL_LANE_BOARD: file };
    const cli = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });

    expect(cli('set', 'u5-pr2', 'title=Under-5 second PR', 'status=building', '--by', 'u5 lane')).toMatch(/saved u5-pr2: building/);
    expect(JSON.parse(cli('show', 'u5-pr2'))).toMatchObject({ id: 'u5-pr2', updatedBy: 'u5 lane' });
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);

    let status = 0;
    try {
      execFileSync(process.execPath, [CLI, 'set', 'u5-pr2', 'status=finished', '--by', 'x'], { env, stdio: 'pipe' });
    } catch (err) {
      status = err.status;
    }
    expect(status).toBe(1);
    expect(JSON.parse(cli('show', 'u5-pr2')).status).toBe('building');
  });
});
