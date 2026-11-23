import { readInstalledRuntimeLoadingProtocol, installInstalledRuntimeLoading } from './runtime-installed-loading.mjs';

// Its complete four-file closure is pinned by the reviewed external dispatcher/supervisor.
// Static imports above are trusted harness code. Installed code enters only after all controls.
let boundary;
const input = process.stdin[Symbol.asyncIterator](); let pending = Buffer.alloc(0);
async function line(maximum, phase) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`INSTALLED_LOADING_REFUSED:${phase}`)), 65000); });
  try {
    while (true) {
      const end = pending.indexOf(10);
      if (end !== -1) { if (end > maximum) throw new Error(`INSTALLED_LOADING_REFUSED:${phase}`); const value = pending.subarray(0, end); pending = pending.subarray(end + 1); return value; }
      if (pending.length > maximum) throw new Error(`INSTALLED_LOADING_REFUSED:${phase}`);
      const next = await Promise.race([input.next(), timeout]);
      if (next.done) throw new Error(`INSTALLED_LOADING_REFUSED:${phase}`);
      pending = Buffer.concat([pending, next.value]);
    }
  } finally { clearTimeout(timer); }
}
try {
  const bytes = await line(16 * 1024 * 1024, 'INPUT'); const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (Buffer.from(text).length !== bytes.length) throw new Error('INSTALLED_LOADING_REFUSED:INPUT');
  const protocol = readInstalledRuntimeLoadingProtocol(text, process.argv[2]);
  boundary = installInstalledRuntimeLoading(protocol);
  console.log('R20_INSTALLED_HOOKS:sharp-geoip-v1');
  const { default: run } = await import(boundary.entryURL);
  await run(protocol.document.scenario);
  const evidence = boundary.evidence();
  if (evidence.wholeReads !== 3 || evidence.rangeReads !== 1 || evidence.active !== 0 || evidence.nativeLoads !== 1)
    throw new Error('INSTALLED_LOADING_REFUSED:COMPONENT_EVIDENCE');
  console.log(`R20_INSTALLED_READS:${evidence.wholeReads}:${evidence.rangeReads}`);
  console.log('R20_INSTALLED_READY:sharp-geoip-v1');
  // The supervisor inspects actual mapped paths and attempted writer opens while locks live.
  const ack = await line(128, 'ACK_TIMEOUT');
  if (ack.toString('utf8') !== 'R20_INSTALLED_ACK:sharp-geoip-v1' || pending.length !== 0) throw new Error('INSTALLED_LOADING_REFUSED:ACK');
  boundary.evidence(); console.log('R20_INSTALLED_COMPLETE:sharp-geoip-v1');
} catch (error) {
  const phase = boundary?.violation() ?? /^INSTALLED_LOADING_REFUSED:([A-Z_]+)$/.exec(error?.message ?? '')?.[1] ?? 'COMPONENT';
  console.error(`INSTALLED_LOADING_REFUSED:${phase}`); process.exitCode = 1;
} finally { boundary?.close(); }
