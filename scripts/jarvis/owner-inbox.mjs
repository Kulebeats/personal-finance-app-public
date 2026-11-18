#!/usr/bin/env node
// The owner inbox CLI: how the coordinator and lanes file a question for the owner from a shell,
// and how the coordinator turns the open questions into question forms.
// See docs/jarvis/README.md.
//
//   node scripts/jarvis/owner-inbox.mjs list
//   node scripts/jarvis/owner-inbox.mjs add --id Q-<goal>-<n> --lane "<lane>" --ask "<one line>" [--line "<draft>"] [--session <id>]
//   node scripts/jarvis/owner-inbox.mjs batch      (open items as JSON, oldest first, four to a form)
//   node scripts/jarvis/owner-inbox.mjs done <id>  (after the owner's answer is recorded where it belongs)
//
// The file is the control-room mod's own (`waiting-on-owner.json`); CAPITAL_OWNER_INBOX overrides
// the path for tests. Marking an item done records no answer and authorizes nothing: the answer is
// written, verbatim, to the lane by whoever asked.
//
// Every change here is one locked read-change-write (file-lock.mjs), so two lanes adding at once
// both keep their question. The control-room mod writes the same file without this lock; until it
// takes it too, a write of the mod's can still race one of these. A file that is not valid JSON is
// never overwritten.

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { withFileLock, writeFileAtomic } from './file-lock.mjs';
import { age } from './lane-board-digest.mjs';
import { addItem, batches, formatInbox, inboxPath, markDone, parseInbox } from './owner-inbox-core.mjs';

const FLAGS = ['id', 'lane', 'ask', 'line', 'session'];

/** The items in the file. Throws when the file is there but is not valid JSON. */
export const readInbox = (path) => parseInbox(existsSync(path) ? readFileSync(path, 'utf8') : '');

/** The items, or null when the file cannot be read: for a status that must say so rather than fail. */
export function readInboxOrNull(path) {
  try {
    return readInbox(path);
  } catch {
    return null;
  }
}

/**
 * One locked read-change-write. `change(items)` returns the new list, or null to write nothing;
 * the value it returns is passed back. Throws, and writes nothing, when the file is not valid JSON.
 */
export function changeInbox(path, change) {
  return withFileLock(
    path,
    () => {
      const next = change(readInbox(path));
      if (next) writeFileAtomic(path, formatInbox(next));
      return next;
    },
    'owner inbox',
  );
}

function flagsOf(args) {
  const flags = {};
  for (let at = 0; at < args.length; at += 2) {
    const name = args[at]?.replace(/^--/, '');
    if (!FLAGS.includes(name) || args[at + 1] === undefined) throw new Error(`owner inbox: expected --${FLAGS.join(', --')} with a value, got "${args[at]}"`);
    flags[name] = args[at + 1];
  }
  return flags;
}

export function run(argv, { now = Date.now(), out = console.log } = {}) {
  const [command = 'list', ...args] = argv;
  const path = inboxPath();
  if (command === 'list') {
    const open = batches(readInbox(path)).flat();
    out(open.length ? open.map((item) => `${[item.id, item.lane, item.ask].join('  ')}  (${age(item.since, now)})`).join('\n') : 'Nothing is waiting on the owner.');
    return 0;
  }
  if (command === 'batch') {
    out(JSON.stringify(batches(readInbox(path)), null, 2));
    return 0;
  }
  if (command === 'add') {
    let outcome = null;
    changeInbox(path, (items) => {
      outcome = addItem(items, flagsOf(args), now);
      return outcome.added ? outcome.items : null;
    });
    out(outcome.added ? `added ${outcome.item.id}` : `already open as ${outcome.item.id}`);
    return 0;
  }
  if (command === 'done') {
    changeInbox(path, (items) => markDone(items, args[0]));
    out(`done ${args[0]}`);
    return 0;
  }
  throw new Error(`owner inbox: unknown command "${command}" (list, add, batch, done)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
