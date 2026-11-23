# R02 client session boundary candidate — 28 October 2026

Client author lane: Sol Extra High, as selected by the parent four-agent execution.
Author checkout: `C:\Users\USER\.codex\worktrees\capital-r01-identity\personal-finance-app`.
Branch: `codex/capital-r02-client-session`; author baseline: `4e90bfab0f86947a0df8edfb75c77089eb4bdc80`.
The parent owns integration, independent review, Astra final assessment, broad suites and browser acceptance. This file records client evidence, not full R02/J01 completion or production readiness. All canonical groups remain OPEN under the parent ledger.

**Post-review revision:** the initial author candidate `dd01f65d703cf891f49bd1eb4201c9e09228b645` was not accepted. Independent review found three HIGH gaps described below. The original verification section is historical; repair verification must establish the changed source separately.

## Read this candidate in order

1. Canonical design/execution amendments in the parent `capital-completion-v2` checkout, then server-owned `shared/session-status.ts`.
2. `client/src/App.tsx`, `contexts/SessionContext.tsx`, `components/session/SessionBoundary.tsx`, `PersonalSessionShell.tsx`.
3. `lib/session.ts`, `operation-lifetime.ts`, `protected-fetch.ts`, `queryClient.ts`, `api.ts`, `csrf.ts`.
4. `lib/protected-media.ts`, `components/session/ProtectedImage.tsx`, central `components/ui/avatar.tsx`, delayed camera/push/OCR paths.
5. Complete-App tests and transport/media/operation tests listed below, then the touched existing regression tests.

## Dependency provenance and ownership

The parent inspected and transferred server-authored `shared/session-status.ts` unchanged. Its SHA256 is `A48A3CF7557B82B71C3EBB5D811670212B73EBCF34ACAFD2316458E5FE1F4BED`. It is dependency material, excluded from the client commit; server integration must precede client integration.

Only client source, related client tests and this evidence are authored here. Additional direct-fetch, native binary/media, central avatar, goal-image and OCR paths were explicitly granted by the parent during the intended-context amendment. No server/shared/package/config/schema/migration/ledger source was edited. The previous identity branch remains preserved. No merge, push or deployment was performed.

The author checkout lacked the already pinned `@aws-sdk/client-s3@3.1152.0`. Initial TypeScript/npm-check attempts failed with three missing-module diagnostics in existing server S3 code. With explicit parent approval, the author verified the canonical package version and created the ignored junction `node_modules/@aws-sdk/client-s3` to the canonical package. No network install or package/lock change was made.

## Implemented boundary

- Exact public routes bypass settings, financial layout, command/import providers and finance queries. Public action cache is separate from all protected data clients.
- Loading, failed bootstrap, anonymous, MFA pending, verification pending, verified household-free and ready states have distinct mounts. Malformed subject/household/role snapshots fail closed.
- Household-free entry retains existing personal profile/display/security sections and useful create-household entry without financial layout hooks. Creation refresh is owned once by the create form; existing callbacks remain compatible. Existing invitation feature scope remains R03.
- Status probes deduplicate in-flight work and ignore obsolete completions by epoch. Protected route/focus entry, local auth/member changes and payload-free same-origin cross-tab hints reread server authority.
- Subject, verification state, selected household or role changes retire the old client and remount component state. Unchanged revalidation preserves client/draft state. Old caches, optimistic callbacks and error handlers remain attached to their original client.
- Known auth submissions withdraw protected descendants before cookies can change. Their own action lifetime survives that intentional pause, while a later transition cancels the old action. A stale completion cannot invalidate the replacement. Failed MFA feedback survives refresh/remount.
- Pending resend reports the actual accepted/unknown/unavailable/not-required delivery outcome. It does not claim delivery from a bare 200.

## Operation and server-context preconditions

Every protected UI lifetime captures immutable subject expectations; ready lifetimes also capture the implicit household. `protectedFetch` sends `X-Capital-Subject` and `X-Capital-Household` from that original snapshot. These headers are preconditions, not authorization grants. Every server request remains responsible for checking current authority.

