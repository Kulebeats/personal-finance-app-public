import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
// Jobs in .github/workflows/ci.yml that install Node and start Postgres: verify, e2e, quick.
const CI_JOB_COUNT = 3;

// This runs before build/start/migration, without importing dotenv or the app.
export function checkRuntime(version = process.versions.node, directory = root) {
  const read = (name) => readFileSync(path.join(directory, name), "utf8").replace(/\r\n/g, "\n");
  const pin = read(".node-version").trim();
  const manifest = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const failures = [];
  if (!/^24\.\d+\.\d+$/.test(pin)) failures.push(".node-version must pin a Node 24 LTS patch");
  if (version !== pin) failures.push(`Node ${pin} is required; running ${version}`);
  if (read(".nvmrc").trim() !== pin) failures.push(".nvmrc differs from .node-version");
  if (manifest.engines?.node !== pin || lock.packages?.[""]?.engines?.node !== pin) {
    failures.push("package engines and lockfile must match .node-version exactly");
  }
  const ci = read(".github/workflows/ci.yml");
  const versions = [...ci.matchAll(/^\s+node-version(?:-file)?:\s*(.+)$/gm)];
  // Three CI jobs install Node: verify, e2e and the draft-only quick job.
  if (versions.length !== CI_JOB_COUNT || versions.some(([, value]) => value.trim() !== ".node-version")) {
    failures.push("all three CI jobs (verify, e2e, quick) must select Node through .node-version");
  }
  if (!/^\s+node-version-file: \.node-version$/m.test(read(".github/workflows/ai-eval-gate.yml"))) {
    failures.push("AI evaluation CI must select Node through .node-version");
  }
  const render = read("render.yaml");
  if (!render.includes(`- key: NODE_VERSION\n        value: ${pin}`)) {
    failures.push("Render NODE_VERSION must match .node-version");
  }
  // All three CI jobs start the database with `docker run ... postgres:<major>`
  // (quick only when a server test changed, but the declaration is always there).
  const ciPostgresTags = [...ci.matchAll(/^\s+postgres:(\S+)$/gm)].map(([, tag]) => tag);
  const ciSelectsPostgres18 = ciPostgresTags.length === CI_JOB_COUNT && ciPostgresTags.every((tag) => tag === "18");
  if (!ciSelectsPostgres18 || !render.includes('postgresMajorVersion: "18"')) {
    failures.push("CI and Render must select PostgreSQL 18");
  }
  if (failures.length) throw new Error(failures.join("\n"));
  return pin;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Runtime parity verified: Node ${checkRuntime()}, PostgreSQL 18 declarations.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
