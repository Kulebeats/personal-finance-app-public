# R02 four-agent execution plan

**Goal:** Finish the pending-session server boundary and client session/cache boundary using two parallel implementers, independent review and Astra final acceptance.

**Architecture:** Retain the settled [session-access design](2026-10-15-r02-session-access-design.md) and [implementation tasks](2026-10-15-r02-session-access-implementation.md). Parallelize construction around one shared response contract; serialize database execution, shared-file changes and integration. Separate author, independent reviewer and final decision ownership.

**Tech stack:** Existing TypeScript, React, TanStack Query, Express, PostgreSQL, protected Vitest/Playwright and local Git worktrees. No new package, schema or runtime-profile change is included.

## Authority and observed starting point

On28 October2026 the owner explicitly requested this four-agent arrangement, a written plan, and then implementation. Astra High coordinates and performs final code reviews. Sol Extra High implements and performs the separate preliminary review. This amendment permits concurrent server/client construction under the already settled contract; it does not relax their acceptance or dependency gates.

Canonical branch `codex/capital-completion-v2` is at `4e90bfab0f86947a0df8edfb75c77089eb4bdc80` before this documentation commit. The previous verification-link slice remains accepted locally. Current canonical changes are the preserved v2.4 effort amendment, design and implementation documents; they are not application changes. No worker remained active at the status refresh.

Server author checkout `C:\Users\USER\.codex\worktrees\capital-r04-foundation\personal-finance-app`, branch `codex/capital-r02-session-gate`, has preserved uncommitted edits to `server/auth.ts`, `server/middleware/householdGuard.ts` and two new regression files. The October15 red logs report27failed/14passed unit tests and1failed/12skipped mounted tests. There is no green candidate, bootstrap implementation or final code review yet. Re-read and reuse this work; do not reset it or claim the old failures represent today's full implementation.

The clean, inactive attached identity checkout `C:\Users\USER\.codex\worktrees\capital-r01-identity\personal-finance-app` is reused on new `codex/capital-r02-client-session` from canonical application baseline `4e90bfa`. Its existing identity branch and commits are preserved; cleanliness was checked before switching. Both authors read the current saved canonical planning documents by absolute path while this documentation commit is prepared. No implementation occurs in the primary `C:\Dev\personal-finance-app` checkout.

## Four active roles

| Slot | Model/effort | Responsibility | Write ownership |
|---|---|---|---|
| Coordinator/final reviewer | Astra High | Settle contracts, own queue and test slots, adjudicate findings, inspect final code and evidence, integrate accepted commits | Canonical plans/ledger, protected integration/browser acceptance and shared config only when explicitly needed |
| Server implementer | Sol Extra High | Complete Task1, preserve identity/security invariants, run focused red/green server tests | Server guard/status paths, shared DTO and related server tests listed below |
| Client implementer | Sol Extra High | Complete Task2 against the frozen shared DTO; test loading, personal/onboarding entry and cache/operation lifetimes | Client boundary/transport/UI/hooks/tests listed below |
| Independent reviewer | Sol Extra High | Review plan corrections, then frozen server/client candidates for general correctness, TypeScript, security and meaningful acceptance coverage | Read-only; findings and review reports returned to coordinator |

Use subagents inside this coordinating chat, at most four active agents total. Workers must not spawn additional agents. A worker finishes or yields before its slot is repurposed. Record actual tool-selected model and effort; do not silently substitute or mislabel a review as Astra. Astra's final assessment is separate from Sol's preliminary review and does not disappear when Sol reports no findings.

## Ownership and shared contract

**Server owns:** `server/auth.ts`; `server/middleware/auth.ts` if needed; `server/middleware/householdGuard.ts`; a small shared implicit-context resolver under `server/core/authz/`; only deterministic `findByUserId` ordering in `server/repositories/HouseholdRepository.ts`; `server/modules/auth/auth.routes.ts`; new `server/modules/auth/auth.status.ts`; new `shared/session-status.ts`; `server/routes/security.email.ts`; directly related guard/auth/R02 server tests; `docs/reviews/completion-v2-evidence/R02/SESSION-ACCESS-SERVER.md`.

**Client owns:** `client/src/App.tsx`; new session context/boundary/personal-onboarding components; `client/src/lib/session.ts`, public-route classification and operation-lifetime helpers; `client/src/lib/queryClient.ts`, `client/src/lib/api.ts` and CSRF plumbing only where required for dispatch fencing; `client/src/pages/Login/*`; touched `use-settings`, `useSecurity`, `useCategories`, household and notification hooks; `Layout`, `Dashboard`, settings layouts/sections; `StepUpProvider`; camera/push delayed preparation handlers; directly related client tests; `docs/reviews/completion-v2-evidence/R02/SESSION-ACCESS-CLIENT.md`. No broad unrelated UI/transport rewrite. Propose any additional path to the coordinator before editing.

**Parent retains:** master/companion/ledger, package/lock/runtime/config/CI/test setup, schema/migrations, broad suite scheduling and final browser fixtures/config. Any necessary ownership transfer is explicit in a message and ledger. Authors cannot silently rewrite each other's files or copy unrelated work.

