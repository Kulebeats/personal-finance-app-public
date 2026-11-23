# R00.1 / R00.2 runtime and dependency evidence

Status: implementation and local compatibility evidence; independent review pending. R00, DEP-01 and DEP-02 are not CLOSED. Target protection, migration/bootstrap evidence, limiters and integrated suite results have separate ownership/evidence.

## Identity and authority

- Worker: `/root/r00_runtime`, GPT-6.1 Sol, high reasoning effort. Implementation work started 15 October 2026; first recorded baseline timestamp `2026-10-15T02:04:29.8373257+02:00`. Finish/checkpoint recorded below when the slice is frozen. No token/usage estimate is inferred.
- Worktree: `C:\Users\USER\.codex\worktrees\capital-r00-runtime`; branch `codex/capital-r00-runtime`.
- Baseline: `520fe2e63025e49590024038b3436f4e3930e30b`, containing application baseline `381e9439afabe7c6cf829cb1cbded91d36da44ee` and the preserved specifications. Initial `git status --short` was empty.
- Governing authority: master completion specification v2.2, sections 1–3, R00 register/packet and section 8; packet companion v1.2 R00 and host traps; parent campaign's explicitly authorized isolated local implementation. Canonical master/status files are owned by the parent and were not edited here.
- Implementation commit: recorded in the final checkpoint below. Local commits only; no push, deployment, provisioning, paid API call, real mail or shared/production DB connection.

## Runtime decision and actual identities

Selected Node: **24.22.0**, exact patch in package engines, lockfile, `.node-version`, `.nvmrc`, CI setup and Render `NODE_VERSION`. `.npmrc` enables engine-strict installation. A dependency-free runtime guard runs before build, application/client startup, migration, test-DB bootstrap and dependency compatibility checks. It imports no dotenv, application or DB module.