Local operation fences are checked before dispatch, after awaited CSRF/error-body/step-up work, and before retries. `SESSION_CONTEXT_CHANGED` withdraws protected content, rereads status and asks for explicit resubmission; no old financial payload is replayed. A delayed old 409 body cannot invalidate a replacement lifetime, and a delayed old 403 body cannot clear the replacement CSRF cache. Cookie-authorized logout retains its intended subject through the intentional pause. Credential/token flows keep their existing authority.

Camera conversion and push permission/service-worker/subscription preparation capture before their asynchronous preparation. Queued stale step-up promises settle on provider cleanup. React Query mutation options are rebound through every observer option update, including rerenders while `onMutate` is awaiting, so an old mutation cannot capture a replacement operation at dispatch.

Ordinary forbidden/server failures remain visible. Generic forbidden responses revalidate without repeatedly detaching an unchanged client. Structural expected session transitions withdraw once. Touched display/profile/member/category/security/notification fetchers preserve status/code/message.

## Protected transport inventory

All production direct protected `fetch` calls route through `protectedFetch`: common API/query transport, account exports, report/custom/widget/status reads, settings, members, categories, receipts, attachments, notifications, security, weekly recap and push VAPID reads. Remaining raw fetch calls are the helper's underlying fetch, bootstrap, CSRF acquisition and local camera data conversion.

Native protected downloads now fetch once into a guarded Blob URL: report pages/history/toast action, merchant export, tax export and transaction attachments. The original operation survives report-generation awaits and persistent toast callbacks. Server Content-Disposition filenames and explicit attachment filenames are preserved.

Protected receipt thumbnails/OCR images, attachment image/PDF previews, same-origin uploaded profile/banner/goal/custom merchant images and central Radix avatars use lifetime-bound Blob URLs. URLs are revoked on source change/unmount or failure; old body completions cannot create a new private URL. Conditional image wrappers preserve class/alt/ref/error handlers and defer lazy image fetch until intersection. External/static/data/blob sources retain native image behavior and receive no application expectation headers.

OCR input bytes are guarded before worker preparation. Workers have explicit operation ownership; stale results cannot invoke callbacks, and stale cleanup cannot terminate the current worker. Sequential idle-worker reuse still reports current progress. Worker creation after unmount is terminated; Blob URLs are revoked in finally.

Intentionally native sources: static country/bank/network/sidebar/logo assets, external Unsplash images, local camera data and receipt-upload previews. The author performed a final `fetch`, native API download/navigation, image/iframe and dynamic profile/goal source inventory. This is the inspected source surface, not a claim about arbitrary future transports or erasing data already displayed before revocation.

## Tests and checks

All commands use Node24.22.0 ARM64 first in PATH and the protected unit wrapper. No author DB, application server, browser, real mail/push provider or network was used.

Base command: `node scripts/run-protected-tests.mjs unit vitest run --config client/vitest.config.ts <selected-files> --maxWorkers=1`.
Logs are in the author `.local/r02-session-access/` with `client-oct28-*` names.

Observed red milestones:

- `client-oct28-red.log`: complete-App boundary 8 failed against the original unconditional providers.
- `client-oct28-preparation-red.log`: camera conversion, push permission and stale step-up settlement 3 failed; actual old protected sends were observed in the transport fixtures.
- `client-oct28-optimistic-red.log`: deferred optimistic mutation 1 failed/7 passed.
- `client-oct28-fetchers-red.log`: structural failure preservation 8 failed.
- `client-oct28-pending-red.log`: pending delivery/resend/MFA and overlapping credential action 6 failed.
- `client-oct28-preconditions-red.log`: immutable context headers 5 failed before header dispatch was wired.
- `client-oct28-delayed409-red.log` and `client-oct28-delayed403-red.log`: each 1 failed, proving replacement-lifetime invalidation/cache clearing.
- `client-oct28-ocr-red.log`: worker ownership/late initialization 2 failed; `client-oct28-ocr-reuse-red.log`: reused-worker progress 1 failed/2 passed.
- `client-oct28-read-structure-red.log`: six converted read hooks lost status/boundary authority; repaired reads retain structural 401/403/404 before consuming their successful envelope.
- `client-oct28-media-auth-red.log`: downloads outside QueryCache failed to withdraw for three structural auth/member failures. The common transport now handles these for context-bound operations; public credential failures, step-up and ordinary denials retain their existing handling. A retired-query test proves one withdrawal rather than duplicate cache invalidation.