Server publishes `shared/session-status.ts` early. Bootstrap is GET `/api/auth/session`, usual success envelope, with exactly the five design states and minimal subject/household fields. The client starts red acceptance tests and boundary scaffolding immediately from this documented contract; it must not invent a divergent DTO or endpoint. Parent transfers the exact server-authored shared file/commit to the client checkout once inspected, recording its source/hash. This is dependency material, not client-authored code. Compile/integrated acceptance waits for that dependency. Later contract changes require Astra adjudication and notification to both authors.

Both prior independent design findings are required: one deterministic implicit household resolver (with two-membership agreement test), and captured originating operation lifetimes before every protected send/retry including delayed camera/push preparation and stale step-up cancellation. Reviewer `r02_parallel_review` completed corrected-design read-back on28 October2026 and accepted with evidence limits, finding no remaining blocking design issue. This is design acceptance only; code review remains pending on frozen candidates.

## Execution sequence

**28 October pre-freeze correction:** The independent reviewer found an unintended-context dispatch race despite local cache fencing; Astra adopted the additional request-precondition contract in the design. Server additionally owns a small context-precondition helper/error and the narrow unverified-login error-code change in `auth.service.ts`. Client additionally owns bounded protected-fetch conversions in `hooks/use-reports.ts`, `use-report-widget-preferences.ts`, `useAttachments.ts`, `useReceipts.ts`, `components/weekly-recap/hooks/useWeeklyRecapData.ts`, `components/weekly-recap/WeeklyRecapHistory.tsx`, and `features/reports/hooks/useExportStatus.ts`. No unrelated rewrite is included. Both authors acknowledged matching optional UUID headers,400/409 codes and no replay. Earlier design acceptance is qualified by this correction; candidate review must include its implementation and regressions. Parent owns new `e2e/completion-r02.spec.ts` and its existing protected Playwright config inclusion for integrated entry acceptance; these also require independent review.

**Additional bounded transport ownership:** The client author also owns native protected download/media conversions in `features/reports/components/ExportHistory.tsx`, `features/investments/components/TaxReport.tsx`, `components/merchants/detail/useMerchantDetailState.ts`, `pages/CashFlow.tsx`, `pages/Reports.tsx`, `components/receipts/ReceiptDetailModal.tsx`, `components/receipts/ReceiptImagePanel.tsx`, `pages/Receipts.tsx`, `components/transactions/AttachmentsSection.tsx`, and `components/transactions/AttachmentPreviewModal.tsx`, plus a minimal lifetime-bound Blob URL helper and focused tests. Native cookie URL navigation cannot carry the intended-context headers. Preserve download names and preview behavior, suppress stale completions and revoke object URLs on replacement/unmount. The coordinator approved a narrow ignored dependency junction to the existing canonical pinned `@aws-sdk/client-s3` package; no package/lock modification or network installation is included.

**Explicit household composition:** Server may export `requireAuthForExplicitHousehold`, which preserves current verified-subject/header checks and defers the household expectation to the following `householdGuardWithId`. It must be paired with that guard before a handler. Ordinary `requireAuth` retains implicit household semantics, and existing headerless composition remains compatible. No production explicit-ID mount currently requires conversion. The regression must exercise an authorized explicit H2 while implicit selection is H1.

**Final request-context inventory:** Server ownership additionally includes only the repeated household-selection calls in `modules/household/{household,members,invitations}.controller.ts`, `modules/settings/settings.account.controller.ts`, `modules/notifications/notifications.controller.ts`, `modules/weekly-recap/weekly-recap.controller.ts`, `routes/investment-notifications.ts`, and `routes/import.ts`. Reuse the authoritative per-request household row/absence; retain capability, current-role and atomic repository checks. Import must additionally compare an expected household with its effective authorized explicit target. An authenticated-subject logout expectation must not pass the MFA-only cancellation branch after cookie replacement. These require interleaved selection/effect and MFA-cookie regressions.

**Frozen-client review repairs:** Candidate `dd01f65` is not accepted. Both reviewers identified delayed account-export downloads; general review additionally found household-free profile image rebootstrap loops, and TypeScript review found receipt prefetch/OCR result misattribution. Client may amend `hooks/useAccounts.ts` and its actual-hook regressions, propagate household-media availability through the existing personal profile controls, and bind receipt ownership before prefetch through OCR callbacks. Preserve stored profile/banner URLs during unrelated personal saves. Client also owns the five failed full-suite fixture files for Goals, Tags, CashFlowIntegration, CashFlowA11y and Dashboard, with explicit old/new coverage adjudication. No blanket mock bypass, dropped coverage, guard relaxation or runtime/config change is permitted. Re-review the new exact commit after focused/static checks.

