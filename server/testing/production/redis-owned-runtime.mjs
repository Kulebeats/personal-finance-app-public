import fs from 'node:fs';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { redisSupervisorSource, redisCleanupSource } from './redis-owned-supervisor.mjs';
import { captureOwnedProcess, settleOwnedCaptures, closeOwnedSocket, createMonotonicFreshness, observeOwnedExitAndDrain,
  publicSupervisorObservation } from './redis-owned-lifetime.mjs';
import os from 'node:os';
// The Windows profile the custody fixtures live under, from the process token (os.userInfo),
// not USERPROFILE, which the fixed children override; a neutral placeholder off Windows.
const windowsProfile = process.platform === 'win32' ? os.userInfo().homedir : 'C:\\Users\\example';

// Fixed local provider allocation accepted by the runtime owner. No configurable
// executable, distro, registry key, PID, command or attestation enters this path.
const canonical = `${windowsProfile}\\.codex\\worktrees\\capital-completion-v2\\personal-finance-app`;
const evidenceRoot = `${canonical}\\.local\\r20-redis-oct28`;
const distro = 'Capital-R20-Redis-20261028A1';
const guid = '{6d785bcd-f67f-4de2-ae0b-16b2c014d1c7}';
const root = `${evidenceRoot}\\distro-a1`;
const wsl = 'C:\\Windows\\System32\\wsl.exe';
const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const environment = Object.freeze({ SystemRoot: 'C:\\WINDOWS', TEMP: `${windowsProfile}\\AppData\\Local\\Temp`,
  TMP: `${windowsProfile}\\AppData\\Local\\Temp`, TZ: 'UTC', USERPROFILE: windowsProfile, LOCALAPPDATA: `${windowsProfile}\\AppData\\Local` });
const failed = phase => new Error(`OWNED_REDIS_RUNTIME_REFUSED:${phase}`);
const sha = value => createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref(); });
const registrySource = String.raw`
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($PSVersionTable.PSVersion.ToString() -cne '7.6.6' -or [Environment]::Version.ToString() -cne '10.0.12'){throw 'HOST'}
$r='HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
$p=Get-ItemProperty -LiteralPath $r
$rows=@(Get-ChildItem -LiteralPath $r | ForEach-Object {$v=Get-ItemProperty -LiteralPath $_.PSPath;[ordered]@{guid=$_.PSChildName;name=$v.DistributionName;root=$v.BasePath;version=$v.Version;uid=$v.DefaultUid}})
[ordered]@{defaultGuid=$p.DefaultDistribution;rows=$rows}|ConvertTo-Json -Depth 4 -Compress
`;

function objectIdentity(path, expected) {
  const s = fs.lstatSync(path, { bigint: true });
  if (s.isSymbolicLink() || fs.realpathSync.native(path).toLowerCase() !== path.toLowerCase()) throw failed('HOST_OBJECT');
  for (const [key, value] of Object.entries(expected)) if (String(s[key]) !== value) throw failed('HOST_OBJECT');
  return Object.freeze(Object.fromEntries(['dev', 'ino', 'mode', 'nlink', 'birthtimeNs'].map(key => [key, String(s[key])])));
}
function hostObjects() {
  const directory = objectIdentity(root, { dev: '2651408473', ino: '22236523161632891', mode: '16822', nlink: '1', birthtimeNs: '1793227683661438500' });
  const vhd = objectIdentity(`${root}\\ext4.vhdx`, { dev: '2651408473', ino: '4785074605573570', mode: '33206', nlink: '1', birthtimeNs: '1793227683722685600' });
  // VHD size, mtime and ctime change during real Linux work; they are not pins.
  return Object.freeze({ directory, vhd });
}
function pinnedFile(path, size, digest, nlink = 1n) {
  const before = fs.lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== nlink || before.size !== BigInt(size)) throw failed('SOURCE');
  const bytes = fs.readFileSync(path);
  const after = fs.lstatSync(path, { bigint: true });
  for (const key of ['dev', 'ino', 'mode', 'nlink', 'size', 'birthtimeNs', 'mtimeNs', 'ctimeNs']) if (before[key] !== after[key]) throw failed('SOURCE');
  if (sha(bytes) !== digest) throw failed('SOURCE');
}
function sourcePins() {
  // This Windows system binary has two existing OS-owned hard links. Evidence
  // files remain single-link; do not silently treat these providers alike.
  pinnedFile(wsl, 275968, 'de39c39c4ae8058f224fdb25f2f532b58ae53cec84914c175fd4de606a314158', 2n);
  pinnedFile(`${evidenceRoot}\\package-install-a2-controller.json`, 4670, '55c51cb61557518cca85a4e0b6543660516ccf1bf178e2e76db08474e3f7c873');
}