New tests exercise actual App/providers/fetchers. The lifecycle suite replaces only the financial leaf with a probe; its App, boundary, cache, settings/command providers and transport remain real. Legacy verification routing, one-shot token and StrictMode tests remain selected. Transport fixtures simulate ambient cookie/context replacement with no cross-tab notification and prove immutable outgoing headers/no replay. Actual server-side rejection belongs to the separately authored server suite and parent integration evidence.

The final curated selection includes the four App/preparation files; operation/status/context/media/query/step-up tests; structural/mutation/OCR hook tests; existing auth/security/settings/household/notification/receipt/attachment/widget/weekly-recap tests; legacy verification tests; and report-export/history/cashflow regressions. It is a scoped selection, not the complete client suite.

Historical green run before the context amendment: 18files/151tests. The first expanded final selection recorded 230passed/2failed of232; both were inspected fixture expectations: public readiness assumed heading/form despite CardTitle rendering a div, and cashflow expected a native redirect instead of guarded binary download. The readiness test now waits for exact existing page copy; the cashflow test supplies a real binary response and asserts Blob filename/download behavior. No provider or lifetime guard was mocked away to repair them.

## Initial author verification and freeze — dd01f65

- Before the last common-transport structural-denial correction, the expanded selection passed **33files/238tests** (`client-oct28-freeze-focused.log`). Its nonincremental TypeScript and npm check also passed. These are prior-source results, not borrowed final-head clearance.
- On the initial candidate production source, all **19 affected files/121 tests passed**, zero failures, protected wrapper exit0 (`client-oct28-frozen-final-affected.log`). The exact selected file list is saved as `client-oct28-frozen-final-affected-files.txt`. This did not cover the three later review gaps.
- Final nonincremental `node node_modules/typescript/bin/tsc --incremental false` exited0 (`client-oct28-frozen-final-tsc.log`).
- Final `npm run check` exited0 (`client-oct28-frozen-final-npmcheck.log`): runtime, TypeScript, storage import, LOC, Node tool syntax, module metadata/status and W9/W10 worksheet checks passed. No baseline/config adjustment was made. Profile initials were extracted without behavior change; the actual camera/profile component regression checks the existing TP initials fallback.
- `git diff --check` passed. The dependency DTO hash remains unchanged. The commit contains explicit client/evidence paths and excludes the untracked shared DTO.

The personal-shell failed-logout regression passes with visible error feedback and a fresh lookup of the surviving session. Binary tests preserve server filenames, original subject/household headers, lazy loading and refs; late bodies cannot create/download private Blob URLs after replacement. Static/external/data sources do not use the authenticated fetch helper.

Independent Sol review, Astra final review, integrated full suites/build/browser acceptance and R02 closure remain parent-owned. No complete client suite, browser/server runtime, SMTP or production CSRF/cookie claim is made by this author packet.

## Independent review repairs after dd01f65

The parent completed the first full client run against the integrated initial candidate: **182 files, 5 failed/177 passed; 1482 tests, 23 failed/1459 passed; exit1**, 358.76s. Its log is retained as `client-oct28-parent-full.log`. That run is failed evidence, not clearance for the repaired candidate.

