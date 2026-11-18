// One lock and one atomic write for the small JSON state files that several sessions change at
// once: the lane board and the owner's inbox. Every writer of either file goes through the same
// read-change-write.
//
// An atomic mkdir serialises the writers. This is a file's own write lock, never the heavy-run lock.
//
// A lock left behind by a killed process is NEVER taken by force. Removing a lock because it looks
// old is a race: two waiters can both see the old lock, the first removes it and takes a new one,
// and the second then removes that new one and enters too. So an old lock is an error that
// names the folder; a person, or the coordinator after checking that no writer is running, removes
// it. The tick reports an old state lock so it does not sit unseen.

import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 100;
/** A write takes milliseconds; a lock this old was left by a process that has stopped. */
export const STALE_LOCK_MS = 30_000;
const RENAME_ATTEMPTS = 20;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Windows answers these while a delete is pending or a scanner holds the file; they pass.
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** How old `<path>.lock` is in milliseconds, or null when there is no lock. */
export function lockAgeMs(path) {
  try {
    return Date.now() - statSync(`${path}.lock`).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Remove a lock folder we hold. A passing Windows refusal (an indexer or OneDrive holding the folder) is
 * tried again, as a rename is, or one busy moment would leave the lock for a person to remove.
 * `remove` is a test seam.
 */
export function releaseLock(lock, remove = rmSync) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return remove(lock, { recursive: true, force: true });
    } catch (err) {
      if (!TRANSIENT.has(err?.code) || attempt >= RENAME_ATTEMPTS) throw err;
      sleep(LOCK_POLL_MS);
    }
  }
}

/**
 * Run `work` while holding `<path>.lock`; returns what it returns, or throws what it throws.
 * `what` names the file in an error; `release` is a test seam.
 */
export function withFileLock(path, work, what = 'state file', { release = (lock) => releaseLock(lock) } = {}) {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST' && !TRANSIENT.has(err.code)) throw err;
      const age = err.code === 'EEXIST' ? lockAgeMs(path) : null;
      if (age !== null && age > STALE_LOCK_MS) {
        throw new Error(
          `${what}: ${lock} is ${Math.round(age / 1000)} s old, so it was left by a process that has stopped. ` +
            'Nothing was written. Check that no other session is writing this file, then remove it by hand; it is never removed automatically.',
        );
      }
      if (Date.now() > deadline) throw new Error(`${what}: could not take ${lock} within ${LOCK_WAIT_MS / 1000} s (${err.code})`);
      sleep(LOCK_POLL_MS);
    }
  }
  try {
    return work();
  } finally {
    try {
      release(lock); // ours: nobody else removes a lock
    } catch {
      // The work's result stands. A caller that saw this as a failure would undo a write that was
      // made (goal intake could otherwise remove the files a published board pointed at). The lock is
      // left; the next writer reports it as old and names it.
    }
  }
}

/** Replace `path` with `text` through a temp file and a rename, so a reader never sees half a file. */
export function writeFileAtomic(path, text) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, 'utf8');
  for (let attempt = 1; ; attempt += 1) {
    try {
      renameSync(temp, path);
      return;
    } catch (err) {
      if (!TRANSIENT.has(err.code) || attempt >= RENAME_ATTEMPTS) {
        rmSync(temp, { force: true });
        throw err;
      }
      sleep(LOCK_POLL_MS);
    }
  }
}