async function capture(executable, args, budget = 8000, input) {
  const child = spawn(executable, args, { windowsHide: true, cwd: canonical, env: environment, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  const result = await captureOwnedProcess(child, { budgetMs: budget, input });
  if (!result.passed) {
    const error = failed('HOST_CAPTURE'); error.cleanupReceipt = result.cleanup; throw error;
  }
  return result.stdout.toString('utf8');
}
export async function verifyOwnedRedisHost() {
  if (process.platform !== 'win32' || process.arch !== 'arm64' || process.version !== 'v24.22.0') throw failed('HOST');
  sourcePins(); hostObjects();
  let value;
  try { value = JSON.parse(await capture(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', registrySource])); }
  catch (error) {
    const refusal = failed('REGISTRATION');
    if (error?.cleanupReceipt) refusal.cleanupReceipt = error.cleanupReceipt;
    throw refusal;
  }
  const matches = value.rows?.filter(row => row.guid === guid || row.name === distro || row.root?.toLowerCase() === root.toLowerCase());
  if (value.defaultGuid !== guid || matches?.length !== 1 || matches[0].guid !== guid || matches[0].name !== distro ||
      matches[0].root !== root || matches[0].version !== 2 || matches[0].uid !== 0) throw failed('REGISTRATION');
  sourcePins(); const objects = hostObjects();
  return Object.freeze({ registration: Object.freeze({ ...matches[0] }), objects });
}

async function unusedPort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', () => reject(failed('PORT'))); server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(failed('PORT')) : resolve()));
}
async function endpointClosureProbe(port, deadline) {
  let socket;
  try { socket = net.createConnection({ host: '127.0.0.1', port }); }
  catch { return { outcome: 'TCP_ERROR', probeClosed: true }; }
  let settled = false, timer, onConnect, onError, onClose;
  const outcome = await new Promise(resolve => {
    const finish = value => { if (settled) return; settled = true; resolve(value); };
    onConnect = () => finish('CONNECTED');
    onError = error => finish(error.code === 'ECONNREFUSED' ? 'TCP_REFUSED' : 'TCP_ERROR');
    onClose = () => finish('SOCKET_CLOSED');
    socket.once('connect', onConnect); socket.on('error', onError); socket.once('close', onClose);
    timer = setTimeout(() => finish('TCP_TIMEOUT'), Math.max(0, deadline - performance.now()));
  });
  clearTimeout(timer); socket.removeListener('connect', onConnect); socket.removeListener('close', onClose);
  socket.destroy();
  const probeClosed = await closeOwnedSocket(socket, 0, Math.max(0, deadline - performance.now()));
  // Until close is observed, retain the nonthrowing error sink on this owned
  // socket. No later event can turn an incomplete probe into accepted cleanup.
  if (probeClosed) socket.removeListener('error', onError);
  return { outcome, probeClosed };
}

/** Windows endpoint disappearance is separate from native process/listener
 * termination. Only an in-budget ECONNREFUSED and physical probe closure prove
 * this observation. A successful probe closes before another can be created.
 */
export async function observeOwnedRedisEndpointClosure(port, budgetMs = 750) {
  if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > 750) throw failed('ENDPOINT_BUDGET');
  const deadline = performance.now() + budgetMs;
  let attempts = 0, lastOutcome = 'NOT_PROBED', lastProbeClosed = true;
  const snapshot = requestedClosed => {
    const deadlineExceeded = performance.now() >= deadline;
    return Object.freeze({ closed: requestedClosed && !deadlineExceeded, attempts, lastOutcome, lastProbeClosed, deadlineExceeded });
  };
  while (performance.now() < deadline) {
    attempts++;
    const observed = await endpointClosureProbe(port, deadline);
    lastOutcome = observed.outcome; lastProbeClosed = observed.probeClosed;
    if (!lastProbeClosed || performance.now() >= deadline) return snapshot(false);
    if (lastOutcome === 'TCP_REFUSED') return snapshot(true);
    if (lastOutcome !== 'CONNECTED') return snapshot(false);
    await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(0, deadline - performance.now()))));
  }
  return snapshot(false);
}

export async function endpointClosed(port, budgetMs = 750) {
  return (await observeOwnedRedisEndpointClosure(port, budgetMs)).closed;
}

