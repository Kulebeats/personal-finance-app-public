# R02 session access and query boundary

**Goal:** Restrict unverified registration sessions to status and recovery, and prevent anonymous, pending and household-free entry from starting financial queries.
**Architecture:** Verification-required server guards, an explicit read-only session bootstrap, and client provider/cache lifetimes bounded by the current subject and membership.
**Tech stack:** Existing TypeScript/Express/PostgreSQL and React/TanStack Query/wouter. No dependency, schema or session-payload migration is proposed.

15 October2026. Parent Astra High decision under masterv2.4, following the owner's explicit acceptance of High effort. Source refreshed at canonical `4e90bfab0f86947a0df8edfb75c77089eb4bdc80`; prior link-repair source remains `1225d2d352e62c832e45c868661db9e470120913`. This settles the engineering contract for authorized local implementation. It does not report implementation, tests, independent review or packet closure. Read the master section2/R02, then `R02/SHARED-GATE-CHECKPOINT.md`, then this design and its implementation plan.

## Alternatives and decision

| Approach | Assessment |
|---|---|
| Add query `enabled` flags and patch individual financial routes | Too easy to miss a mounted provider, new query or household-only router. Does not establish cache isolation. Flags remain useful inside the selected boundary. |
| App-wide URL allowlist middleware and one existing global cache | A path gate is fragile across nested routers, files and service-authorized routes. Clearing a shared cache alone does not isolate late requests/callbacks or component state. |
| Verification-required guard families, explicit bootstrap, separate client lifetimes | Selected. It covers current entry guards without converting cron/public token operations to cookie authority; bootstrap communicates expected states without error cascades; detached data caches cannot be reused by another subject. |

The fresh mount trace found twelve routers using only `householdGuard`: accounts, transactions, budgets, goals, categories, merchants, tags, rules, reports, recurring, main investments and filter presets. Therefore changing `requireAuth` alone is insufficient. Goal images, transaction attachments, account imports and main-investments `analytics/fx-historical` are included. Protected `/uploads/*`, receipts, settings uploads, notifications/push, recap, AI and specialized investment routes already use shared auth, but still require mounted tests. The `/api/v1` comment is not proof of an alias: do not add an alias or broad exemption in this slice; verify it cannot bypass guards.

## Server authority

1. `requireAuth` and `requireAuthWithUser` share one authoritative session-user resolution and require `emailVerified === true`. `requireAuthWithUser` keeps its existing export for compatibility. `attachUser` is not authorization. Do not trust its cached user or a request/session verification flag instead of the current user row.
2. Introduce an explicitly named pending-aware session guard for the narrow routes below. It still validates session identity and current user, rejects a deleted/erased or generation-stale user and never promotes `mfaPendingUserId` to `userId`. Preserve guarded-store selected-SID revocation and delayed-save protection. Do not weaken R01 to accommodate tests.
3. Both household guards invoke the verified session-user check before resolving membership, parsing an explicit household ID, executing controllers, uploads or side effects. They remain safe when mounted without a preceding `requireAuth`. Existing role/capability/visibility checks remain independent and mandatory.
4. Unverified cookie-user denial is HTTP403 with structural code `EMAIL_VERIFICATION_REQUIRED` and generic action guidance. Anonymous/MFA-only access to ordinary cookie-user routes remains401. Genuine lookup failures remain5xx; they never become anonymous, no-household or permission success.
5. No new CSRF exemption, token lifetime/purpose, limiter quota, mandatory-MFA policy, financial authorization or session generation is introduced. Existing token consumers do not log in/switch their visitor. R06's unfinished mandatory-household-MFA acceptance is not claimed by recognizing R01 login challenges.

