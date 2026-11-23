# Independent readiness assessment - progress ledger

Assessor: Claude Fable 5.1 (claude-fable-5-1), Claude Code desktop session, effort high.
Started: 2026-10-13T20:09Z. Independence rule: the 2026-10-11 package under docs/reviews/2026-10-11-deep-readiness/ is NOT read during this assessment; the owner will compare the two afterwards.

## Baseline (verified 2026-10-13T20:09Z)

- Branch main, HEAD 381e9439afabe7c6cf829cb1cbded91d36da44ee, equal to origin/main after fetch.
- Working tree: only two untracked paths (.claude/launch.json, docs/reviews/2026-10-11-deep-readiness/). No worktrees besides the main checkout.
- Open PRs: #149 hooks money-guard precision, #150 MFA flag honesty, #151 CI concurrency, #152 GRZ route split (draft). None merged; none assumed correct.
- Host: Node v22.23.2, npm 11.19.1. CI (.github/workflows/ci.yml) pins Node 20 and postgres:16. Local results are therefore not parity proof.
- Dev database name: finance_app (read-only for this assessment). Server test config derives finance_app_test and refuses non-test-scoped databases (server/vitest.config.ts, server/testing/test-database).
- Raw logs: .local/readiness-fable-2026-10-13/ (gitignored). Durable evidence: ./evidence/.

## Assumptions (owner has not answered)

- Launch date: planned for 11 November 2026; sensitivity to "no fixed date" shown in LAUNCH_PLAN.md.
- Launch audience: invited household pilot; public multi-household implications assessed separately.
- Capacity: one primary developer.

## Phase status

- [x] 1 Baseline and inventory: five read-only inventories saved under evidence/inventory-*.md (20:10Z-20:25Z)
- [x] 2 Verification suites: npm run check green 9.3s; server 201 files/2660 tests green 6m42s on finance_app_test; client 164 files/1384 tests green 5m18s. Pending: build, deploy:verify, check:bundle, npm audit, e2e smoke against the audit DB
- [x] 3 Browser journeys on finance_app_audit_fable_20261013 (port 5055, SMTP sink, Gemini key empty): register, verify-email (link 404 + correct route), household, account, expense, transfer with step-up, dashboard, goal wizard, recurring (400), members add (404), security page, password reset (sessions revoked), login/wrong password, mobile viewport (sidebar clips content; 429 during navigation), notifications, logout/protected route. Receipt file upload and weekly-recap wizard not exercised in the pane. Findings in evidence/findings-draft.md (R1-R21 in EVIDENCE.md).
- [~] 4 Financial correctness traces: six Opus 5.5 (high) domain verifiers launched 20:44Z (budgets-goals-recurring, import-receipts-organization, investments-grz, reports-consistency, security-privacy, settings-notifications-ai), each with its own fixture household; reports land in evidence/domain-*.md
- [~] 5 Security, privacy, operations: ops inventory done; security-privacy agent running; npm audit: 9 advisories (1 critical) recorded
- [x] 6 Classification, spec, plan: all eight deliverables written (README, COVERAGE, EVIDENCE, GAPS, COMPLETION_SPEC, ENHANCEMENTS, LAUNCH_PLAN, DECISIONS) 23:25Z-23:45Z
- [x] 7 Skeptic pass (Opus 5.5 high, evidence/skeptic-pass.md, 23:47Z-23:57Z): verdict upheld; ISO-01, PRIV-01/02/03, RC-01, IMP-01 reproduced live; zero balance drift over 21 accounts / 89 transactions; 60 bookkeeping corrections applied across GAPS, COMPLETION_SPEC, LAUNCH_PLAN, README, COVERAGE, EVIDENCE, DECISIONS (RC-01 root cause, BGR-01 to P0, F-SEC-01 to P2, SEC-07 into WP-04, SNA-* ID prefixes, view_only and read-back counts, weekday dates, effort sums 27.5-41 / 36.5-53.5 / 44-64, plan B 11-18 Dec)

## Session continuity

- 2026-10-13 ~21:10Z: the first six Opus 5.5 verifiers were terminated by the account's monthly spend limit before writing reports; the Claude Code session also ended and resumed. Audit server restarted 22:13Z (same DB, sessions persisted in Postgres). All six verifiers relaunched 22:15Z-22:20Z with the same scope and READY fixture jars; the outsider user had been deleted and was recreated as audit_a5_outsider2.

## Domain verifier status

- budgets-goals-recurring: DONE 22:35Z (0 P0, 4 P1, 5 P2)
- investments-grz: DONE 22:50Z (2 P0, 13 P1)
- import-receipts-organization: DONE 22:58Z (1 P0 overwrite data loss, 6 P1)
- reports-consistency: DONE 23:03Z (1 P0 silent FX in ratios, 8 P1); refuted the lead's 'exclusive endDate' reading → F-TXN-01 re-rooted to summary cache + UTC month range
- security-privacy: DONE 23:10Z (P0: cross-household goal activity read ISO-01; private-account leaks via goals/tags/recurring PRIV-01..05; P1: revoke does not kill sessions SES-01, invite recipient unchecked SEC-01, ownerless household SEC-06, invite link route missing SEC-02)
- settings-notifications-ai: DONE 23:20Z (5 P1: profile drops 14 fields, preferences never persist, export stub, session survives deletion, PII retained after deletion)

## Blockers