1. **Household-free personal images:** a persisted `/uploads` picture/banner hit a household guard, then structural withdrawal remounted the same personal profile and repeated the request. The personal profile now reads the boundary's household availability, renders initials/banner fallback for protected images, and omits household upload/delete/camera controls. External/static images remain visible. Personal fields remain editable; the actual App test saves a changed first name while retaining both stored image URLs. No global 404 or structural-denial suppression was introduced.
2. **Account export Blob continuation:** account APIs returned a delayed Blob without checking their originating lifetime, and account hook continuations created/clicked anchors afterward. Each API captures its operation and checks it around Blob conversion; each actual hook checks after its API await, then uses the shared guarded Blob download. Existing three filenames and returned Blob identity are preserved; export errors retain status/code/message.
3. **Receipt purpose before prefetch:** an old receipt A image could finish fetching after B and become the latest OCR epoch; mutable receipt refs then stored A results on B. Receipt action identity, immutable receipt target and session operation are now captured before prefetch. Select/new upload/clear retires the previous action and cancels its worker ownership. Prefetch and OCR continuations validate the same action and bind successful storage/autofill to its captured receipt. Obsolete matching completion cannot clear a newer receipt.

Fresh regression evidence:

- `client-oct28-review-high12-red.log`: actual App plus actual account hooks **7 failed/3 passed**. The existing-current export successes passed while private asset and delayed-export cases failed.
- `client-oct28-review-high12-green.log`: the same **10/10 passed** after repair.
- `client-oct28-review-high3-red.log`: **3/3 failed** with actual prefetch, OCR hook, receipt hooks, query client and fetchers. The log includes A's raw OCR text being written to B's endpoint.
- `client-oct28-review-high3-green.log`: all **6/6 passed**, including the three existing OCR lifetime/worker-reuse regressions.
- `client-oct28-review-transport-green.log`: **6 files/46 tests passed**, including the household-free actual App, existing account hooks, CSRF/204/step-up API and protected-media checks.

The five assigned full-suite fixture files were inspected. Goal/tag mutation fixtures had supplied goal/tag envelopes to `/api/csrf-token`; they now provide a valid token through a separate endpoint delegate while retaining real transport and all mutation/cache assertions. Error fixtures use status-bearing Responses. Cashflow integration/keyboard tests now provide genuine binary download responses and assert downloaded filenames/clicks after real export generation. Dashboard leaf tests no longer own onboarding; equivalent root/direct-financial and error-prose coverage runs through the actual App/providers/fetchers.

One focused CashFlowIntegration run recorded a **5s timeout in an unrelated forecast-persistence case**, while its formerly failing export assertions passed (58/59 tests across four fixture files). Concurrent workload was present; the precise cause is unproven. The failure log is retained. No global test timeout/config change was made. Separately, the new actual-profile readiness wait was changed from 1s to 5s after a run observed only its lazy Suspense fallback; all stable-bootstrap/no-assets/save assertions were retained and then passed.

After the parent released the resource slot, the unchanged CashFlowIntegration file passed **9/9 tests**, exit0 (`client-oct28-review-cashflow-serial-retry.log`). The earlier timeout remains observed evidence with an unproven cause.

Final repair verification:

- The affected selection passed **30 files/226 tests**, zero failures, protected-wrapper exit0 (`client-oct28-review-final-affected.log`, exact selection in `client-oct28-review-final-affected-files.txt`).
- The first fresh TypeScript run found one test-fixture TS2554: the cashflow download spy declared no parameters while its invocation/assertion used fetch input/init. The log is retained (`client-oct28-review-final-tsc.log`). Adding those parameter types changed no assertions or production behavior; the same file then passed **10/10 tests**, exit0 (`client-oct28-review-a11y-typed-green.log`).
- Fresh nonincremental `node node_modules/typescript/bin/tsc --incremental false` exited0 (`client-oct28-review-final-tsc2.log`).
- Sequential `npm run check` exited0 (`client-oct28-review-final-npmcheck.log`): runtime, TypeScript, storage-import, LOC, Node-tool syntax, module metadata/status and W9/W10 checks passed. No baseline or configuration changes were made.
- `git diff --check` passed; the transferred DTO retains its documented SHA256 and is excluded from the explicit client/evidence repair commit.

This repair candidate remains subject to frozen independent general/typed review, Astra final review and parent-owned integrated full-client verification. No new full client suite, DB, server or provider execution was run by this author lane.
