import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const readText = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const failures = [];

const check = (condition, message) => {
  if (!condition) {
    failures.push(message);
  }
};

const contains = (text, expected) => text.includes(expected);

const packageJson = JSON.parse(readText("package.json"));
const replit = readText(".replit");
const render = readText("render.yaml");

check(
  packageJson.scripts?.build ===
    "vite build && esbuild server/index-prod.ts --platform=node --packages=external --bundle --format=esm --outfile=dist/index.js",
  "package.json must build both the Vite client and Express production bundle",
);
check(
  packageJson.scripts?.start === "node dist/index.js",
  "package.json start must run the bundled Express backend",
);
check(
  packageJson.scripts?.["db:migrate"] === "drizzle-kit migrate",
  "package.json must expose db:migrate for versioned production migrations",
);

check(
  contains(replit, 'deploymentTarget = "cloudrun"'),
  ".replit deployment target must run a backend, not static hosting",
);
check(
  contains(replit, 'build = ["npm", "run", "build"]'),
  ".replit deployment build must use npm run build",
);
check(
  contains(replit, 'run = ["npm", "run", "start"]'),
  ".replit deployment run command must start the production backend",
);
check(
  !contains(replit, 'deploymentTarget = "static"'),
  ".replit must not use the static deployment target",
);

check(
  contains(render, "type: web"),
  "render.yaml must define a web service",
);
check(
  contains(render, "buildCommand: npm ci && npm run build"),
  "render.yaml must build with npm ci && npm run build",
);
check(
  contains(render, "preDeployCommand: npm run db:migrate"),
  "render.yaml must run db:migrate before traffic shifts",
);
check(
  contains(render, "startCommand: npm run start"),
  "render.yaml must start the production backend",
);
check(
  contains(render, "healthCheckPath: /health/ready"),
  "render.yaml must use the readiness endpoint /health/ready as the deploy health check",
);
check(
  contains(render, "fromDatabase:") && contains(render, "personal-finance-db"),
  "render.yaml must provision/inject the managed Postgres DATABASE_URL",
);
check(
  contains(render, "key: REDIS_URL") &&
    contains(render, "fromService:") &&
    contains(render, "personal-finance-cache"),
  "render.yaml must inject REDIS_URL from the Render Key Value service",
);
check(
  contains(render, "key: SESSION_SECRET") && contains(render, "generateValue: true"),
  "render.yaml must generate SESSION_SECRET",
);
check(
  /- key: CRON_SECRET\r?\n\s+generateValue: true/.test(render),
  "render.yaml must generate CRON_SECRET (without it every /api/cron request is refused)",
);
check(
  /- key: SCHEDULER_ENABLED\r?\n\s+value: "true"/.test(render),
  "render.yaml must run the in-process scheduler (SCHEDULER_ENABLED=true)",
);
check(
  contains(render, "key: CLIENT_URL") && contains(render, "key: APP_URL"),
  "render.yaml must set CLIENT_URL and APP_URL",
);
check(
  contains(render, "key: TRUST_PROXY") && contains(render, 'value: "1"'),
  "render.yaml must set TRUST_PROXY=1 behind Render TLS proxy",
);
check(
  contains(render, "DATABASE_SSL_REJECT_UNAUTHORIZED") &&
    contains(render, "DATABASE_SSL_CA_FILE"),
  "render.yaml must document the staged DB TLS certificate-verification env vars",
);
check(
  contains(render, "type: keyvalue") && contains(render, "maxmemoryPolicy: allkeys-lru"),
  "render.yaml must provision Redis/Key Value for cache, rate limits, and scheduler locks",
);

if (failures.length > 0) {
  console.error("Deploy readiness verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Deploy readiness verification passed.");
