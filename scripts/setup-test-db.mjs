#!/usr/bin/env node
import { bootstrapTestDatabase } from '../server/testing/bootstrap-database.mjs';

try {
  const report = await bootstrapTestDatabase();
  console.log(JSON.stringify({ status: 'migrated', ...report }));
} catch (error) {
  // Driver errors can contain target data; only controlled guard messages are public.
  console.error(error.message?.startsWith('REFUSING TEST TARGET:') ? error.message :
    `Synthetic test bootstrap failed (${error.code ?? 'migration/connection failure'}).`);
  process.exitCode = 1;
}
