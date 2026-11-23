import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 10_000;

const PROBES = [
  {
    id: "HEALTH-001",
    path: "/healthz",
    expectedStatus: 200,
    validate(body) {
      return body?.status === "ok";
    },
    summarize(body) {
      return `status=${body?.status ?? "missing"}`;
    },
  },
  {
    id: "HEALTH-002",
    path: "/health/live",
    expectedStatus: 200,
    validate(body) {
      return body?.status === "healthy";
    },
    summarize(body) {
      return `status=${body?.status ?? "missing"}`;
    },
  },
  {
    id: "HEALTH-003",
    path: "/health/ready",
    expectedStatus: 200,
    // The public body is the status only; with CRON_SECRET set this probe asks
    // for the operator view and then also requires a healthy database check.
    operator: true,
    // "degraded" means a scheduled job is stale; the dependencies still answer.
    validate(body) {
      if (!["healthy", "degraded"].includes(body?.status)) return false;
      return body?.checks === undefined || body.checks.database?.status === "healthy";
    },
    summarize(body) {
      if (body?.checks === undefined) {
        return `status=${body?.status ?? "missing"}; details=redacted (set CRON_SECRET for the operator view)`;
      }
      const database = body?.checks?.database?.status ?? "missing";
      const cache = body?.checks?.cache?.status ?? "missing";
      const jobs = body?.scheduledJobs?.status ?? "missing";
      return `status=${body?.status ?? "missing"}; database=${database}; cache=${cache}; scheduledJobs=${jobs}; revision=${body?.revision ?? "none"}`;
    },
  },
  {
    id: "HEALTH-004",
    path: "/health/startup",
    expectedStatus: 200,
    // Startup is redacted exactly like readiness.
    operator: true,
    validate(body) {
      if (!["healthy", "degraded"].includes(body?.status)) return false;
      return body?.checks === undefined || body.checks.database?.status === "healthy";
    },
    summarize(body) {
      if (body?.checks === undefined) {
        return `status=${body?.status ?? "missing"}; details=redacted (set CRON_SECRET for the operator view)`;
      }
      const database = body?.checks?.database?.status ?? "missing";
      const cache = body?.checks?.cache?.status ?? "missing";
      return `status=${body?.status ?? "missing"}; database=${database}; cache=${cache}`;
    },
  },
];

function readArg(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function usage() {
  return [
    "Usage:",
    "  npm run smoke:staging:health -- --base-url https://your-render-url",
    "",
    "Options:",
    "  --base-url <url>       Required unless STAGING_BASE_URL is set.",
    "  --timeout-ms <number>  Per-request timeout. Default: 10000.",
    "  --json <path>         Optional path for machine-readable evidence output.",
  ].join("\n");
}

function normalizeBaseUrl(value) {
  if (!value) {
    throw new Error(`Missing staging URL.\n\n${usage()}`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid staging URL: ${value}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Staging URL must use http or https: ${value}`);
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

async function fetchJson(url, timeoutMs, extraHeaders = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...extraHeaders },
      signal: controller.signal,
    });
    const text = await response.text();

    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      bodyPreview: text.slice(0, 300).replace(/\s+/g, " ").trim(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runProbe(baseUrl, probe, timeoutMs) {
  const url = `${baseUrl}${probe.path}`;
  const startedAt = new Date().toISOString();

  try {
    // The secret is only ever sent as a header, never printed or written out.
    const operatorHeaders = probe.operator && process.env.CRON_SECRET
      ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {};
    const response = await fetchJson(url, timeoutMs, operatorHeaders);
    const statusMatches = response.status === probe.expectedStatus;
    const bodyMatches = probe.validate(response.body);
    const passed = statusMatches && bodyMatches;

    return {
      id: probe.id,
      method: "GET",
      path: probe.path,
      url,
      startedAt,
      finishedAt: new Date().toISOString(),
      passed,
      httpStatus: response.status,
      expectedStatus: probe.expectedStatus,
      summary: response.body
        ? probe.summarize(response.body)
        : `non-json body: ${response.bodyPreview || "(empty)"}`,
      body: response.body,
    };
  } catch (error) {
    return {
      id: probe.id,
      method: "GET",
      path: probe.path,
      url,
      startedAt,
      finishedAt: new Date().toISOString(),
      passed: false,
      httpStatus: null,
      expectedStatus: probe.expectedStatus,
      summary: error instanceof Error ? error.message : String(error),
      body: null,
    };
  }
}

function renderMarkdownRows(results) {
  return results
    .map((result) => {
      const verdict = result.passed ? "PASS" : "FAIL";
      const status = result.httpStatus ?? "request failed";
      return `| ${result.id} | \`${result.method} ${result.path}\` | ${verdict} | HTTP ${status}; ${result.summary}; ${result.finishedAt} |`;
    })
    .join("\n");
}

async function main() {
  const baseUrl = normalizeBaseUrl(readArg("--base-url") ?? process.env.STAGING_BASE_URL);
  const timeoutMsRaw = readArg("--timeout-ms");
  const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`--timeout-ms must be a positive integer, got: ${timeoutMsRaw}`);
  }

  const results = [];
  for (const probe of PROBES) {
    results.push(await runProbe(baseUrl, probe, timeoutMs));
  }

  const output = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    results,
    passed: results.every((result) => result.passed),
  };

  const jsonPath = readArg("--json");
  if (jsonPath) {
    const resolved = path.resolve(process.cwd(), jsonPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  console.log(`Staging health probe for ${baseUrl}`);
  console.log("");
  console.log("| ID | Probe | Result | Evidence |");
  console.log("|---|---|---|---|");
  console.log(renderMarkdownRows(results));

  if (!output.passed) {
    console.error("");
    console.error("Staging health probe failed. Do not start W9 functional smoke until all health probes pass.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
