# W9 Staging Checkpoint Evidence - 2026-07-07

## W9 Release Evidence

- W9 application-code baseline: `aa8753f` (`docs: record W9 CI billing blocker`)
- Evidence-only W9 status refresh: `faa3317` (`docs: record W9 CI green state`)
- Verified repo-side W9/W10 guard baseline: `19c175c` (`docs: record latest W9 guard CI evidence`)
- Pushed commits since the previous remote checkpoint:
  - `4906177` (`fix: close local production readiness gaps`)
  - `5d81525` (`docs: align module report conclusion with gates`)
  - `fda2137` (`docs: refresh W9 staging checkpoint state`)
  - `aa8753f` (`docs: record W9 CI billing blocker`)
  - `faa3317` (`docs: record W9 CI green state`)
  - `266c1f7` (`docs: harden W9 evidence validation`)
  - `9eda7aa` (`docs: track W10 score gaps across all modules`)
  - `cec710c` (`docs: keep final module gate non-mutating`)
  - `5f1d5be` (`docs: trace W10 worksheet to assessment gates`)
  - `63a60d0` (`docs: enforce bidirectional W9 W10 gate pairing`)
  - `0e39d53` (`docs: require dated W9 evidence artifacts`)
  - `19c175c` (`docs: record latest W9 guard CI evidence`)
- Local repo-side guards covering these commits:
  - `npm run check`: passed
  - `npm run build`: passed
  - `npm run deploy:verify`: passed
  - `npm run report:modules`: passed, 22/22 assessed modules and 0 security gate entries
  - `npm run check:bundle`: passed, 184.09 kB initial JS gzip vs 300 kB budget
  - `npm run test:run:settings`: passed, 34 files / 295 tests
  - `npm run test:run:rest`: passed, 91 files / 849 tests
  - `npm run test:server:run`: passed
  - `cd server; npx vitest run core/calculations --reporter=dot`: passed, 16 files / 404 tests
  - `git diff --check`: passed
- Current external gate results:
  - `git push origin main`: passed through `19c175c`
  - `npm audit --omit=dev`: passed, 0 vulnerabilities
  - CI run `28875396176`: passed on rerun for `aa8753f`. `verify` completed successfully, including production dependency audit, type check, migrations, real-Postgres server tests, coverage-gated client tests, build, and client bundle budget. `e2e` completed successfully, including the browser smoke/regression gate.
  - Amplify Security run `28875396652`: passed on rerun for `aa8753f`.
  - CI run `28885048133`: passed for `faa3317`. `verify` and `e2e` completed successfully.
  - Amplify Security run `28885048175`: passed for `faa3317`.
  - CI run `28992392768`: passed for `0e39d53`. `verify` completed successfully, including production dependency audit, type check, migrations, real-Postgres server tests, coverage-gated client tests, build, and client bundle budget. `e2e` completed successfully, including the browser smoke/regression gate.
  - Amplify Security run `28992392770`: passed for `0e39d53`.
  - CI run `28993015584`: passed for `19c175c`. `verify` completed successfully, including production dependency audit, type check, migrations, real-Postgres server tests, coverage-gated client tests, build, and client bundle budget. `e2e` completed successfully, including the browser smoke/regression gate.
  - Amplify Security run `28993015556`: passed for `19c175c`.
  - Earlier failed runs `28875087920`, `28875087972`, and the first attempts for `28875396176`/`28875396652` were account-blocked before any job steps started. The successful reruns above supersede that blocker.

## Default Render Host Probe

Target from `render.yaml`: `https://personal-finance-app.onrender.com`

Current refresh attempt:

- `GET /`: timed out
- `GET /healthz`: HTTP 404
- `GET /api/health`: HTTP 404
- `GET /health/live`: HTTP 404
- `GET /health/ready`: HTTP 404
- `GET /health/startup`: HTTP 404

Last recorded probe before this refresh:

- `GET /`: HTTP 200, body starts with `Welcome!`
- `GET /healthz`: HTTP 404, body contains `Cannot GET /healthz`
- `GET /api/health`: HTTP 404, body contains `Cannot GET /api/health`

Assessment: W9 live smoke cannot start yet. The code is pushed, local/audit gates are clean, and GitHub Actions are green on the current main SHA, but the default Render host is still not verified as serving the current repository build. The known host does not expose `/healthz` or the documented `/health/*` endpoints.

## User Checkpoint

Provision or confirm the Render service from `render.yaml`, and provide:

- Render app URL.
- Confirmation the service was created from `render.yaml`.
- Confirmation `CLIENT_URL` and `APP_URL` match the real Render URL.
- Confirmation `DATABASE_URL`, `SESSION_SECRET`, `REDIS_URL`, and `TRUST_PROXY=1` are set.
- Whether `SMTP_*`, `GEMINI_API_KEY`, and `VAPID_*` are enabled or intentionally disabled.

Do not enable `DATABASE_SSL_REJECT_UNAUTHORIZED=true` yet. The next executor step is to prove baseline connectivity first, then stop again for the TLS verification flip.

## Executor Follow-up

After the checkpoint is satisfied:

1. Run `npm run smoke:staging:health -- --base-url <Render app URL>` and verify `/healthz`, `/health/live`, `/health/ready`, and `/health/startup` pass on the Render URL.
2. Fill the concrete W9 smoke evidence worksheet in `docs/reviews/production-readiness-w9-smoke-evidence-template-2026-07-07.md`.
3. Save the completed worksheet as a dated W9 evidence file and run `npm run check:w9-evidence -- --file <completed evidence file>`.
4. Prove database TLS connectivity.
5. Stop for the `DATABASE_SSL_REJECT_UNAUTHORIZED=true` flip.
6. Re-run smoke after the TLS flip.
7. Record rollback exercise evidence.