Official [Node release status](https://nodejs.org/en/about/previous-releases), [release schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json) and [distribution index](https://nodejs.org/dist/index.json) were fetched on 15 October 2026. Node 20 ended support on 30 April 2026; 24.22.0 was released 14 October and was Active LTS at execution. The official schedule gives Node 24 an end date of 30 April 2028. This is a dated selection, not a promise that the patch remains newest indefinitely.

| Identity | Observed result |
| --- | --- |
| Original host | Node 22.23.2, Windows ARM64; npm 11.19.1; checked-in engines and both original CI jobs selected Node 20 |
| Isolated selected runtime | Official Node 24.22.0 Windows ARM64, npm 11.19.1; no global runtime replacement |
| ARM64 archive SHA256 | `3a5c209a5bc59e65b3bc0fa13ed5e166a26bd3d55332847f498b76b037408d61`, verified against official `v24.22.0/SHASUMS256.txt` before extraction |
| Additional x64 validation | Official 24.22.0 Windows x64 under emulation; archive SHA256 `f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3`, likewise verified |
| Selected database major | PostgreSQL 18 in CI and Render declarations; local isolated campaign instance reported as 18.6 by its target owner; this worker did not connect to it |
| Migration source identity | 12 journal entries, last `0011_hash_email_verification_tokens`; no migration/business schema change in this slice |
| Redis | No Redis server connection or runtime version proven by this slice; distributed limiter evidence remains pending |
| Image native stack after upgrade | sharp 0.35.5, libvips 8.18.7, Windows ARM64 and Windows x64 image processing checks passed |
| OCR | tesseract.js 7.0.0, core 7.0.0; local dev-only English traineddata package 1.0.0; actual worker recognized `TOTAL 12345` on both architectures |
| Optional WebSocket native addon | bufferutil 4.1.0 loaded `mask`/`unmask` on selected ARM64 after clean install |

The companion proposed PostgreSQL 16. The master requires a supported combination verified at implementation time. [Render currently fully supports PostgreSQL 18](https://render.com/docs/postgresql-upgrading), and the isolated local campaign instance already uses 18.6, so the parent accepted 18 as the candidate major. Render's Blueprint major field selects the major for a **new** database; it does not upgrade an existing database. No existing database was upgraded. Actual CI execution, staging identities, existing-environment upgrade/restore compatibility and production parity remain unverified.

Render's [version precedence](https://render.com/docs/node-version) puts `NODE_VERSION` above the repo version files and engines. The explicit Blueprint value and files therefore agree. Dashboard overrides still require deployment-time read-back. The legacy `.replit` remains Node 20/PostgreSQL 16: guessed replacement module names were discarded because exact-patch availability was not proven. Replit is **UNVERIFIED / incompatible with the selected runtime guard** until separately configured and tested; it cannot silently establish DEP-02 closure.

## Fresh production audit and targeted remediation

The actual baseline `npm audit --omit=dev --json` produced **9 affected groups: 1 critical, 4 high, 4 moderate**. The committed [before report](production-audit-before.json) preserves advisory URLs/ranges. No `npm audit fix`, blanket dependency update or advisory suppression was used.

| Package/group | Baseline → selected installed version | Disposition |
| --- | --- | --- |
| express | 4.22.2 → 4.22.3 | Same-major patch; indirect qs finding also removed |
| body-parser | 1.20.5 → 1.20.8 | Targeted transitive patch |
| proxy-addr | 2.0.7 → 2.0.8 | Critical mapped-IPv6 trust subnet fix; HTTP spoofing regression included |
| qs override | 6.15.3 → 6.16.0 | Existing exact override advanced into patched range |
| ip-address | 10.2.0 → 10.7.4 | Targeted same-major transitive patch used by rate limiter |
| multer | 2.2.0 → 2.4.0 | Targeted same-major upgrade; accepted upload/oversize refusal compatibility |
| nodemailer | 9.0.3 → 10.1.1 | Explicitly reviewed major: bundled ESM/CJS TypeScript declarations, Node ≥20; local composition and actual loopback SMTP checks; named Transporter type import compatibility fix only |
| sharp | 0.34.5 → 0.35.5 | Explicitly reviewed pre-1.0 minor: libvips/libheif/librsvg advisory patches; Node ≥20.9; resize/thumbnail/OCR preprocessing validated |
| csv-parse | 6.1.0 → 7.0.3 | Explicit security upgrade; actual duplicated `__proto__` regression red before/green after |

The companion's historical CSV deferral to R09 was not retained as an instruction to ship a known vulnerable parser. The [maintainer advisory](https://github.com/adaltas/node-csv/security/advisories/GHSA-8cw4-87c7-c6xx) requires ≥7.0.2; the [maintainer changelog](https://github.com/adaltas/node-csv/blob/master/packages/csv-parse/CHANGELOG.md) explains that 7.0.0 was published with no intended breaking change. Quoted commas/newlines, BOM, CRLF, malformed quotes and duplicate legitimate purchases are preserved in the compatibility fixture. This does not establish R09 business import correctness.

[Sharp 0.35 breaking changes](https://sharp.pixelplumbing.com/changelog/v0.35.0/) and [0.35.5 changes](https://sharp.pixelplumbing.com/changelog/v0.35.5/) were inspected; application image call sites use none of the removed options. [Nodemailer changes](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md) were inspected; no real mail or external transport was used.

The [after report](production-audit-after.json) contains **0 production findings**. Node types align with selected major (`@types/node` 24.19.2). Other changed lockfile entries are the selected sharp platform/libvips tree and Node type support dependencies. This is the production npm advisory result on the recorded day; it does not claim an exhaustive security audit or zero development-tool advisories.

## Tests, failures and concrete observations

All dependency checks are standalone Node tests: no server configuration, `.env`, database, paid provider, real user data or application startup is imported. HTTP and SMTP tests use owned loopback listeners with reserved-domain synthetic data. OCR worker/core/language resolve locally from installed packages; no CDN is needed for the fixture. Browser OCR delivery remains R15 evidence, because the application's browser worker has its own transport/configuration path.

| Check | Observed result |
| --- | --- |
| Runtime regression red | With pin files in place but old package/CI/Render declarations, 1 passed / 1 failed with explicit parity assertion; early missing-file attempts were harness setup failures and are not counted as behavioral red |
| CSV vulnerability red on old install | 5 dependency checks passed / 1 failed; duplicated `__proto__` columns replaced the object prototype with an array |
| Clean baseline bootstrap on selected x64 | `npm ci --no-audit --no-fund`: 688 packages; expected original package Node20 engine warning before pin repair |
| Clean repaired bootstrap on native ARM64 | `npm ci --no-audit --no-fund`: 681 packages installed successfully; worktree-local node_modules, no junction/shared dependency mutation |
| Runtime tests after repair | `npm run test:runtime`: 2 passed, 0 failed, 0 skipped |
| Dependency/native/OCR tests after repair | `npm run test:dependencies`: 8 passed, 0 failed, 0 skipped on ARM64 and x64; prototype retained, oversized upload rejected, spoofed proxy hop rejected, local SMTP accepted, OCR exact synthetic text |
| Static check x64 | `npm run check`: passed after fixing the two Nodemailer namespace type errors; 0 new/grown oversized files, all metadata/template guards passed |
| Build x64 | `npm run build`: 4,600 modules transformed; Vite build passed, external-package Express bundle emitted; no server executed |
| Bundle budget | `npm run check:bundle`: 185.78 kB initial JS gzip against 300 kB budget |
| Deployment source guard | `npm run deploy:verify`: passed; this is source validation, not deployment or staging verification |

Full client/server/browser suites are intentionally reserved for the parent's integrated exact candidate with the target worker's final wrapper, run serially. This slice has no DB proof. CI protected-bootstrap script integration is a subsequent coordinated commit, not evidence from an unsafe baseline suite. No full downstream workflow or register closure follows from these checks.

## Checkpoint and handoff

Resume checkpoint: 15 October 2026 at 02:27 Africa/Lusaka. Fresh native Windows ARM64 Node 24.22.0 verification passed: runtime 2/2; dependency/native/OCR 8/8; npm production audit 0 vulnerabilities; npm run check (including TypeScript and all source/metadata guards) passed; npm run build passed (4,600 client modules and server bundle). This resumes and preserves the predecessor implementation. The implementation commit is the commit introducing this file; resolve with git log -- docs/reviews/completion-v2-evidence/R00/RUNTIME.md. Independent review remains pending. Parent owns canonical status and integration. Required next evidence includes protected bootstrap/migration identity, full serial integrated suites on Node24/PG18, Redis/multi-instance limiter checks, hosted exact revision and any controlled existing-DB upgrade/restore path. OI-01/OI-06 still gate real provisioning/deployment.
