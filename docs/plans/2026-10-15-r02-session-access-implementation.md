# R02 session access implementation plan

**Goal:** Implement the settled [session access design](2026-10-15-r02-session-access-design.md) without weakening R01 identity, R04 capability or test-target controls.
**Architecture:** Verification at both shared auth and household guard entry; read-only typed bootstrap; client mount/cache boundaries driven by fresh status.
**Tech stack:** Existing TypeScript, Express, Drizzle/PostgreSQL, React, TanStack Query, wouter, Vitest and protected Playwright.

For execution, apply the executing-plans skill within the already authorized campaign. Parent Astra High owns this contract, canonical documentation and integration; Sol workers own only explicitly assigned files. Independent reviewers are separate from authors. This plan is not completed-work evidence. No new package/schema/CSRF policy is authorized by it.

**28 October2026 execution amendment:** The owner approved [four-agent parallel execution](2026-10-28-r02-four-agent-execution.md): Astra High orchestrates and performs final code review; two Sol Extra High authors build server/client in parallel; a separate Sol Extra High reviewer checks both. Task1 and Task2 construction may overlap under the frozen contract. Their integration remains sequential, with final Astra approval and the same acceptance requirements. That dated plan assigns the concrete paths and resource slots.

## Task 1: Guard and bootstrap server slice

**Own:** `server/auth.ts`, `server/middleware/auth.ts` if reexport needed, `server/middleware/householdGuard.ts`, new shared implicit-context helper under `server/core/authz/`, the narrow `server/repositories/HouseholdRepository.ts` deterministic `findByUserId` ordering edit, `server/modules/auth/auth.routes.ts`, new `server/modules/auth/auth.status.ts`, new `shared/session-status.ts`, `server/routes/security.email.ts`, directly related tests and slice evidence. Other route edits require a concrete discovered bypass and explicit parent file ownership. No package/config/DB/migration changes.

1. Add focused red tests for pending users through both auth variants and both household guards, including a caller with existing membership. Assert membership/controller next is never reached. Keep tests for anonymous, MFA-only, deleted/erased/generation-stale user, DB failure and verified success. Model valid current identity explicitly; do not relax the auth implementation for old mocks.
2. Add a real-mounted R02 integration suite, extending existing actual-registration/mail harness where possible. Verify pending status, `/me`, resend and logout work. Deny create/join, every household-only router family, personal settings/security writes, uploads and external-effect entry before persistence/files/provider side effects. Include `/api/investments/analytics/fx-historical`, goal images and transaction attachments. Assert denied payloads with a synthetic pending membership and unchanged table/file state. A syntactically valid target/method must hit its guard rather than an irrelevant404.
3. Implement one current-user resolver, verified default guards and the explicit pending guard. Preserve current session-store revocation and token-purpose behavior. Invoke verified resolution inside both household guards. Move only signed-in resend before verified email-router gating. `/me` and logout use pending-aware resolution; MFA-only logout retains its branch.
4. Implement the shared discriminated DTO and GET `/auth/session`. Share implicit household resolution with the household guard and order the repository join by unique membership ID; test two unchanged memberships for agreement. Preserve explicit-ID guard semantics. Real-mounted tests assert exact keys for all five states, no-store headers, no household lookup for pending status, valid-role denial, no defaults/finance/session-promotion side effects and safe5xx on lookup error. Preserve `/me` compatibility; do not add private fields.
5. Run the focused wrapper commands below, nonincremental TypeScript and npm check. Document actual failures and repairs. Freeze a local author commit only after checks pass; obtain general plus TypeScript/security review on that SHA. Integrate accepted source into canonical locally, preserving existing worker branches.

## Task 2: Client bootstrap, routing and isolated data lifetime

**Proposed ownership:** `client/src/App.tsx`, new `client/src/contexts/SessionContext.tsx` and small session-boundary components, new `client/src/lib/session.ts` and public-route classifier, `client/src/lib/queryClient.ts`, touched transport/auth hooks, `client/src/pages/Login/*`, `client/src/components/Layout.tsx`, settings shell and household mutations, focused complete-App/cache tests. Parent assigns exact paths before parallel work. Shared DTO comes from Task1; no divergent copy.