- e2e smoke BLOCKED on this host: @playwright/test needs chromium_headless_shell-1208, only 1223 installed (download needs owner approval). CI installs its own.
- Audit server restarted 20:48Z with GEMINI_API_KEY='' (dotenv had re-injected the real key earlier; one failed Gemini call was made before the fix, no successful external AI call).
- Fixture shortcut: agent users are email-verified directly in the audit DB (verify-in-db.mjs) because unauthenticated verify-email is blocked by F-AUTH-04.

- Linear connector not authorised in this session: tracker status is a blocked check.

## Closeout (2026-10-13T23:59Z / 2026-10-14 01:59 Lusaka)

- Assessment complete for everything reachable on this host. Runtime verification incomplete for: deployed environment, real e-mail, real AI provider, real devices, Playwright smoke (EVIDENCE.md section 5).
- Application source, product decisions, deployment configuration and earlier assessment records unchanged. Only writes: this package, `.local/readiness-fable-2026-10-13/` (gitignored), the `audit` entry in the untracked `.claude/launch.json`, and a scratchpad wrapper outside the repo.
- Removed: `uploads/receipts/6cfe9c37-433a-4d44-8935-d53c163bb1ee/` (8 synthetic PNG/JPG files written by the app during the receipts verification). Audit server on :5055 and the SMTP sink stopped.
- Retained for reproducibility: databases `finance_app_audit_fable_20261013`, `finance_app_audit_fable_e2e`, `finance_app_test`; synthetic users `*@audit.invalid` (passwords in the agents' scratch dirs where changed); the `A5 Security Household` is intentionally left ownerless (SEC-06 evidence) and `audit_a6_delete` erased (DEL evidence). Drop the two `finance_app_audit_fable_*` databases when no longer needed.
- Dev database `finance_app` untouched. No real e-mail sent; one failed Gemini request before the key was emptied; no deploy, commit, push, merge or production setting changed.

## Post-closeout: comparison (14 Oct)

Read the 11 October package for the first time and wrote COMPARISON-vs-2026-10-11.md: 36 converging rows, 14 severity differences, Codex-only and Fable-only lists, effort reconciliation, and the changes each package should adopt. Two Codex source-only P0s (ORG-001 role fall-through, FIN-03 one-legged overwrite) were checked in source and confirmed. No other file in either package was changed; the Codex package is being edited by a separate session on 14 Oct (its PROGRESS.md gained a CHG-AI-01 review note).

## Re-scope to the full application (14-15 Oct)

Owner clarified that the current brief is the complete application with no withheld features and no fixed date (the 11 October package already carried that brief). Actions:
- Re-ran three probes against the audit database with the audit server restarted (EVIDENCE.md 4b): ORG-003 cross-household ids in rule actions (confirmed, HTTP+DB), ORG-004 dry-run writes for tag and split actions (confirmed, HTTP+DB), AH-09 view-only writes household preferences (confirmed, HTTP+DB). Checked ORG-001 and FIN-03 in source (confirmed). Probe rules deleted; probe transaction 5eb7971c and its two split rows left in the disposable DB; member role restored.
- Rewrote COMPLETION_SPEC.md (21 packets, 70.5-107.5 developer-days), LAUNCH_PLAN.md (gate-driven, projections instead of a pilot date), README.md (verdict and eight answers for the full brief).
- GAPS.md gained 1b (rows adopted from the 11 October package with their verification state) and the Launch column was redefined: Hide is no longer a disposition. ENHANCEMENTS.md 1 now defines the full product. DECISIONS.md ASM-01/02 and DEC-01/03/04 updated; DEC-11..13 added.
- No application source, deployment configuration or 11 October file was changed. Audit server stopped after the probes.

## Thandi specification assessment (15 Oct)

Owner reported free Claude API access and asked for an assessment of the 11 October THANDI_PROVIDER_SPEC. Wrote THANDI_SPEC_ASSESSMENT.md: 12 spec claims checked against the AI module (two stale: conversation endpoints are implemented; consent version is reported but not enforced in the middleware), 10 gaps and risks, a Phase A (Claude only plus local degraded mode, 3-5 days) / Phase B (Gemini failover and spend ledger, 2-4 days, owner-triggered) split, and five sub-decisions under DEC-11. WP-19 repriced; totals now 69.5-105.5 developer-days. No code, dependency or configuration changed; no provider call made.

## Consolidation (15 Oct)

Owner asked for one final completion specification and plan consolidating both assessments, with Claude primary and Gemini fallback for Thandi retained. Written to `docs/reviews/2026-10-15-consolidated-completion-fable/` (README, DECISIONS, REGISTER, COMPLETION_SPEC with 22 work orders CP-00..CP-21, REMEDIATION_PLAN with the agent operating protocol, ACCEPTANCE_CATALOGUE J01-J16 with oracles). Consolidated effort 86-138 developer-days before a 20% reserve. Note: the files were first written to `docs/reviews/2026-10-15-consolidated-completion/`, where a parallel session was writing its own consolidation at the same time and overwrote README.md and DECISIONS.md; the four intact files were moved to the `-fable` directory and the two overwritten files re-created there. No application code changed.

## Unified specification (15 Oct)

Owner asked for one merged specification after the comparison rounds. Written to `docs/reviews/2026-10-15-unified-completion-spec/FINAL_COMPLETION_SPEC.md` with `REGISTER.csv`: Parts A (governing contracts), B (Thandi), C (unified register, 103 rows), D (22 work orders R00-R21 with file references, slices, tests, oracles), E (agent protocol), F (J01-J16 and fixtures), G (gates, dependencies, lanes, calendar, risks). Effort 92-151 developer-days before a 20% reserve. It supersedes both consolidations as the execution authority; both remain as evidence. No application code changed.
