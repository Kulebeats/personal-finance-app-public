// Runs only the Jarvis tooling tests: `npm run test:jarvis`.
// The env below points every state file at a temporary folder, so no test (and no CLI a test
// starts, which inherits this env) can touch the owner's real inbox or the main checkout's board.

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const SAFE_DIR = join(tmpdir(), 'capital-jarvis-tests');

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['scripts/jarvis/**/*.test.mjs'],
    environment: 'node',
    env: {
      CAPITAL_JARVIS_DIR: join(SAFE_DIR, 'state'),
      CAPITAL_OWNER_INBOX: join(SAFE_DIR, 'waiting-on-owner.json'),
      CAPITAL_CLAUDE_PROJECTS: join(SAFE_DIR, 'projects'),
    },
  },
});