| Endpoint/action | Pending registration | Other authority |
|---|---|---|
| GET `/api/auth/session` (new bootstrap) | Restricted status | Anonymous/MFA states described below |
| GET `/api/auth/me` | Existing allowlisted own identity DTO | Remains401 for anonymous/MFA-only; no credential/private-profile additions |
| POST `/api/auth/logout` | Allowed | Preserve explicit MFA-pending cancellation and existing revocation service |
| POST `/api/settings/security/email/resend` | Allowed through pending-aware guard | Existing cookie/CSRF authorization and delivery-outcome semantics |
| Public verification, explicit-address resend, forgot/reset, login/register, MFA verify/resend | Existing operation-specific rules | Token/credential/challenge authority; do not grant household access |
| Security status/settings/profile/display, email change/cancel, session administration, uploads, notifications, AI, household create/join/invite and all finance | Denied | Verified users retain existing operation, membership, role and step-up rules |

Status for pending registrations is supplied by `/auth/session` and `/auth/me`; opening all Security Settings is unnecessary. A verified household-free user retains personal settings/security and create/accept-invite authority under existing rules. Household financial/administrative operations still require membership. Profile images are household-scoped and remain unavailable without membership. No invitation or erasure requirement is removed by this entry repair.

## Bootstrap contract

Add GET `/api/auth/session`, outside the credential-attempt limiter but under existing general API limiting. Respond with the usual `{ success: true, data: ... }` envelope and `Cache-Control: private, no-store`, `Vary: Cookie`. It creates no user defaults, financial rows, membership, challenge, token or authenticated session. Ordinary existing session-store housekeeping is not an authentication side effect.

`data` is a discriminated union, allowlisted and runtime-validated on the client:

| `state` | Additional fields | Meaning |
|---|---|---|
| `anonymous` | None | No current authenticated or valid pending-MFA identity |
| `mfa_pending` | None | Current R01 pending-MFA challenge session, no authenticated subject/household payload |
| `verification_pending` | `subject: { id, email, displayName }` | Current registration session, email not verified; `displayName` nullable |
| `verified_without_household` | Same `subject` | Verified identity, no membership-backed household |
| `ready` | Same `subject`; `household: { id, role }` | Verified identity and known current role in the household selected by existing request-context resolution |

Do not expose SID, SID hash, credential/security generation, MFA seed/code, token, private profile, household balances or member list. Do not rewrite existing auth/member DTOs merely to build this minimal status DTO. Pending status must not query household repositories. MFA-only state is checked against the current user/generation/erasure state; ambiguous simultaneous pending and authenticated identities fail closed. Session-store DB errors remain errors.

For a verified subject, use one shared implicit context resolver in bootstrap and `householdGuard`, with the same known-role validation. Make the existing membership-backed `HouseholdRepository.findByUserId` selection deterministic by ordering by the unique membership ID before its limit. Preserve `householdGuardWithId`'s explicit target membership semantics. A two-membership fixture must prove bootstrap and implicit protected requests agree while membership rows are unchanged. Missing household is an expected state; an inconsistent membership or unknown role is403, not onboarding. This does not add household selection UI/session state or resolve R03 cardinality/lifecycle races. Every protected request continues to check current membership independently; bootstrap is a UI snapshot, never a bearer authorization grant. Concurrent membership changes remain subject to revalidation; prior bootstrap cannot guarantee unchanged permission at dispatch.

## Client boundary and cache lifetime

One route classifier owns exact public routes: `/login`, `/verify-email`, `/auth/verify-email`, `/forgot-password`, `/reset-password`. Do not use arbitrary prefix matches as authority. Public pages use only local presentation providers and their own action cache. They never mount SettingsProvider, financial Layout, CommandPalette, ImportWizard, notifications or goal milestones. The legacy verification redirect and token one-shot/no-visitor-switch behavior remain intact. Visiting a verification link does not navigate automatically into the signed-in application.

