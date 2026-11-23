#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseConnection, validateManifest } from '../server/testing/test-target.mjs';

// This helper writes credentials-free intent only. It never connects or loads .env.
const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/create-test-target.mjs <manifest.json>');
const connection = parseConnection(process.env.TEST_DATABASE_URL);
const target = validateManifest({
  version: 1, disposable: true, synthetic: true,
  host: connection.host, port: connection.port, database: connection.database,
  runId: process.env.TEST_RUN_ID,
  server: process.env.TEST_SERVER_ORIGIN ? { origin: process.env.TEST_SERVER_ORIGIN } : undefined,
}, process.env.TEST_RUN_ID);
writeFileSync(output, JSON.stringify(target, null, 2) + '\n', { flag: 'wx' });
console.log('Wrote explicit synthetic test target manifest (no connection attempted).');
