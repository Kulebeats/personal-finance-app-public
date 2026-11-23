import { ReplyError } from 'ioredis';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { RATE_LIMIT_SCRIPTS } from './rate-limit-protocol.mjs';

const refused = () => new Error('REDIS_CONNECTION_REFUSED');
const definiteNoScript = (error, command) => error instanceof ReplyError && /^NOSCRIPT(?:\s|$)/.test(error.message) &&
  command[0] === 'EVALSHA' && [RATE_LIMIT_SCRIPTS.increment.sha1, RATE_LIMIT_SCRIPTS.get.sha1].includes(command[1]);
const budget = value => Number.isSafeInteger(value) && value > 0 && value <= 2000;

/** Internal lifetime plumbing only. Never issues service/admission/slot authority. */
export function createProductionRedisLifetime({ assertAuthority, dispatch, disconnect, commandTimeoutMs, operationTimeoutMs }) {
  if (![assertAuthority, dispatch, disconnect].every(value => typeof value === 'function') || !budget(commandTimeoutMs) || !budget(operationTimeoutMs)) throw refused();
  let current = true, cleanupFault;
  const pending = new Set(), observers = new Set();
  const scopes = new AsyncLocalStorage();
  const revoke = () => {
    if (!current) return;
    current = false;
    const failures = [];
    // All callbacks see the invalidated state; none can prevent owned disconnect.
    for (const observer of Array.from(observers)) { try { observer.callback(); } catch { failures.push(refused()); } }
    observers.clear();
    try { disconnect(); } catch { failures.push(refused()); }
    const reason = failures.length ? new AggregateError(failures, 'REDIS_CONNECTION_CLEANUP_REFUSED') : refused();
    if (failures.length) cleanupFault = reason;
    for (const entry of Array.from(pending)) entry.cancel(reason);
    if (failures.length) throw reason;
  };
  const assertCurrent = () => {
    if (!current) throw refused();
    try { assertAuthority(); } catch { revoke(); throw refused(); }
    if (!current) throw refused();
    const scope = scopes.getStore();
    if (scope && performance.now() >= scope.deadline) { revoke(); throw refused(); }
  };
  const deadlineFor = timeoutMs => Math.min(performance.now() + timeoutMs, scopes.getStore()?.deadline ?? Infinity);
  const assertDeadline = deadline => {
    assertCurrent();
    if (performance.now() >= deadline) { revoke(); throw refused(); }
  };
  const bounded = async (action, deadline) => {
    assertDeadline(deadline);
    if (pending.size >= 64) { revoke(); throw refused(); }
    let timer, cancel;
    const cancellation = new Promise((_resolve, reject) => { cancel = reject; });
    const entry = { cancel }; pending.add(entry);
    const task = scopes.run({ deadline }, () => Promise.resolve().then(() => { assertDeadline(deadline); return action(); }));
    timer = setTimeout(() => { try { revoke(); } catch (error) { cancel(error); } }, Math.max(0, deadline - performance.now()));
    try {
      // All late task settlements remain observed by race after cancellation.
      const result = await Promise.race([task, cancellation]); assertDeadline(deadline); return result;
    } catch (error) {
      assertDeadline(deadline); throw error;
    } finally {
      clearTimeout(timer); pending.delete(entry);
    }
  };
  const execute = async command => {
    const deadline = deadlineFor(commandTimeoutMs); assertDeadline(deadline);
    if (!Array.isArray(command) || command.length < 1 || command.length > 101 || !command.every(value => typeof value === 'string' && Buffer.byteLength(value) <= 1024 * 1024)) { revoke(); throw refused(); }
    try { const result = await bounded(() => dispatch(command), deadline); assertDeadline(deadline); return result; }
    catch (error) {
      assertDeadline(deadline);
      if (definiteNoScript(error, command)) throw new ReplyError('NOSCRIPT No matching script.');
      revoke(); throw refused();
    }
  };
  return Object.freeze({
    assertCurrent, execute, revoke,
    assertClean() { if (cleanupFault) throw cleanupFault; },
    async runOperation(action) {
      const deadline = deadlineFor(operationTimeoutMs);
      if (typeof action !== 'function') { revoke(); throw refused(); }
      try { const result = await bounded(action, deadline); assertDeadline(deadline); return result; }
      catch { revoke(); throw refused(); }
    },
    onRevoked(callback) {
      if (typeof callback !== 'function') throw refused();
      if (!current) { try { callback(); } catch { throw refused(); } return () => {}; }
      const observer = { callback }; observers.add(observer); return () => { observers.delete(observer); };
    },
  });
}