Protected entry starts bootstrap before data providers or page hooks mount. Loading renders an accessible neutral loading state. Errors render a useful retry/sign-in/recovery choice, retain the actual failure and keep protected children unmounted. Anonymous entry navigates to login. MFA-pending entry offers the existing challenge flow/cancel path and never mounts authenticated providers. Verification-pending entry offers status refresh, signed-in resend, recovery and logout. Verification in another browser is discovered by explicit refresh or focus revalidation; the token page does not manufacture a session.

Verified household-free entry uses a small personal/onboarding shell, with create-household and existing invitation flow where implemented. It may mount personal profile/display/security sections; it must not mount household financial sections or ordinary Layout children which fetch accounts/members/notifications. A direct financial URL produces useful onboarding without a failed financial request. This repair must not remove existing personal settings access; incomplete invitation UI remains tracked in R03 rather than being invented here. Financial application providers mount only for `ready`.

Maintain separate bootstrap state and data QueryClient instances. Create a fresh data client and remount identity-sensitive component state when the subject, verification state, household or role changes, and after successful login/registration/MFA/session-changing actions. Use a local monotonically changing request epoch to ignore stale bootstrap completions. Cancel outgoing queries and detach/clear the old client; late results and mutation callbacks must not repopulate or invalidate the current client's cache. Existing query keys can remain local to their client instance, avoiding an unbounded key rewrite. QueryCache/MutationCache callbacks must close over their own client/boundary rather than the exported singleton. Keep a public client only for public action lifecycle; it must never receive financial data.

Pause/unmount protected content during identity-changing submissions before the new cookie can be used by old components. Successful transitions clear CSRF and refresh bootstrap. Failed transitions restore access only after fresh status; do not replay financial mutations. Logout or session expiry detaches protected state immediately. Password reset, email-change completion and revoke-current/all must follow the same invalidation contract if they affect the current session; retain the server's revocation semantics. A token belonging to somebody else cannot set the local subject.

Cache isolation is insufficient for writes: capture the originating data lifetime when a protected UI operation begins, and validate it immediately before every network send or retry. Preserve that capture through CSRF acquisition, `CSRF_INVALID` retry and step-up awaits. Invalidate pending operations on transition, cancel/settle stale step-up resolvers, and never send an old operation under a replacement lifetime. Cover asynchronous preparation before transport too: camera data-URL conversion and push permission/service-worker/subscription preparation can outlive their originating screen. Capturing only when `apiCall` starts is too late for those continuations. Cancelling client work is not a claim that an already-dispatched server mutation was rolled back.

Revalidate status on entry to the protected tree, protected-route changes, focus return, local auth/member transitions and structural auth/member denials. Deduplicate in-flight probes. Do not reuse stale protected content while a known identity/permission transition is unresolved. A detected identity/household/role change rotates the whole data lifetime. Use a same-origin cross-tab invalidation signal containing no subject/token/private data for locally observed auth changes; re-read server state on receipt. Cross-tab messages are hints, never authority. Remote role changes still require current server checks; this design makes no impossible promise to erase data already shown before revocation.

## Errors and expected states

### 28 October intended-context precondition amendment

Independent review found that a locally active operation can outlive another tab's cookie replacement before its asynchronous invalidation signal arrives. Likewise, removal of the selected membership can make an old form resolve a different implicit household. Current cookie authorization can succeed while the payload is applied to an unintended context. Parent Astra adjudicated this as a required bounded correction before code acceptance.

Each first-party protected operation captures immutable expected subject and, for a ready implicit-household lifetime, household ID. Send these as `X-Capital-Subject` and `X-Capital-Household`, preserving the capture through preparation, CSRF acquisition and retry, step-up and response handling. Apply them to protected API reads/exports too. Pending-subject actions carry subject only. Bootstrap, CSRF acquisition, public credential/token authority and local data-URL conversion do not acquire household authority from these headers.

