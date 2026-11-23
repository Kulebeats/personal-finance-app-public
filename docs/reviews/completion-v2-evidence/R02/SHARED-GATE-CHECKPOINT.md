# R02 shared auth/query checkpoint preparation

15 October2026. Read-only source inventory at reviewed application
`46b83af230e12f2d2e184a3d66cfe97cde3823ce`, integrated as
`1225d2d352e62c832e45c868661db9e470120913`; source parity confirmed separately.
Client trace by delegated Sol High, server guard read-back by parent Sol Extra
High. No application/query/security policy is selected by this preparation.
Masterv2.3 requires the owner to switch the coordinating chat to Astra Extra High
before new shared architecture/security contracts. The next guard/bootstrap/
cache decisions fall within that checkpoint. Source leads below are not browser
timing, toast-count, unauthorized-data exposure or completed-journey evidence.

The preceding local link repair is now independently reviewed and regression-
checked: full client1396, server3169, existing protected Chromium3; static/build/
bundle pass. Exact source/targets, failed first server attempt and unchanged
successful rerun are in `CANONICAL-LINKS.md`; these results do not establish the
next shared gate. Read master sections2/R02 and its v2.3 staffing boundary,
then that evidence, then this inventory before choosing the next contract.
This preparation received no optional independent documentation follow-up:
the requested reviewer hit its usage limit before review. Treat it as sourced
leads for Astra's own refresh/adjudication, not an approved design.

## Settled requirements

Master R02/AH-04: a pending registration session may inspect status, verify,
resend, recover and log out; household/financial entry points must deny access.
R02/UX-01 requires useful anonymous and household-free next actions without
unrelated query-error cascades. Real CSRF/secure-cookie/limiter and SMTP/MIME
acceptance remain separately gated. Retain token-purpose isolation, no visitor
login/switch, pending-MFA separation and R01 credential-generation/revocation
invariants. A broad green test run does not close any of these requirements.

## Client source inventory

Pointers are repository-relative at the pinned source. Follow delegates before
editing; no complete App/browser reproduction has been performed for this map.

| Mounted chain | Existing predicate / concrete source gap |
|---|---|
| `App.tsx:128` -> `contexts/SettingsContext.tsx:30` -> `hooks/use-settings.ts:182` | Global SettingsProvider calls display settings without auth, verification, membership or route predicate. Fetcher drops HTTP status and throws only a message. Provider exposes defaults/loading without an error state. |
| `App.tsx:142` -> `components/CommandPalette.tsx:46` | Always-mounted palette calls accounts, categories and transaction filter presets even while its dialog is closed. No open/auth/verification/membership predicate. |
| `hooks/useAccounts.ts:45`, `hooks/useCategories.ts:71`, `features/transactions/hooks/useFilterPresets.ts:60` | Accounts/presets use status-preserving API helpers; categories drops status. Their server routes require household context. |
| `components/Layout.tsx:25` | Requests profile/accounts/members unconditionally. Only profile401 drives its local login redirect; no verification/membership render gate. |
| Layout -> TopBar/NotificationBell and GoalMilestoneModal; `hooks/useNotifications.ts:95` | Bell polls unread counts regardless of dropdown state; only the list is open-gated. Milestone modal independently queries unread notifications. |
| `pages/Dashboard.tsx:157` | Onboarding waits for structural missing-household404. While household loads, default enabled widgets mount; onboarding still includes Layout and its queries. |
| ImportWizard/StepUpProvider | Initial providers hold local state/handlers; import account/category queries are in later steps, and step-up submits after a challenged action. Do not infer an initial query merely from provider presence. |

All client pointers above are under `client/src/`.

## Identity, membership and server boundaries

- `server/modules/auth/auth.dto.ts:4` includes `emailVerified` in `/api/auth/me`.
  The client inventory found no production caller of that status endpoint.
  `useProfile()` instead reads settings/profile; its server DTO includes
  verification while the client `UserProfile` at `hooks/use-settings.ts:16`
  omits that field. A new status authority/bootstrap has not been chosen.