// RESP is private to supervisor admission. The application receives no raw client.
export function parseOwnedRedisReply(bytes, offset = 0, depth = 0) {
  if (depth > 4) throw failed('RESP');
  const end = bytes.indexOf('\r\n', offset); if (end < 0) return undefined;
  const type = bytes[offset], text = bytes.subarray(offset + 1, end).toString('utf8'); let next = end + 2;
  if (type === 43) return { value: text, next };
  if (type === 45) throw failed('RESP_REJECTED');
  if (type === 58 && /^-?\d{1,10}$/.test(text)) return { value: Number(text), next };
  if ((type !== 36 && type !== 42) || !/^-?\d{1,6}$/.test(text)) throw failed('RESP');
  const length = Number(text); if (length === -1) return { value: null, next };
  if (length < 0 || length > 65536) throw failed('RESP');
  if (type === 36) {
    if (bytes.length < next + length + 2) return undefined;
    if (bytes[next + length] !== 13 || bytes[next + length + 1] !== 10) throw failed('RESP');
    return { value: bytes.subarray(next, next + length).toString('utf8'), next: next + length + 2 };
  }
  if (length > 64) throw failed('RESP');
  const values = [];
  for (let index = 0; index < length; index++) { const child = parseOwnedRedisReply(bytes, next, depth + 1); if (!child) return undefined; values.push(child.value); next = child.next; }
  return { value: values, next };
}
const connectionReason = code => ({ ECONNREFUSED: 'TCP_REFUSED', ETIMEDOUT: 'TCP_TIMEOUT', ECONNRESET: 'TCP_RESET',
  EHOSTUNREACH: 'TCP_UNREACHABLE', ENETUNREACH: 'TCP_UNREACHABLE', EACCES: 'TCP_PERMISSION', EPERM: 'TCP_PERMISSION' })[code] ?? 'SOCKET_FAILURE';
const connectionActive = options => {
  try { return !options.signal.aborted && options.alive() === true; } catch { return false; }
};
function connectionRefusal(reason, connectionCleanupFailed = false) {
  const error = failed(reason === 'CANCELLED' ? 'CONNECT_CANCELLED' : 'CONNECTION');
  error.connectionCleanupFailed = connectionCleanupFailed;
  if (reason !== 'CANCELLED') error.connectionFailure = reason;
  return error;
}

async function connectOwnedRedisAdminAttempt(port, timeoutMs, deadline, options) {
  const socket = net.createConnection({ host: '127.0.0.1', port }); let pending, buffer = Buffer.alloc(0), closed = false, connectionFailure = 'SOCKET_FAILURE';
  const close = (reason = 'CONNECTION_CLOSED') => { closed = true; socket.destroy(); if (pending) { pending.reject(failed(reason)); pending = undefined; } };
  socket.on('error', error => {
    connectionFailure = connectionReason(error.code);
    close();
  });
  socket.on('close', () => close());
  socket.on('data', chunk => {
    try {
      buffer = Buffer.concat([buffer, chunk]); if (buffer.length > 65536 || !pending) throw failed('RESP');
      const reply = parseOwnedRedisReply(buffer); if (!reply) return;
      if (reply.next !== buffer.length) throw failed('RESP');
      buffer = Buffer.alloc(0); const request = pending; pending = undefined; request.resolve(reply.value);
    } catch (error) { close(error?.message === 'OWNED_REDIS_RUNTIME_REFUSED:RESP_REJECTED' ? 'RESP_REJECTED' : 'RESP'); }
  });
  let connectTimer, onConnect, onError, onClose, onAbort;
  try { await new Promise((resolve, reject) => {
    const refuse = reason => { connectionFailure = reason; close(); reject(connectionRefusal(reason)); };
    onConnect = () => {
      if (!connectionActive(options)) refuse('CANCELLED');
      else if (performance.now() >= deadline) refuse('TCP_TIMEOUT');
      else resolve();
    };
    onError = () => reject(connectionRefusal(connectionFailure));
    onClose = () => reject(connectionRefusal(connectionFailure));
    onAbort = () => refuse('CANCELLED');
    socket.once('connect', onConnect); socket.once('error', onError); socket.once('close', onClose);
    options.signal.addEventListener('abort', onAbort, { once: true });
    connectTimer = setTimeout(() => refuse('TCP_TIMEOUT'), Math.max(0, deadline - performance.now()));
    if (!connectionActive(options)) onAbort();
  }); } catch {
    const connectionClosed = await closeOwnedSocket(socket, 0, Math.max(0, deadline - performance.now()));
    throw connectionRefusal(connectionFailure, !connectionClosed);
  } finally {
    clearTimeout(connectTimer); options.signal.removeEventListener('abort', onAbort);
    socket.removeListener('connect', onConnect); socket.removeListener('error', onError); socket.removeListener('close', onClose);
  }
  return {
    command: async (...args) => {
      if (closed || pending || args.some(arg => typeof arg !== 'string' || Buffer.byteLength(arg) > 8192)) throw failed('COMMAND');
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          pending = { resolve, reject }; timer = setTimeout(() => close('COMMAND_TIMEOUT'), timeoutMs);
          const parts = [Buffer.from(`*${args.length}\r\n`)];
          for (const arg of args) { const bytes = Buffer.from(arg); parts.push(Buffer.from(`$${bytes.length}\r\n`), bytes, Buffer.from('\r\n')); }
          socket.write(Buffer.concat(parts), error => { if (error) close(); });
        });
      } finally { clearTimeout(timer); }
    },
    close: () => closeOwnedSocket(socket),
  };
}

