// The coordinator's tick: what needs doing now, read from files alone, so any fresh session can run it.
// See docs/jarvis/README.md.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_RUNNING, tickFlags } from './jarvis-tick-core.mjs';
import { lastTranscriptWrite } from './jarvis-tick.mjs';
import { applySet, emptyBoard, worktreeFolder } from './lane-board-core.mjs';

const CLI = fileURLToPath(new URL('./jarvis-tick.mjs', import.meta.url));
const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const minutesAgo = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
const add = (board, id, changes, ago = 0) => applySet(board, id, { title: `Lane ${id}`, ...changes }, { by: 'test', now: NOW - ago * 60_000 }).board;
const kinds = (flags) => flags.map((flag) => `${flag.kind}${flag.lane ? `:${flag.lane}` : ''}`);
const flagsOf = (board, extra = {}) => tickFlags(board, { now: NOW, ...extra });

describe('tickFlags', () => {
  it('names a planned lane whose earlier lanes have all landed as ready to start', () => {
    let board = add(emptyBoard(), 'a', { status: 'landed', head: 'abc1234' });
    board = add(board, 'b', { runsAfter: ['a'] });
    board = add(board, 'c', { runsAfter: ['b'] });
    board = add(board, 'd', {});
    expect(kinds(flagsOf(board))).toEqual(['ready:b', 'ready:d']);
  });

  it('starts no lane past three running at once', () => {
    let board = emptyBoard();
    for (const id of ['a', 'b', 'c']) board = add(board, id, { status: 'building' });
    board = add(board, 'f', {});
    const flags = flagsOf(board);
    expect(MAX_RUNNING).toBe(3);
    expect(kinds(flags)).toEqual(['capacity']);
    expect(flags[0].message).toMatch(/3 lanes are running/);
  });

  it('names only as many ready lanes as there are free places', () => {
    let board = add(emptyBoard(), 'a', { status: 'building' });
    for (const id of ['b', 'c', 'd']) board = add(board, id, {});
    expect(kinds(flagsOf(board))).toEqual(['ready:b', 'ready:c']);
  });

  it('flags a working lane that has been quiet for 30 minutes, by its row or its transcript', () => {
    let board = add(emptyBoard(), 'quiet', { status: 'building' }, 45);
    board = add(board, 'busy', { status: 'in-review' }, 45);
    board = add(board, 'done', { status: 'built' }, 300);
    const flags = flagsOf(board, { activity: { busy: minutesAgo(5), quiet: minutesAgo(40) } });
    expect(kinds(flags)).toEqual(['quiet:quiet']);
    expect(flags[0].message).toMatch(/quiet for 40 min/);
  });

  it('flags an old lock, old questions and a gap since the last tick', () => {
    const waiting = [{ id: 'Q-1', lane: 'a', ask: 'Pick', since: minutesAgo(13 * 60), done: false }, { id: 'Q-2', lane: 'a', ask: 'Pick', since: minutesAgo(5), done: false }];
    const flags = flagsOf(emptyBoard(), { lock: { ageMin: 50, owner: 'U5-COORD-GATES' }, waiting, lastTickAt: minutesAgo(200) });
    expect(kinds(flags)).toEqual(['gap', 'lock', 'waiting']);
    expect(flags[0].message).toMatch(/No tick for 3 h.*re-probe every running lane/);
    expect(flags[1].message).toMatch(/held for 50 min by U5-COORD-GATES/);
    expect(flags[2].message).toMatch(/1 question has waited over 12 hours/);
  });

  it('flags nothing on a quiet board with a recent tick', () => {
    const board = add(emptyBoard(), 'a', { status: 'building' }, 5);
    expect(flagsOf(board, { lock: { ageMin: 10, owner: 'x' }, lastTickAt: minutesAgo(20) })).toEqual([]);
  });
});

describe('lastTranscriptWrite', () => {
  const WORKTREE = 'C:/Dev/pfa-quiet-lane';
  const previous = process.env.CAPITAL_CLAUDE_PROJECTS;
  let dir = '';
  const otherSessionOnly = () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-transcripts-'));
    process.env.CAPITAL_CLAUDE_PROJECTS = dir;
    mkdirSync(join(dir, worktreeFolder(WORKTREE)));
    writeFileSync(join(dir, worktreeFolder(WORKTREE), 'other-session.jsonl'), '{}\n');
  };
  afterEach(() => {
    if (previous === undefined) delete process.env.CAPITAL_CLAUDE_PROJECTS;
    else process.env.CAPITAL_CLAUDE_PROJECTS = previous;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reports no activity when the recorded session has no transcript, whatever other sessions wrote', () => {
    otherSessionOnly();
    expect(lastTranscriptWrite(WORKTREE, 'lane-session')).toBe('');
  });

  it('falls back to the newest transcript in the worktree only for a row without a session', () => {
    otherSessionOnly();
    expect(Date.parse(lastTranscriptWrite(WORKTREE, ''))).toBeGreaterThan(0);
  });
});

describe('the tick command', () => {
  let dir = '';
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('prints the digest and the flags, and stamps the tick', () => {
    dir = mkdtempSync(join(tmpdir(), 'jarvis-tick-'));
    const env = {
      ...process.env,
      CAPITAL_LANE_BOARD: join(dir, 'lane-board.json'),
      CAPITAL_OWNER_INBOX: join(dir, 'waiting-on-owner.json'),
      CAPITAL_TICK_STAMP: join(dir, 'jarvis-tick.json'),
      CAPITAL_HEAVY_LOCK: join(dir, 'heavy-run.lock'),
      // Nothing outside the temporary folder: not the real transcripts.
      CAPITAL_CLAUDE_PROJECTS: join(dir, 'projects'),
    };
    writeFileSync(env.CAPITAL_LANE_BOARD, JSON.stringify(add(emptyBoard(), 'cart', { goal: 'g1' })));
    mkdirSync(env.CAPITAL_HEAVY_LOCK);
    writeFileSync(join(env.CAPITAL_HEAVY_LOCK, 'owner.txt'), 'U5-LANE review 11:59:00Z\n');
    const cli = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });

    const first = cli();
    expect(first).toMatch(/^Goal g1: 1 lane \(1 planned\)/);
    expect(first).toMatch(/Heavy-run lock: held for 0 min by U5-LANE review/);
    expect(first).toMatch(/Flags\n {2}ready\s+cart\s+/);
    const stamp = JSON.parse(readFileSync(env.CAPITAL_TICK_STAMP, 'utf8'));
    expect(Date.parse(stamp.lastTickAt)).toBeGreaterThan(0);

    writeFileSync(env.CAPITAL_TICK_STAMP, JSON.stringify({ lastTickAt: new Date(Date.now() - 4 * 3_600_000).toISOString() }));
    expect(cli('--no-stamp')).toMatch(/gap\s+No tick for 4 h/);
    expect(Date.now() - Date.parse(JSON.parse(readFileSync(env.CAPITAL_TICK_STAMP, 'utf8')).lastTickAt)).toBeGreaterThan(3 * 3_600_000);
  });
});
