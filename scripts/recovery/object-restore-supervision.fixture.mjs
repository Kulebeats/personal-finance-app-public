import assert from 'node:assert/strict';

/** Shared observation and cleanup gate for the owned crash child and deterministic event fixtures. */
export function superviseCrashChild(child, t) {
  let childClosed = false;
  const childErrors = [];
  child.on('error', (error) => {
    childErrors.push(error);
    t.diagnostic('crash fixture child error: ' + error.message);
  });
  // An error (including a failed kill) does not establish that the child has closed.
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      childClosed = true;
      resolve({ code, signal, error: childErrors[0] });
    });
  });
  let stdout = '';
  let stderr = '';
  const boundary = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', () => reject(new Error('crash fixture closed before its boundary witness: ' + stderr)));
    child.stdout.on('data', (bytes) => {
      stdout += bytes.toString('utf8');
      if (Buffer.byteLength(stdout) > 4096) {
        child.kill('SIGKILL');
        reject(new Error('oversized crash fixture witness'));
        return;
      }
      const end = stdout.indexOf('\n');
      if (end < 0) return;
      try { resolve(JSON.parse(stdout.slice(0, end))); }
      catch (error) { reject(error); }
    });
    child.stderr.on('data', (bytes) => {
      stderr += bytes.toString('utf8');
      if (Buffer.byteLength(stderr) > 4096) {
        child.kill('SIGKILL');
        reject(new Error('oversized crash fixture error output'));
      }
    });
  });
  return {
    boundary,
    closed,
    output() { return { stdout, stderr }; },
    cleanup(cleanup) {
      assert.ok(childClosed, 'child close is unconfirmed; retaining the owned fixture root');
      cleanup();
    },
  };
}