/** Readiness covers only TCP establishment. Once connected, AUTH/INFO/marker and
 * every other command execute once on that physical connection, without replay.
 * A Linux listener and a Windows-forwarded socket are separate observations.
 */
export async function connectOwnedRedisAdmin(port, timeoutMs, options) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000 || !(options?.signal instanceof AbortSignal) ||
      typeof options.alive !== 'function') throw failed('CONNECTION_INPUT');
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    if (!connectionActive(options)) throw connectionRefusal('CANCELLED');
    if (performance.now() >= deadline) throw connectionRefusal('TCP_TIMEOUT');
    let admin;
    try { admin = await connectOwnedRedisAdminAttempt(port, timeoutMs, deadline, options); }
    catch (error) {
      // A prior socket must actually close before another is created. Never
      // retry permission, reset, timeout, protocol, authentication or commands.
      if (error.connectionCleanupFailed || error.connectionFailure !== 'TCP_REFUSED') throw error;
      if (!connectionActive(options)) throw connectionRefusal('CANCELLED');
      if (performance.now() >= deadline) throw connectionRefusal('TCP_TIMEOUT');
      let timer, abort;
      try { await new Promise(resolve => {
        abort = resolve; options.signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(resolve, Math.min(100, Math.max(0, deadline - performance.now())));
        if (!connectionActive(options)) resolve();
      }); } finally { clearTimeout(timer); options.signal.removeEventListener('abort', abort); }
      // The next iteration rechecks both native lifetime and the same deadline.
      continue;
    }
    if (!connectionActive(options) || performance.now() >= deadline) {
      const cancelled = !connectionActive(options), closed = await admin.close();
      throw connectionRefusal(cancelled ? 'CANCELLED' : 'TCP_TIMEOUT', !closed);
    }
    return admin;
  }
}

