# R00 protected runner integration

Status: local wiring implemented; independent review and integrated suites pending. No canonical group is closed.

On 15 October 2026 the runtime worker integrated target core de297ad and listener follow-up 60d1c4b. The package scripts now invoke the guard before client, server, coverage, AI and browser runners. Server database scripts retain server/ as their working directory and accept modules/... filters. test:server:unit selects database-disabled mode for isolated tests. Client and AI runners use unit mode; browser and ordinary server runners require an explicit disposable manifest. All these entrypoints check the pinned Node runtime first.

CI source now declares an ephemeral postgres:18 service with an admin database and unique per-job run IDs/databases. Each database job writes its own credentials-free intent manifest and invokes the protected bootstrap, which applies versioned migrations and establishes a persisted run marker. CI no longer invokes the ambient drizzle-kit db:migrate path for tests. This is source wiring; no GitHub Actions execution, staging readiness or database proof was performed by this worker.

Fresh native ARM64 Node24.22.0 checks: test:targets 8/8; test:runtime 2/2; test:server:unit -- middleware/__tests__/rateLimit.wiring.test.ts 11/11 (Vitest root reported server/); test:ai:eval 15/15 with provider credentials cleared; npm run check passed. Invoking test:server:run without a manifest refused with TEST_TARGET_MANIFEST is required before Vitest launched. No database connection was attempted. YAML parser availability probes found neither yaml nor js-yaml locally; they were setup probes, not validation evidence. CI YAML execution remains pending. Parent owns serial integrated suites and final review.

Review amendment: the first wiring revision incorrectly used runner.temp in job-level env. The integrator checked GitHub's context availability contract and rejected it. Manifest paths now use RUNNER_TEMP inside the bootstrap run step, exported immediately for bootstrap and persisted through GITHUB_ENV for subsequent test steps. Both values are absolute, preserving the server cwd contract. Hosted workflow validation/execution remains pending.


## Client worker compatibility correction

The campaign client suite at 649650d reported zero collected tests across files. One focused native ARM64 Node24.22.0 command, npm run test:run -- client/src/data/__tests__/occupations.test.ts --reporter=verbose, identified ERR_INVALID_URL_SCHEME at server/testing/test-target.mjs:98 before collection. The same failure reproduced in the runtime worktree at 88696d0, including the new focused client compatibility regression. Vite's client asset plugin matches static new URL(asset, import.meta.url) expressions; the resulting non-file asset URL cannot be passed to Node fileURLToPath.

The repair only resolves the empty dotenv fixture with node:path from the module filesystem path. It retains environment preparation, all client setup guards, outbound denial and database target validation. The new client/src/__tests__/protected-target.compatibility.test.ts must run under the existing jsdom client config; it checks an absolute readable fixture, no parsed dotenv variables, and disabled unit database/provider/mail configuration. The fixture intentionally contains a comment, so its regression checks parsed dotenv variables rather than requiring zero file bytes.

Focused green: npm run test:run -- client/src/__tests__/protected-target.compatibility.test.ts client/src/data/__tests__/occupations.test.ts reported 2 files passed /23 tests passed, zero skipped; npm run test:targets reported8/8. No broad client/server suite or database connection ran in this worker. Parent owns the full integrated retry after independent review.
Fresh npm run check also passed after the correction: TypeScript, LOC ratchet (zero new or grown oversized files), script syntax, metadata and template guards.
