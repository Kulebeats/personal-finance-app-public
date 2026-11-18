// The owner's inbox: one place for every question, put to the owner in batches.
// See docs/jarvis/README.md.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FORM_SIZE, KEPT_DONE, addItem, batches, formatInbox, markDone, parseInbox } from './owner-inbox-core.mjs';

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const CLI = fileURLToPath(new URL('./owner-inbox.mjs', import.meta.url));
const ask = (n, extra = {}) => ({ id: `Q-u5-${n}`, lane: `lane-${n}`, ask: `Question ${n}?`, ...extra });
const filled = (count) => Array.from({ length: count }, (_, n) => n).reduce((items, n) => addItem(items, ask(n), NOW + n * 1000).items, []);

describe('addItem', () => {
  it('adds an open item, stamped, on one line', () => {
    const { items, item, added } = addItem([], ask(1, { ask: 'Which\n wording?' }), NOW);
    expect(added).toBe(true);
    expect(item).toEqual({ id: 'Q-u5-1', lane: 'lane-1', ask: 'Which wording?', line: '', session: '', since: '2026-11-12T12:00:00.000Z', done: false });
    expect(items).toEqual([item]);
  });

  it('files a question once: the same id, or the same lane and ask, is not added again', () => {
    const first = addItem([], ask(1), NOW).items;
    expect(addItem(first, ask(1), NOW + 5000)).toMatchObject({ added: false, items: first });
    expect(addItem(first, { ...ask(1), id: 'Q-other' }, NOW + 5000).added).toBe(false);
  });

  it('refuses an item with no ask, and an id that was already answered', () => {
    expect(() => addItem([], { id: 'Q-1', lane: 'a', ask: ' ' })).toThrow(/needs an id and an ask/);
    const answered = markDone(addItem([], ask(1), NOW).items, 'Q-u5-1');
    expect(() => addItem(answered, ask(1, { ask: 'A new question' }), NOW)).toThrow(/already asked and answered/);
  });

  it('leaves the list it was given unchanged', () => {
    const before = [];
    addItem(before, ask(1), NOW);
    expect(before).toEqual([]);
  });
});

describe('markDone and batches', () => {
  it('marks one item answered and refuses an id that is not open', () => {
    const items = markDone(filled(2), 'Q-u5-0');
    expect(items.map((item) => item.done)).toEqual([true, false]);
    expect(() => markDone(items, 'Q-u5-0')).toThrow(/no open item/);
  });

  it('groups the open items oldest first, one form at a time', () => {
    const groups = batches(markDone(filled(FORM_SIZE + 2), 'Q-u5-1'));
    expect(groups.map((group) => group.map((item) => item.id))).toEqual([['Q-u5-0', 'Q-u5-2', 'Q-u5-3', 'Q-u5-4'], ['Q-u5-5']]);
  });
});

describe('the file', () => {
  it('round-trips in the shape the control-room mod reads', () => {
    const items = filled(2);
    expect(JSON.parse(formatInbox(items))).toEqual({ version: 1, items });
    expect(parseInbox(formatInbox(items))).toEqual(items);
  });

  it('keeps the newest answered items only, and refuses a broken file rather than reading it as empty', () => {
    const many = filled(KEPT_DONE + 3).map((item) => ({ ...item, done: true }));
    expect(parseInbox(formatInbox(many))).toHaveLength(KEPT_DONE);
    expect(() => parseInbox('not json')).toThrow(/not valid JSON/);
    expect(parseInbox(JSON.stringify({ items: [{ id: 'x' }, { id: 'y', ask: 'ok' }] }))).toHaveLength(1);
  });
});

describe('the CLI on a real file', () => {
  let dir = '';
  let env = {};
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'owner-inbox-'));
    env = { ...process.env, CAPITAL_OWNER_INBOX: join(dir, 'waiting-on-owner.json') };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const cli = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', stdio: 'pipe' });

  it('adds, lists, batches as JSON and marks done', () => {
    expect(cli('add', '--id', 'Q-u5-1', '--lane', 'cart', '--ask', 'Which wording?')).toMatch(/added Q-u5-1/);
    expect(cli('add', '--id', 'Q-u5-1', '--lane', 'cart', '--ask', 'Which wording?')).toMatch(/already open/);
    expect(cli('list')).toMatch(/Q-u5-1\s+cart\s+Which wording\?/);
    expect(JSON.parse(cli('batch'))).toMatchObject([[{ id: 'Q-u5-1', lane: 'cart' }]]);
    expect(cli('done', 'Q-u5-1')).toMatch(/done Q-u5-1/);
    expect(cli('list')).toMatch(/nothing/i);
    expect(JSON.parse(readFileSync(env.CAPITAL_OWNER_INBOX, 'utf8')).items[0].done).toBe(true);
  });

  it('keeps items the mod wrote and exits 1 on a refused call', () => {
    writeFileSync(env.CAPITAL_OWNER_INBOX, JSON.stringify({ version: 1, items: [{ id: 'wm1', lane: 'fp', ask: 'Sign?', line: 'L', session: 's', since: '2026-11-12T01:00:00.000Z', done: false }] }));
    cli('add', '--id', 'Q-2', '--lane', 'cart', '--ask', 'Next?');
    expect(JSON.parse(readFileSync(env.CAPITAL_OWNER_INBOX, 'utf8')).items.map((item) => item.id)).toEqual(['wm1', 'Q-2']);
    expect(() => cli('done', 'Q-missing')).toThrow();
  });
});
