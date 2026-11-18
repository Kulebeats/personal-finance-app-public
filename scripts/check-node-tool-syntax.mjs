import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const SCRIPTS_DIR = path.join(ROOT, "scripts");

async function collectMjsFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMjsFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function main() {
  const files = await collectMjsFiles(SCRIPTS_DIR);
  const failures = [];

  for (const file of files) {
    const relative = path.relative(ROOT, file);
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });

    if (result.status !== 0) {
      failures.push({
        file: relative,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
      });
    }
  }

  if (failures.length > 0) {
    console.error("Node tool syntax check failed:");
    for (const failure of failures) {
      console.error(`- ${failure.file}`);
      if (failure.output) console.error(failure.output);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Node tool syntax check passed for ${files.length} .mjs files.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