The server treats headers as additional preconditions, never permission. A supplied header must contain exactly one UUID; malformed or duplicate values return generic400 `BAD_REQUEST`. Compare expected subject with the current session user, and supplied expected household with current resolved context before controller/effects. Mismatch returns409 `SESSION_CONTEXT_CHANGED` without reflecting values. Shared guards must also protect cookie-user routes using `requireAuth` without `householdGuard`; reuse only the context resolved by the current authoritative request check to avoid a second inconsistent selection. Explicit-ID guards compare against their explicit target/membership rather than redirecting to the implicit selection. Existing headerless callers retain normal authentication/verification/membership/capability/CSRF checks; headers never override those checks.

On mismatch, withdraw the client context and bootstrap anew, but never update expectations and replay the old payload. Require explicit resubmission. Tests must keep the old local lifetime active while changing ambient cookies or selected membership, use valid current credentials, and prove old-context reads/creates are rejected with unchanged persistence. Verify unchanged-context success, malformed/duplicate rejection, pending resend subject mismatch and CSRF-retry preservation. Cross-tab notification remains a useful early invalidation hint, not the correctness barrier. No SID, schema, session payload, policy quota or CSRF exemption is added.

The unverified-login response also adopts `EMAIL_VERIFICATION_REQUIRED` after successful password verification, so the public login UI can offer resend using structural code. Locked-account and invalid-credential behavior remain unchanged.

Use structural `status` and `code` in touched fetchers and common transport; preserve them for display/categories/members too. Parse error JSON separately from throwing it, so the current broad parse catch cannot swallow the constructed error. `apiRequest` and `apiCall` must distinguish `STEP_UP_REQUIRED`, real session expiry, `EMAIL_VERIFICATION_REQUIRED`, `HOUSEHOLD_NOT_FOUND` and genuine403/5xx. Do not classify by message substrings or suppress all403/404 errors. Step-up remains owned by its existing handler; ordinary forbidden operations remain visible. A state transition is handled once at the boundary, with protected content withdrawn, rather than one toast per query. Errors on public form submissions remain useful local form errors.

Bootstrap encodes expected anonymous/no-household states as successful data; it does not hide database/network failures. Household data keys currently duplicated as `household`/`householdGeneral` may be consolidated within the client slice or both invalidated, but creation/leave/accept must also refresh bootstrap and rotate context. Defer broad unrelated transport/key cleanup.

## Delivery and evidence boundaries

Under the owner's28 October2026 four-agent amendment, server guards/bootstrap and client boundary construction may proceed in parallel against this contract. Independently review both and obtain Astra's final code assessment; integrate server first and client second, test the complete App and delayed/warm caches, and run protected browser acceptance. The server slice can be accepted separately but does not establish useful pending-client UX. Category seeding remains a separately owned R02/R03 requirement; this guard slice does not close it.

No full suite is repeated solely for these documents. Changed code requires focused red/green tests, nonincremental TypeScript, npm check, independent general and TypeScript/security review, and applicable integrated regression/build/browser checks. Keep server tests serialized on the parent's marked disposable identity DB. Use actual registration cookies, captured mocked-transport token and a synthetic membership for the pending-member negative case. Do not blanket-verify fixtures, bypass guards or claim test-mode checks prove real CSRF, SMTP, secure cookies or production readiness. All101 groups remain OPEN until their complete acceptance criteria are met.

## Independent contract review and adjudication

Separate Sol Extra High architect `r02_contract_review` requested two corrections against the initial draft: detached caches did not fence delayed writes/retries, and existing unordered household selection could disagree with bootstrap even without row changes. Parent Astra High accepted both findings and incorporated the operation-lifetime fence, stale step-up cancellation, delayed camera/push tests, deterministic shared implicit resolver and two-membership acceptance above. The reviewer found no other blocker in the reviewed guard/DTO/public/household-free contract. Final corrected-document read-back was not completed before interruption. On28 October2026 independent Sol Extra High reviewer `r02_parallel_review` accepted the corrected design with evidence limits and no remaining blocking design finding. No code or runtime acceptance is implied; Astra's final code assessment remains required.
