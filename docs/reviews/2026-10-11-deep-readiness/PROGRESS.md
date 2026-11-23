# Deep readiness assessment — execution ledger

Final scope: full existing application functionality, with staging as a required proving environment. The owner explicitly withdrew the original 11 November deadline during assessment. One primary developer assumed; hosting URL not supplied. Assessment and specifications only; application source remains unchanged.

## Baseline

- Local and GitHub main: `381e9439afabe7c6cf829cb1cbded91d36da44ee` (verified during this assessment).
- Existing untracked `.claude/launch.json` is unrelated and preserved.
- Current host: Node 22.23.2, npm 11.19.1, PostgreSQL 18.6. Repository/CI target Node 20, PostgreSQL 16: local results are not environment-parity proof.
- Historical exact-SHA CI run 29771307852 succeeded on 20 July 2026; fresh local checks and dependency audit are recorded in EVIDENCE.md.
- Four open PRs: #149 hooks, #150 MFA flag honesty, #151 CI concurrency, #152 GRZ route split (draft). None assumed merged or correct from its title.
- Real development DB `finance_app` is excluded from writes. Two newly created empty local databases `finance_app_audit_20261011_server_test` and `finance_app_audit_20261011_browser_test` were migrated successfully using versioned migrations. Credentials are not stored in artifacts.

## Completed assessment work

- Current source inventory and historical reconciliation across all 22 indexed modules.
- Type/guard checks, 1,384 client tests, 2,660 server tests, build and static deployment/bundle checks passed; client/server coverage thresholds passed.
- Chromium suite: 76 passed, 1 skipped. Manual UI plus selected real HTTP/database probes independently confirmed positive ledger behavior and concrete auth/privacy/import/UI failures.
- Fresh production audit: 9 affected packages (1 critical, 4 high, 4 moderate); applicability/remediation remains work.
- Four specialist reports, central full-app assessment, 20-packet completion specification, enhancement options, dependency-based delivery/launch plan, and 62-row remaining-work register.
- Independent reviewers checked central scope/evidence/estimates; arithmetic, full role matrix, MFA policy/concurrency cases, investment income acceptance and dependency wording were corrected.
- No application remediation, deployment, commit, PR, invitation or real financial transaction was performed.

## Subsequent specification change — CHG-AI-01

On 11 October the owner requested Claude as Thandi's primary provider and Gemini as fallback, then explicitly chose specification-only work. Added THANDI_PROVIDER_SPEC.md and updated P16, overview and plan. New P16 estimate4–7 days; total72–122 days. Provider consent, fallback/error/cost policy, shared interfaces and acceptance are specified. No application code, dependencies, keys or deployment configuration changed; no credits were consumed. The62 findings and their historical evidence remain unchanged.

## Evidence storage and closeout

On 14 October, completed both CHG-AI-01 review corrections in the specification: owner/admin-only household consent with role-aware copy and denial tests; atomic shared budget admission, replay-safe reconciliation and conservative handling of unknown charges before fallback. Added two-instance last-budget-unit and failure/restart acceptance cases. Updated the P16 summary; estimates remain 4–7 days for P16 and 72–122 days overall. Documentation only; no app code, API calls, credits, keys or deployment settings changed. The separate 13 October independent-readiness directory was left untouched.

Raw local tool/test logs: `.local/readiness-2026-10-11/` (ignored by Git). Durable sanitized evidence and the final documents are in this directory. Temporary synthetic databases are retained for reproducibility. The local audit server is stopped at assessment closeout. No production readiness claim has been made; all register rows remain open until implementation and closure proof.
