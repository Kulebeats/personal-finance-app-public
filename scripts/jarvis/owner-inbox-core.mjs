// The owner's inbox: the file the control-room mod shows as "waiting on you" and writes through its
// `waiting_add` tool (`Documents/smartcare-handoffs/waiting-on-owner.json`). This module reads and
// changes the same file from scripts and hooks, in the mod's own shape, so a lane's question and a
// permission prompt reach one place. It is the owner's one inbox across projects, so this project's
// questions appear beside the others. See docs/jarvis/README.md.
// Pure, apart from inboxPath(): text in, items out; every change returns a new list.

import { homedir } from 'node:os';
import { join } from 'node:path';

export const INBOX_VERSION = 1;
/** The mod keeps this many answered items; so does this module, so the two never fight over the file. */
export const KEPT_DONE = 30;
/** One question form holds at most this many questions (the form's own limit). */
export const FORM_SIZE = 4;
export const MAX_TEXT = 500;
/** The longest suggested line. The control-room mod's own limit; a longer one is refused, never cut. */
export const MAX_LINE = 600;

export const inboxPath = () =>
  process.env.CAPITAL_OWNER_INBOX || join(homedir(), 'Documents', 'smartcare-handoffs', 'waiting-on-owner.json');

const text = (value) => (typeof value === 'string' ? value : '');
const oneLine = (value) => text(value).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);

/**
 * The items in the inbox file's text. A missing or empty file is an empty inbox. A file that is not
 * JSON THROWS: read as empty, the next writer would replace every open question with its own and a
 * status would say nothing is waiting. Rows are read
 * leniently, as the mod does: one without an id or an ask is skipped.
 */
export function parseInbox(fileText) {
  let json = null;
  try {
    json = JSON.parse(fileText && fileText.trim() ? fileText : '{}');
  } catch (err) {
    throw new Error(`owner inbox: the file is not valid JSON (${err.message}); it is left as it is: repair it by hand`);
  }
  // JSON of the wrong shape is preserved in the same way: read as empty, it would be overwritten.
  const shaped = json && typeof json === 'object' && !Array.isArray(json) && (json.items === undefined || Array.isArray(json.items));
  if (!shaped || (typeof json.version === 'number' && json.version > INBOX_VERSION)) {
    throw new Error('owner inbox: the file is not an inbox of this version (an object with a list of items); it is left as it is: repair it by hand');
  }
  return (json.items ?? [])
    .filter((item) => item && typeof item === 'object' && text(item.id) && text(item.ask))
    .map((item) => ({
      id: item.id, lane: text(item.lane), ask: item.ask, line: text(item.line), session: text(item.session), since: text(item.since), done: item.done === true,
    }));
}

/** The file's text for `items`: answered ones first (the newest KEPT_DONE), then the open ones. */
export function formatInbox(items) {
  const open = items.filter((item) => !item.done);
  const done = items.filter((item) => item.done).slice(-KEPT_DONE);
  return `${JSON.stringify({ version: INBOX_VERSION, items: [...done, ...open] }, null, 2)}\n`;
}

/**
 * Add an open item and return `{ items, item, added }`. The same question asked again (the same id
 * with the same lane and ask, or the same lane and ask under another id) is kept as it is
 * (`added: false`), so a hook that fires twice files one question. An id that is already open for a
 * DIFFERENT question throws. The ask is put on one line; the suggested line is kept exactly.
 */
export function addItem(items, { id, lane, ask, line = '', session = '' }, now = Date.now()) {
  const question = text(ask).replace(/\s+/g, ' ').trim();
  // The suggested line is the wording the owner would paste, perhaps a recorded line: it is kept
  // exactly, and one that does not fit is refused rather than changed.
  const wording = text(line);
  if (question.length > MAX_TEXT) throw new Error(`owner inbox: ask is longer than ${MAX_TEXT} characters; shorten it and put the detail in the results file`);
  if (/[\r\n]/.test(wording)) throw new Error('owner inbox: line must be one line (it holds a line break, which is not removed for you)');
  if (wording.length > MAX_LINE) throw new Error(`owner inbox: line is longer than ${MAX_LINE} characters; it is not cut, so it is not stored`);
  const item = { id: oneLine(id), lane: oneLine(lane), ask: question, line: wording, session: oneLine(session), since: new Date(now).toISOString(), done: false };
  if (!item.id || !item.ask) throw new Error('owner inbox: an item needs an id and an ask');
  const sameId = items.find((other) => other.id === item.id);
  // An id names one question. Two sessions can pick the same id; the second must not be told its
  // different question was filed.
  if (sameId && !sameId.done && (sameId.lane !== item.lane || sameId.ask !== item.ask)) {
    throw new Error(`owner inbox: "${item.id}" is already open for a different question; use a new id`);
  }
  if (sameId && sameId.done) throw new Error(`owner inbox: "${item.id}" was already asked and answered; use a new id`);
  const same = sameId ?? items.find((other) => !other.done && other.lane === item.lane && other.ask === item.ask);
  if (same) return { items, item: same, added: false };
  return { items: [...items, item], item, added: true };
}

/** Mark the item answered. Throws when no open item has that id. */
export function markDone(items, id) {
  if (!items.some((item) => item.id === id && !item.done)) throw new Error(`owner inbox: no open item "${id}"`);
  return items.map((item) => (item.id === id ? { ...item, done: true } : item));
}

/** The open items, oldest first, in groups of FORM_SIZE: one group is one question form. */
export function batches(items) {
  const open = items.filter((item) => !item.done).sort((a, b) => a.since.localeCompare(b.since));
  const groups = [];
  for (let at = 0; at < open.length; at += FORM_SIZE) groups.push(open.slice(at, at + FORM_SIZE));
  return groups;
}