1. Write failing complete-App transport tests with real providers/fetchers: public verification/login/recovery trigger no settings/household/financial calls; pending and bootstrap loading/error trigger none; household-free entry never starts accounts/categories/presets/notification/widget requests. Do not mock away the provider/guard being tested. Keep public legacy-link and StrictMode token tests.
2. Add typed status transport/controller with cancellation and a request epoch. No unknown DTO becomes ready. Implement neutral loading/retry, pending verification controls, existing MFA recovery/cancel, and personal/onboarding shell. Mount finance providers only for ready. Retain useful existing personal profile/display/security access without household dependencies.
3. Refactor QueryClient creation so callbacks act on that instance. Separate bootstrap/public/data lifetimes; detach data on transition before protected descendants can render under a new identity. Fence protected sends/retries against the originating operation lifetime, including CSRF and step-up awaits; cancel stale step-up promises. Capture the lifetime before camera/push asynchronous preparation as well as ordinary mutation start. Preserve current-lifetime `STEP_UP_REQUIRED` flow and actionable forbidden/server failures. Fix touched fetchers to preserve structural status/code; no global403/404 suppression.
4. Connect login/register/MFA/logout/password-reset/current-session revocation, verification refresh, household create/accept/leave and role changes to status refresh. Use payload-free cross-tab invalidation and focus/route revalidation; never replay financial mutations. Remove duplicate household-error onboarding authority from Dashboard once boundary owns it.
5. Exercise deferred responses and optimistic mutation callbacks from subjectA after subjectB or a new household mounts; old data, local form state and invalidation must not reach the new lifetime. Delay CSRF acquisition, CSRF-invalid retry, step-up completion, camera conversion and push preparation across the transition and assert no old protected request dispatches with the replacement lifetime. Check unchanged identity revalidation, no-household creation, membership removal/downgrade, background lookup failures, public form errors and current-lifetime step-up. Do not declare cross-identity runtime leakage reproduced without an actual test.
6. Run selected client/transport/auth/layout/settings tests and static checks; independent general and TypeScript/security review of frozen candidate. Resolve findings, then local integration. Source parity and exact model/effort provenance accompany the evidence.

## Task 3: Integrated local acceptance

1. Parent serially runs full server and client suites once after the integrated source is stable, plus npm check/build/bundle. Broad fixture failures must be inspected for their intended identity contract; authentic verified finance fixtures may explicitly declare verified users, but pending regression fixtures remain pending. No blanket fixture update or test bypass.
2. Extend protected browser journeys: public entry without error cascade; actual registration creates pending restriction; mocked-transport captured verification changes only token owner; status refresh leads to household onboarding; verified user creates household; established financial page works; session expiry/role removal withdraws protected content; delayed old-subject responses never render in new context.
3. Use the existing marked identity target for server tests and separate Golden target/owned5157 for browser tests. No parallel broad DB suites and no reused unknown server. Record exact revisions, commands, counts, model provenance and limitations. Shut down only owned browser server.
4. Record bounded acceptance separately from full R02/J01. Real SMTP/MIME, actual production CSRF/cookie/limiter and staging remain subject to the existing runtime/input gates. All101 canonical groups stay OPEN unless their entire acceptance is independently established.

## Commands and targets

Use Node24.22.0 ARM64 from `C:\Users\USER\AppData\Local\capital-r00-runtime\node-v24.22.0-win-arm64` first in PATH. Do not use the default Node22.

For database tests, set the canonical absolute `TEST_TARGET_MANIFEST` to `.local/r01-integrated/target.json`, `TEST_RUN_ID=r01int15a1`, and `TEST_DATABASE_URL=postgresql://pfa_campaign@127.0.0.1:55432/pfa_completion_identity_r01int15a1_test`. Verify the wrapper accepts this parent-owned target before test execution. Use no shared5432/finance_app target.

```
node scripts/run-protected-tests.mjs database vitest --server run routes/__tests__/completion-r02.session-access.realdb.integration.test.ts --maxWorkers=1 --reporter=verbose
node scripts/run-protected-tests.mjs unit vitest --server run <focused-server-unit-files> --maxWorkers=1 --reporter=verbose
node scripts/run-protected-tests.mjs unit vitest run --config client/vitest.config.ts <focused-client-files>
node node_modules/typescript/bin/tsc --incremental false
npm run check
```

Place logs under the author's `.local/r02-session-access/`; include red/green outcomes without cookies, raw mail tokens, credentials or private fields. The future client filenames are assigned when that task begins; the placeholders above are command patterns, not claimed executions. Parent alone schedules full suites and the existing protected Golden browser wrapper.
