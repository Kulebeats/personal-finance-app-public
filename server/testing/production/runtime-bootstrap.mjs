import { readRuntimeBoundaryProtocol, installRuntimeBoundary } from './runtime-enforcement.mjs';
import { createHash } from 'node:crypto';

// The supervisor pins this entire trusted bootstrap closure before process creation.
// No application or dependency import occurs until synchronous hooks are installed.
let boundary;
try {
  let text = ''; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length; if (bytes > 64 * 1024) throw new Error('RUNTIME_BOUNDARY_REFUSED:INPUT');
    text += chunk.toString('utf8');
  }
  const record = readRuntimeBoundaryProtocol(text, createHash('sha256').update(text).digest('hex'));
  boundary = installRuntimeBoundary(record);
  console.log('R20_HOOKS_INSTALLED:r20stage20261028a1');
  await import(boundary.entryURL);
} catch (error) {
  const phase = /^RUNTIME_BOUNDARY_REFUSED:([A-Z_]+)$/.exec(error?.message ?? '')?.[1] ?? 'BOOTSTRAP';
  console.error(`RUNTIME_BOUNDARY_REFUSED:${phase}`); process.exitCode = 1;
} finally { boundary?.close(); }