export async function launchOwnedRedisSupervisor({ port, config, runMs, onLost }) {
  const host = await verifyOwnedRedisHost(); await unusedPort(port);
  const child = spawn(wsl, ['--distribution', distro, '--user', 'redis', '--cd', '/', '--exec', '/usr/bin/env', '-i',
    'HOME=/var/lib/redis', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL=C', 'TZ=UTC', 'COLUMNS=120', 'LINES=40',
    '/usr/bin/python3', '-I', '-u', '-c', redisSupervisorSource], { windowsHide: true, cwd: canonical, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
  let line = '', bytes = 0, stderr = 0, ready, stopped, lost = false, refusal;
  const nativeObservations = [];
  const freshness = createMonotonicFreshness(3500);
  let resolveReady, rejectReady;
  const readiness = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const exit = observeOwnedExitAndDrain(child).completion;
  const lose = () => { if (lost) return; lost = true; try { onLost(); } catch { /* Revocation fanout is owned by the issuer. */ } };
  const reject = phase => { refusal ||= failed(phase); rejectReady(refusal); lose(); child.stdin.end(); };
  child.stdin.on('error', () => reject('CONTROL_PIPE'));
  child.on('error', () => reject('PROCESS'));
  child.stderr.on('data', chunk => { stderr += chunk.length; reject('STDERR'); });
  child.stdout.on('data', chunk => {
    try {
      bytes += chunk.length; if (bytes > 1024 * 1024) throw failed('OUTPUT');
      line += new TextDecoder('utf-8', { fatal: true }).decode(chunk);
      if (line.length > 8192) throw failed('OUTPUT');
      while (line.includes('\n')) {
        const index = line.indexOf('\n'), row = JSON.parse(line.slice(0, index)); line = line.slice(index + 1);
        if (row.event === 'ready' && !ready && !stopped && Number.isSafeInteger(row.pid) && row.pid > 1 && /^\d+$/.test(row.startTicks) &&
            /^\d+$/.test(row.listenerInode) && /^\d+$/.test(row.exeDev) && /^\d+$/.test(row.exeIno) &&
            Number.isSafeInteger(row.supervisorPid) && row.supervisorPid > 1 && /^[a-f0-9-]{36}$/.test(row.bootId)) {
          nativeObservations.push(publicSupervisorObservation(row)); ready = row; freshness.touch(); resolveReady(row);
        }
        else if (row.event === 'alive' && ready && !stopped && row.pid === ready.pid && row.startTicks === ready.startTicks) {
          if (!freshness.fresh()) throw failed('HEARTBEAT');
          freshness.touch();
        }
        else if (row.event === 'stopped' && !stopped) { nativeObservations.push(publicSupervisorObservation(row)); stopped = row; lose(); }
        else if (row.event === 'failure') reject('SUPERVISOR');
        else throw failed('PROTOCOL');
      }
    } catch { reject('PROTOCOL'); }
  });
  child.once('exit', () => lose());
  child.once('close', () => { clearTimeout(startup); clearInterval(heartbeat); if (!ready) reject('EARLY_EXIT'); if (line || stderr) refusal ||= failed('OUTPUT'); lose(); });
  const startup = setTimeout(() => reject('STARTUP_TIMEOUT'), 15000);
  const heartbeat = setInterval(() => { if (ready && !stopped && !freshness.fresh()) reject('HEARTBEAT'); }, 500);
  const stop = async () => {
    lose(); clearTimeout(startup); clearInterval(heartbeat);
    if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end('STOP\n');
    let result = await Promise.race([exit, delay(12000).then(() => null)]);
    if (!result) {
      // This is only the owned Windows pipe process. Linux termination remains
      // UNVERIFIED without its pidfd/listener receipt; never kill a numeric PID.
      child.kill(); result = await Promise.race([exit, delay(3000).then(() => null)]);
    }
    let processTerminated = stopped?.terminated === true && stopped.pid === ready?.pid && stopped.startTicks === ready?.startTicks;
    let linuxListenerClosed = stopped?.listenerClosed === true, recoveryUsed = false;
    if ((!processTerminated || !linuxListenerClosed) && ready) {
      try {
        await verifyOwnedRedisHost();
        const raw = await capture(wsl, ['--distribution', distro, '--user', 'redis', '--cd', '/', '--exec', '/usr/bin/env', '-i',
          'HOME=/var/lib/redis', 'PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL=C', 'TZ=UTC', 'COLUMNS=120', 'LINES=40',
          '/usr/bin/python3', '-I', '-u', '-c', redisCleanupSource], 17000, JSON.stringify({ port, observed: ready }) + '\n');
        const recovered = JSON.parse(raw);
        if (recovered.event === 'cleanup') {
          processTerminated = recovered.processTerminated === true; linuxListenerClosed = recovered.listenerClosed === true; recoveryUsed = true;
        }
      } catch { /* Exact ownership or recovery refusal keeps cleanup unverified. */ }
    }
    let hostIdentityStable = false;
    try { await verifyOwnedRedisHost(); hostIdentityStable = true; } catch { /* Receipt reports refusal. */ }
    const captures = await settleOwnedCaptures();
    const windowsEndpointClosure = await observeOwnedRedisEndpointClosure(port);
    const closed = windowsEndpointClosure.closed;
    return Object.freeze({ kind: 'owned-redis-shutdown', processTerminated,
      linuxListenerClosed, recoveryUsed, endpointClosed: closed, windowsEndpointClosure,
      windowsProcessExited: Boolean(result?.exited && result?.drained),
      hostIdentityStable, ownedCaptureCleanup: captures,
      nativeObservations: Object.freeze([...nativeObservations]),
      cleanupVerified: processTerminated && linuxListenerClosed && Boolean(result?.exited && result?.drained) && closed && hostIdentityStable && captures.cleanupVerified });
  };
  child.stdin.write(JSON.stringify({ port, config, runMs }) + '\n');
  try {
    const observed = await readiness; clearTimeout(startup);
    if (lost || refusal || !freshness.fresh()) throw failed('STARTUP');
    return { child, observed, host, stop, alive: () => !lost && !refusal && freshness.fresh() };
  } catch {
    const receipt = await stop();
    const error = failed(receipt.cleanupVerified ? 'STARTUP_CLEANED' : 'STARTUP_CLEANUP_UNVERIFIED');
    error.cleanupReceipt = receipt; throw error;
  }
}
