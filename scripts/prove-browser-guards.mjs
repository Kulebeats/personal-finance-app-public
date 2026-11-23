#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTestTarget, verifyDatabaseTarget } from '../server/testing/test-target.mjs';

const target = loadTestTarget();
await verifyDatabaseTarget();
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'pfa-r00-browser-'));
let blockedRequests = 0;
let origin;
let deniedOrigin;
const server = http.createServer((request, response) => {
  if (request.url === '/redirect') {
    response.writeHead(302, { Location: `${origin}/redirect-next` }); response.end();
  } else if (request.url === '/redirect-next') {
    response.writeHead(307, { Location: deniedOrigin }); response.end();
  } else if (request.url === '/redirect-safe') {
    response.writeHead(302, { Location: '/' }); response.end();
  } else if (request.url === '/__test/identity') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ runId: target.runId, database: target.database, origin }));
  } else { response.setHeader('Content-Type', 'text/html'); response.end('<html><body>synthetic-browser-guard</body></html>'); }
});
const denied = http.createServer((_request, response) => { blockedRequests++; response.end('must-not-be-reached'); });
try {
  await Promise.all([server, denied].map((listener) => new Promise((resolve, reject) => {
    listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve);
  })));
  origin = `http://127.0.0.1:${server.address().port}`;
  deniedOrigin = `http://127.0.0.1:${denied.address().port}`;
  const manifest = path.join(temporary, 'target.json');
  writeFileSync(manifest, JSON.stringify({ ...target, server: { origin } }));
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'server/testing/browser-guard.config.ts'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, PFA_TEST_MODE: 'database', TEST_TARGET_MANIFEST: manifest, PFA_R00_DENIED_ORIGIN: deniedOrigin },
  });
  const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(blockedRequests, 0, 'Denied sink must receive zero browser/API/node requests');
  assert.equal(status, 0, 'Protected browser/worker boundary proof must pass');
  console.log(JSON.stringify({ database: target.database, runId: target.runId, browserGuard: 'passed', deniedSinkRequests: blockedRequests, applicationJourney: false }));
} finally {
  await Promise.all([server, denied].map((listener) => new Promise((resolve) => { listener.closeAllConnections(); listener.close(resolve); })));
  rmSync(temporary, { recursive: true });
}