- Household/general has separate client keys `['household']` and
  `['householdGeneral']`; members have a separate request. Household repository
  resolution joins current membership (`server/repositories/HouseholdRepository.ts:45`).
  Verified household-free personal profile/display reads currently work;
  household lookup returns structural404. This describes source behavior rather
  than adjudicating every endpoint's future pending-state permission.
- Registration creates an unverified tracked session and the client navigates
  to `/`. Both `requireAuth` variants (`server/auth.ts:21`, `:79`) validate session
  and user existence without verification. `server/middleware/auth.ts` reexports
  that implementation; it is not a third independent guard. `attachUser` at
  `server/auth.ts:136` is optional attachment, not an access decision.
- Both household guards (`server/middleware/householdGuard.ts:37` and the
  explicit-ID variant) enforce current membership/role without a verification
  predicate. Household routes require auth; finance routes use these guards
  plus their capability checks. Blocking only household resolution does not
  by itself decide pending access to user-level settings/security endpoints.
- `/uploads/*` also uses requireAuth/householdGuard (`server/app.ts:236`), so
  an API-only prefix gate would not cover that protected file entry. Secret-
  authenticated cron/health/public static paths have separate authorities and
  must be inventoried without turning them into cookie-user operations.
- Public generic verification precedes requireAuth in
  `server/routes/security.email.ts:23`; signed-in change/resend/cancel follow
  its auth guard. `/api/auth/me` and logout currently use requireAuth, with an
  explicit pending-MFA cancellation branch for logout. A blanket guard change
  must not disable the master's allowed status/recovery paths or R01 MFA logout.
- Display GET can create missing defaults
  (`server/modules/settings/settings.controller.ts:176`); it is not a pure
  identity/status probe. Treat personal defaults separately from protected
  household/financial mutation and decide the allowed pending boundary explicitly.

## Error and cache source leads

`client/src/lib/queryClient.ts:20` recognizes selected public paths for401
redirect handling but does not prevent queries. Display/category fetchers lose
status, so their failures can enter generic loading-error toast handling;
household404s can also toast. No browser-visible cascade count is established.

Query keys generally lack subject/membership scope and default staleTime is
infinite. Login/registration/MFA clear CSRF without clearing query data; logout
controls reload the page. Household creation invalidates one household key while
other keys exist. This is a cache-isolation/transition risk requiring warm-cache
tests, not proof that a specific identity switch exposed another user's data.

## Existing tests and missing acceptance

- `pages/__tests__/Dashboard.test.tsx:153` tests structural onboarding and hook
  order but mocks Layout, hooks and widgets.
- Household hook/section tests exercise transport and structural404 handling.
- `lib/__tests__/queryClient.authExpiry.test.ts:68` injects401 failures; it does
  not run the actual status-losing display/category fetchers.
- New verification routing tests mount the real App Switch with real wouter/
  React Query, while bypassing App's global providers. They intentionally do
  not prove the full first-run query boundary.

The delegated trace found no existing complete-App test covering anonymous,
pending-verification and verified-household-free states together. Proposed
acceptance cases, still requiring a chosen contract: real providers and fetchers;
auth/membership loading and failure transitions; allowed pending recovery/status;
all denied API and protected file classes with unchanged persisted state; warm
caches across login/MFA/registration/logout and membership change; and genuine
server failures that remain visible after expected-state handling. Use the
current actual-registration test to obtain pending cookies; do not blanket-mark
fixtures verified or suppress errors merely to keep legacy suites green.

## Decisions reserved for Astra

1. Authoritative status/bootstrap shape and lifecycle, including verification,
   MFA challenge and household membership as distinct states.
2. Exact pending endpoint permission matrix and guard placement across both auth
   variants, household guards, user-level security/settings and protected files.
3. Verified household-free reads/navigation and mutation prerequisites.
4. Common public-route classification and structured expected-state/error handling.
5. Subject/membership cache isolation, invalidation and loading-transition policy.
6. Route mounting and hook predicates needed to enforce those contracts without
   losing explicit allowed recovery or concealing actual failures.

This artifact supplies reviewable preparation. It neither amends masterv2.3 nor
authorizes a new runtime profile, CSRF exemption, broad query suppression or
security-policy implementation. Current canonical-link repair has its own
independently reviewed scope and tests in `CANONICAL-LINKS.md`/`PUBLIC-UI.md`.