Client ownership includes conditional protected `/uploads` loading in `components/layout/ProfileMenu.tsx`, profile picture/banner controls, and the central `components/ui/avatar.tsx` wrapper while preserving Radix props/ref/fallback behavior. Prefer the central wrapper over scattered owner/member avatar edits. `hooks/useTransactionReceipt.ts` and its worker-owning `hooks/useOcrProcessor.ts` may use the same protected Blob helper through delayed OCR preparation, with operation-specific worker and URL cleanup. The six goal-image consumers (`GoalDetailsSection`, `GoalListItem`, `GoalImagePicker`, `StepBudget`, `StepContribution`, `StepTargets`) and `MerchantAvatar` may receive only the conditional image wrapper/import conversion. Static, data and external image sources retain existing behavior and never receive auth context headers. Independent TypeScript review uses the fourth slot sequentially; it does not create a fifth concurrent worker.

1. **Coordinator setup:** save this plan and master amendment; verify both worktrees and preserve partial edits; create the client branch; dispatch exactly three Sol Extra High agents with these boundaries. Record readiness, actual agent identifiers and test-slot ownership.
2. **Parallel construction:** server refreshes the existing red tests and completes guards/bootstrap; client builds complete-App red tests and the boundary/transport implementation. The reviewer first reads the corrected design and plan, then prepares a risk/acceptance checklist without modifying author tests or pretending a work-in-progress diff is final.
3. **Contract handoff:** server publishes the DTO; parent inspects/copies exact dependency to client. No duplicate source ownership or invented shape. Review corrections go back to the relevant author, with concrete regression expectations.
4. **Candidate checks:** each author runs focused tests, nonincremental TypeScript and npm check under the coordinated slots. Freeze an explicit local commit only after required checks pass; report exact SHA, paths, commands, target/mode, failures, outcomes and limits. No blanket fixture verification, skipped failing cases, loosened guards or hidden test/profile changes to obtain green.
5. **Independent Sol review:** review each frozen candidate relative to its actual base, including general correctness, TypeScript/async safety, security and acceptance gaps. Findings carry path/line, scenario, impact and suggested verification. Authors fix findings in their own worktrees; the reviewer reads the new SHA and affected tests. A changed candidate invalidates acceptance for the changed portion.
6. **Astra final review:** personally inspect the final diff, shared contract agreement, regression evidence and Sol findings/dispositions. Check the pending-user allowlist, household-only router coverage, no identity promotion, membership selection, public-page query silence, stale-cache isolation and late-operation dispatch fencing. Record accept/request-changes with exact SHA; Sol approval alone never authorizes local integration.
7. **Sequential integration:** integrate server first, then client into canonical after final review; avoid importing the shared DTO twice. Resolve conflicts explicitly and re-review any changed implementation. Parent runs serial applicable full server/client suites, static/build/bundle and protected Golden browser acceptance, then performs a final integrated code/evidence check. Do not push, merge main or deploy.

## Test and resource coordination

Use the pinned local Node24.22.0 ARM64 runtime and the protected wrapper commands in the existing implementation plan. Reverify runtime/dependencies and disposable target before execution; October15 observations are not current runtime proof.

The server lane has the first exclusive focused database-test slot. Canonical identity manifest `.local/r01-integrated/target.json` identifies only `127.0.0.1:55432/pfa_completion_identity_r01int15a1_test`, run`r01int15a1`. There was no observed listener at55432 during the October28 preparation; parent must inspect/restart only the owned existing cluster if needed, then the wrapper must verify the marker. Do not fall back to shared5432, finance_app, unmarked DBs, schema push, provider calls or real mail.

Client may run focused unit tests while server runs focused DB tests. Nonincremental TypeScript/npm check, broad suites and browser runs each require the coordinator's execution slot to avoid unnecessary host contention. Reviewer tests require a slot too; read-only source review may run throughout. Client initial work does not depend on a live server. Existing logs remain historical; preserve and separately name new logs.

Each agent reports meaningful milestones or blockers, not unsupported percentages: contract published, red reproduction, green candidate, review findings, corrected candidate. Parent updates the user and ledger. Do not claim ongoing background activity if agents have stopped; tools/status evidence determines that claim.

## Definition of this checkpoint

Setup is complete when the plan is saved, three Sol Extra High agents have accepted disjoint assignments, and implementation has actually begun. Feature acceptance additionally requires both final code reviews and integrated checks above. Full R02/J01, real SMTP/CSRF/cookie/limiter acceptance, category seeding, other packets and external release remain separately open. All101 canonical groups remain OPEN until their full evidence criteria are met. No calendar or speedup multiplier is promised.

## Execution outcome — 28 October 2026

The four-agent construction/review sequence and final parent integration are
complete for this bounded checkpoint. Both author candidates and the narrow
server-fixture follow-up received separate general/security, TypeScript and Astra
source review. Canonical application candidate `4e105183c109fd473ecac48962a073e8c068fc47`
passed all 3,303 server tests, 1,497 client tests, nonincremental TypeScript, npm
check, production build, bundle budget and seven protected Chromium tests.
Failed earlier runs and their adjudication remain retained. The parent accepted
the local checkpoint; see
`docs/reviews/completion-v2-evidence/R02/SESSION-ACCESS-ACCEPTANCE.md` for exact
source, evidence and limits. All broader closure and release boundaries above
remain unchanged.
