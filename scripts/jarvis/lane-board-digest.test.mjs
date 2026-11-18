// Lane board: goal, wave and model fields, and the status digest.
// See docs/jarvis/README.md.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { applySet, emptyBoard, parseAssignments, parseBoard } from './lane-board-core.mjs';
import { formatDigest } from './lane-board-digest.mjs';

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const CLI = fileURLToPath(new URL('./lane-board.mjs', import.meta.url));
const add = (board, id, changes, minutesAgo = 0) =>
  applySet(board, id, { title: `Lane ${id}`, ...changes }, { by: 'test', now: NOW - minutesAgo * 60_000 }).board;

describe('goal, wave and model fields', () => {
  it('stores them through set', () => {
    const changes = parseAssignments(['goal=u5-followups', 'wave=1', 'model=sonnet']);
    expect(add(emptyBoard(), 'a', changes).lanes[0]).toMatchObject({ goal: 'u5-followups', wave: '1', model: 'sonnet' });
  });

  it('reads a row written before the fields existed', () => {
    const { goal, wave, model, ...old } = add(emptyBoard(), 'a', {}).lanes[0];
    const board = parseBoard(JSON.stringify({ version: 1, lanes: [old] }));
    expect(board.lanes[0]).toMatchObject({ id: 'a', goal: '', wave: '', model: '' });
  });

  it('refuses a model that is not a lane tier', () => {
    expect(() => add(emptyBoard(), 'a', { model: 'fable' })).toThrow(/model must be/);
  });
});

describe('formatDigest', () => {
  const board = () => {
    let b = add(emptyBoard(), 'cart', { goal: 'u5-followups', wave: '1', status: 'building', head: 'abc1234def' }, 12);
    b = add(b, 'notice', { goal: 'u5-followups', wave: '1', status: 'waiting-owner', waitingOn: 'Q-u5-1' }, 200);
    b = add(b, 'hia2', { goal: 'u5-followups', wave: '2', runsAfter: ['cart'] });
    return add(b, 'stray', { status: 'landed', head: 'abc1234' });
  };

  it('groups lanes by goal and wave, with a count line per goal', () => {
    const text = formatDigest(board(), { now: NOW });
    expect(text).toMatch(/^Goal u5-followups: 3 lanes \(1 building, 1 waiting-owner, 1 planned\)/m);
    expect(text).toMatch(/^ {2}Wave 1\n {4}building\s+cart\s+abc1234de\s+r0\s+Lane cart\s+\(12 min\)/m);
    expect(text).toMatch(/waiting-owner\s+notice.*\[waiting: Q-u5-1\].*\(3 h\)/);
    expect(text).toMatch(/^ {2}Wave 2\n {4}planned\s+hia2.*\(after cart\)/m);
    expect(text).toMatch(/^No goal: 1 lane \(1 landed\)/m);
  });

  it("ends with what waits on the owner, oldest first, and never prints an item's line", () => {
    const waiting = [
      { id: 'Q-u5-1', lane: 'notice', ask: 'Which wording?', line: 'SECRET LINE', since: new Date(NOW - 5 * 3_600_000).toISOString(), done: false },
      { id: 'Q-u5-0', lane: 'cart', ask: 'Old', line: '', since: new Date(NOW - 9 * 3_600_000).toISOString(), done: true },
    ];
    const text = formatDigest(board(), { now: NOW, waiting });
    expect(text).toMatch(/Waiting on the owner: 1 open\n {2}Q-u5-1\s+notice\s+Which wording\?\s+\(5 h\)$/);
    expect(text).not.toMatch(/SECRET|Old/);
  });

  it('says so when the board is empty', () => {
    expect(formatDigest(emptyBoard(), { now: NOW })).toBe('The lane board is empty.\nWaiting on the owner: nothing.');
  });
});

describe('the digest command', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('prints the digest from the board file and the inbox file', () => {
    dir = mkdtempSync(join(tmpdir(), 'lane-digest-'));
    const inbox = join(dir, 'waiting-on-owner.json');
    writeFileSync(inbox, JSON.stringify({ version: 1, items: [{ id: 'Q-1', lane: 'a', ask: 'Pick one', since: new Date().toISOString(), done: false }] }));
    const env = { ...process.env, CAPITAL_LANE_BOARD: join(dir, 'lane-board.json'), CAPITAL_OWNER_INBOX: inbox };
    const cli = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
    cli('set', 'a', 'title=Lane a', 'goal=g1', 'status=building', '--by', 'test');
    expect(cli('digest')).toMatch(/^Goal g1: 1 lane \(1 building\)[\s\S]*Waiting on the owner: 1 open\n {2}Q-1\s+a\s+Pick one/);
  });
});
