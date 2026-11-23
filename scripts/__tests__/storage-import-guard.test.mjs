import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../check-no-storage-imports.mjs", import.meta.url));
function fixture(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pfa-storage-guard-"));
  fs.mkdirSync(path.join(root, "server/core/nested"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "shared"));
  fs.mkdirSync(path.join(root, "client/src"), { recursive: true });
  fs.writeFileSync(path.join(root, "server/storage.ts"), "export const legacy = true;\n");
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@shared/*": ["./shared/*"], "@/*": ["./client/src/*"] } } }));
  fs.writeFileSync(path.join(root, "scripts/storage-import-allowlist.txt"), "");
  const source = path.join(root, "server/core/nested/consumer.ts");
  const run = () => spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8", timeout: 10000 });
  try { body({ root, source, run }); }
  finally {
    const resolved = fs.realpathSync(root);
    assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("pfa-storage-guard-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

test("new core storage interface imports are allowed without importer allowlist exceptions", () => fixture(({ source, run }) => {
  for (const specifier of ["../storage", "../storage.ts", ".././storage.js", "storage", "../storage-helper"]) {
    fs.writeFileSync(source, `import { value } from ${JSON.stringify(specifier)};`);
    assert.equal(run().status, 0, specifier);
  }
}));

test("legacy module resolution rejects relative normalization, extension and URL suffix bypasses", () => fixture(({ source, run }) => {
  for (const specifier of ["../../storage", "../../storage.ts", "../../storage.js", "../../storage.tsx", "../../storage.jsx",
    "../nested/../../storage", "../.././storage.ts?cache=1#fragment", "../../%73torage.ts"]) {
    fs.writeFileSync(source, `import { value } from ${JSON.stringify(specifier)};`);
    const result = run();
    assert.equal(result.status, 1, specifier + result.stdout + result.stderr);
    assert.match(result.stderr, /server\/core\/nested\/consumer.ts/);
  }
}));

test("legacy file URL, dynamic, require and side-effect imports are refused", () => fixture(({ root, source, run }) => {
  for (const statement of [
    `import ${JSON.stringify(pathToFileURL(path.join(root, "server/storage.ts")).href)};`,
    'const value = require("../../storage");', 'await import("../../storage.ts?cache=1");', 'import "../../storage";',
  ]) {
    fs.writeFileSync(source, statement);
    assert.equal(run().status, 1, statement);
  }
}));

test("existing exact importer allowlist continues to permit legacy imports", () => fixture(({ root, source, run }) => {
  fs.writeFileSync(source, 'import { value } from "../../storage";');
  fs.writeFileSync(path.join(root, "scripts/storage-import-allowlist.txt"), "server/core/nested/consumer.ts\n");
  assert.equal(run().status, 0);
}));

test("configured TypeScript aliases cannot resolve around the legacy guard", () => fixture(({ source, run }) => {
  for (const alias of ["@shared/../server/storage", "@/../../server/storage", "@shared/../server/storage.ts"]) {
    fs.writeFileSync(source, `import { legacy } from ${JSON.stringify(alias)};`);
    assert.equal(run().status, 1, alias);
  }
}));
