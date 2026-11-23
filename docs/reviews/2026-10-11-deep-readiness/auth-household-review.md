# Authentication, household, settings, and exit assessment

Assessment date: 11 October 2026, Africa/Lusaka. Source baseline: `381e9439afabe7c6cf829cb1cbded91d36da44ee` (`main`). Completion scope: fully functional existing and advertised application behavior, with staging verification. The user's later instruction supersedes the earlier invited-pilot scope and 11 November deadline; no fixed delivery date or feature omissions are assumed.

This is the specialist source assessment with a read-only review of the coordinating assessor's local runtime evidence. Application code and configuration were not changed. No database tests, email sends, external security probes, or financial writes were executed by this reviewer. The exact runtime results reviewed are listed below; other source-confirmed behavior must not be presented as a completed browser or deployment test.

**Verdict: this area is not functionally complete or ready to release.** The main blockers are ineffective live-session revocation, a broken registration verification link, broken member/invitation integration, and profile fields that report success without being saved. There is substantial useful implementation, especially password reset, role checks, transaction-backed household creation, and account-erasure data handling. The remaining work includes implementation, not just deployment evidence. Completion requires self-service invitations, ownership transfer/leave, MFA management, full profile persistence, export/erasure, and the advertised collaboration controls. Operator assistance, disabled buttons, or hiding unfinished features do not satisfy the revised completion scope.

## Scope and coverage

The live mounts were checked in `server/routes.ts:112-121`, authentication in `server/auth.ts:22-66`, PostgreSQL session storage in `server/app.ts:144-163`, and client routes in `client/src/App.tsx:103-128`. `auth.routes.v1.ts` is not the live authentication router; it was not used as proof of live behavior.

| Surface / outcome | Implementation | Source evidence | Verification still required |
|---|---|---|---|
| Registration and first authenticated session | PARTIAL: user/default settings exist; email gate is inconsistent | `auth.service.ts:89-210`; Login `index.tsx:167-175` | Register from clean browser; inspect session and default rows; fail one dependent write and check rollback/recovery |
| Login, wrong password, lockout | PRESENT, with rate limits and password hashing | `auth.service.ts:237-329,405-459`; `auth.routes.ts:20`; `server/auth.ts:166-209` | Real server and cookie checks; bounded parallel failed-login attempts |
| Email verification and resend | PARTIAL: verification backend exists, generated registration URL is wrong | `auth.email.service.ts:27-54,87,120`; `App.tsx:124`; `useSecurity.ts:157-196` | Follow captured registration/resend links in fresh browser; expiry/replay/error states |
| Password recovery/reset | PRESENT: public UI, hashed expiring tokens, locked single-use transaction, both session stores revoked | `auth.routes.ts:32-37`; `auth.password-reset.service.ts:38,80-107,151-213`; `App.tsx:125-126` | Sandbox mail capture, expired/used token, parallel redemption, two-cookie revocation |
| Session regeneration and remember-me | PRESENT | `auth.session.service.ts:29-49,123-139` | Cookie rotation, 24-hour/30-day expiration, secure cookie on actual staging proxy |
| Logout | PRESENT for current session | `auth.session.service.ts:145-171` | Replay old cookie after logout; browser cache/user-switch handling |
| Session list and single/all-device revocation | PARTIAL / unsafe: tracking row deleted, live session not deleted | `security.sessions.ts:64-128` | Two real cookies before/after revoke; both DB stores |
| MFA login, resend, backup codes | PRESENT backend and login entry UI; consumption race remains | `auth.mfa.service.ts:40-191`; Login `useAuthHandlers.ts:119-164` | Sandbox email, pending-session limits, replay, concurrent redemption, provider outage |
| MFA enrollment, disable, recovery management | PARTIAL: authenticated APIs exist; no settings control calls them | `security.mfa.auth.ts:34-175`; SecuritySection `index.tsx:11-27` | Complete enrollment/recovery UI after implementation; mail-delivery proof |
| Mandatory MFA policy | PARTIAL / dormant: flag false, login ignores `required`, recommendation not rendered | `auth.mfa-policy.ts:35,96,108,123`; `auth.service.ts:310-326`; Login `useAuthHandlers.ts:58-84` | Approve policy semantics; complete usable enrollment/recovery and prove server enforcement of every approved requirement |
| Sensitive-action reauthentication | PRESENT: password or emailed-code path, separate TTLs | `requireStepUp.ts:24-28,61-97`; `security.mfa.stepup.ts:43-213` | Real CSRF-on browser expiry/retry/cancel flow for export/delete/password/session actions |
| Household creation and onboarding | PRESENT: atomic household/owner/tags; structured missing-household error | `household.controller.ts:58-108`; `HouseholdRepository.ts:90-131`; Dashboard `:70-76` | Fresh-user browser journey through first account/transaction |
| Household name/currency/fiscal-year settings | PRESENT with owner/admin gate | `household.controller.ts:112-174` | Owner/admin success, member/view-only denial, reload and read-back |
| Member list, role change, removal | PARTIAL: server gates exist; response shape and role options disagree with UI | `members.controller.ts:31-206`; `HouseholdRepository.ts:163-177`; MemberList `:198-252` | Correct person displayed, allowed role mutation, immediate denied access after removal |
| Invitation issuance, acceptance, resend/cancel | PARTIAL: API lifecycle exists; no client acceptance route; recipient/race gaps | `household.routes.ts:25-33`; `invitations.controller.ts:105-322`; `HouseholdRepository.ts:553-605` | Real rendered email-to-accept journey, correct recipient, two-household concurrency, expiry/reuse |
| Ownership transfer and leaving | PRESENT backend, MISSING discoverable client controls | `members.controller.ts:215-339`; `household.routes.ts:32-33`; no client callers found | Complete self-service controls; transfer->leave->old household denial |
| Profile personal/contact/financial form | PARTIAL: numerous offered fields stripped by server schema | `useProfileForm.ts:261-275`; `settings.validation.ts:3-12`; `settings.controller.ts:134-167` | Field-by-field UI save->DB->reload reconciliation |
| Profile picture/banner | PRESENT upload/clear operations, scoped files, transactional row/audit writes | `settings.routes.ts:42-72`; `settings.picture.controller.ts`; `settings.banner.controller.ts` | Browser upload/change/delete, rejected type/size, rollback cleanup, cross-user/household access |
| Display settings | PRESENT validated persisted API and hooks | `settings.validation.ts:48-84`; `settings.controller.ts:183-245`; `use-settings.ts:184-203` | Each visible option persists and affects actual formatting across modules |
| Notification preferences | PRESENT persisted API and hooks | `settings.controller.ts:44-114,413-423`; `use-settings.ts:311-366` | Preferences actually control delivery; failures versus disabled-provider states (coordinator's notification scope) |
| Shared household preferences | PARTIAL: authenticated member guard without role restriction | `settings.routes.ts:113-118`; `settings.controller.ts:364-396` | Viewer/member direct API denial for household-wide writes |
| Full user-data export | PARTIAL / false success: live route returns synthetic ID only | `settings.routes.ts:98-102`; `settings.account.controller.ts:92-103` | Complete self-service bounded export generation, authorized download and truthful job/error states |
| User-account erasure | PARTIAL: substantial atomic data handling, no-household rejection, missing global session invalidation, no client UI | `settings.account.controller.ts:31-88`; `settings.account-deletion.service.ts:312-381,482-611` | Household-free user, sole/shared household, private-data semantics, credentials/files/backups/support workflow |
| Shared views and membership status | PARTIAL / advertised placeholders: configuration button has no action and Premium/Active status is hardcoded | MembersSection `index.tsx:92-138` | Approve entitlement/visibility semantics; implement working configuration and truthful persisted status |
| Privacy notice and user support | PARTIAL documentation; not a verified user-facing workflow | `docs/compliance/data-privacy.md:46-71` | Real contact, approved retention/erasure statement, actual data-request handling |

“PRESENT” means reachable implementation was traced, not certified correct across all inputs. Financial-domain account privacy and report/AI leakage need the coordinating financial/security assessment in addition to this shared-boundary review.

## Reviewed current runtime evidence

The coordinator executed `.local/readiness-2026-10-11/runtime-probes.mjs` and captured `.local/readiness-2026-10-11/runtime-probes.json`. Both were inspected read-only; this reviewer did not rerun them. The harness asserts a localhost SQL connection and the exact database `finance_app_audit_20261011_browser_test`, uses only synthetic actors, and makes HTTP requests to the separately launched local server at `127.0.0.1:5000`.

| Evidence record(s) | Observed result | Finding / limit |
|---|---|---|
| `unverified_registration_session`, `household_create` | Stored email verification false; same cookie `/auth/me` 200 and household creation 201 | AH-04 reproduced, including a persisted household/membership lookup |
| `member_ui_endpoint` | 404, `Cannot POST /api/household/members` | AH-05 caller/router failure reproduced |
| `profile_save`, `profile_readback` | Both 200; control `bio` saved; gender, annualIncome and phoneNumberMobile stayed null | AH-07 reproduced through write and a subsequent repository-backed API read; no separate direct SQL profile read in this harness |
| `profile_save`, `profile_readback` | Profile body contains non-null `emailVerificationToken` hash and verification expiry; MFA credential keys are present but null for this fixture | AH-02 verification-hash disclosure reproduced; non-null MFA/backup hash disclosure remains source-confirmed, not exercised |
| `second_login`, `session_tracking`, `step_up`, `revoke_second_session`, `revoked_cookie_still_authorized` | Login B 200; tracking count 1->2 with a new UUID; reauthentication 200; deleting that UUID 200; unchanged B cookie still `/auth/me` 200 | AH-01 single-device revocation failure reproduced. Bulk revoke and erasure variants remain source-confirmed, not executed by this harness |
| `member_direct_private_read`, `outsider_goal_read`, `viewer_transaction_write` | Same-household private transaction direct read 404; other-household goal read 404; view-only transaction write 403 | Positive controls, limited to these endpoints/fixtures |
| `member_goal_private_read`, `viewer_goal_private_read` | Goal relationship endpoint returns private-account transaction fields to same-household member and viewer | Additional runtime privacy finding belongs in the financial/goal review; direct-read protection does not prove relationship-read protection |

**Evidence boundaries:** the script marks the server environment as `NODE_ENV=test`; CSRF is bypassed in that mode. It directly seeds membership and sets the owner verified after the registration probe, so it does not prove email delivery/verification or invitation enrollment. The SQL target assertion does not itself identify the HTTP server's database before the first HTTP mutation; scope safety depends on the coordinator's separate verified server-launch evidence. The fixed fixture names make this a one-run probe, not a rerunnable regression suite. Raw local evidence contains synthetic profile/authentication material; share the redacted findings rather than copying those values into reports. The stored verification token is a SHA-256 hash and **does not by itself allow raw-token redemption**, because the live verification APIs hash the incoming raw token again.

The coordinator also reported a manual browser path through registration, the Create My Household onboarding control, ZMW household creation, an opening-balance account and a manual expense. That is useful journey evidence, but exact screenshot/read-back references belong in the central register. They observed repeated missing-household error toasts around first-run onboarding; add the acceptance criterion that expected onboarding absence produces one clear setup state rather than a cascade of error notifications.

## Findings

### AH-01 — CRITICAL / P0: revocation does not invalidate live cookies

**Confidence: high (source-confirmed).** The application authenticates from connect-pg-simple's `session` table (`server/app.ts:145-151`). Single-device and all-other-device revocation delete only `userSessions` tracking rows (`server/routes/security.sessions.ts:64-86,103-128`). `requireAuth` only verifies the session user ID and existence of the user (`server/auth.ts:22-58`); it never checks the tracking row. The route therefore reports “Session revoked” while the removed device's cookie remains authorized.

Account erasure has the same live-session gap: `anonymiseUser` deletes `userSessions` and retains an anonymized user row (`settings.account-deletion.service.ts:319,340-380`); the controller destroys only the current request session (`settings.account.controller.ts:72`). Another existing cookie still resolves to a user and passes `requireAuth`, even though household access may now fail. It can still call user-level endpoints. This is not equivalent to continued access to the deleted household's financial rows, and no such broader claim is made here.

**Reproduce safely:** sign the same synthetic user into browser/cookie jars A and B. In A, `GET /api/settings/security/sessions`, reauthenticate at `POST /api/settings/security/step-up` with `{password}`, then `DELETE /api/settings/security/sessions/<B tracking UUID>`. Replay B at `GET /api/auth/me`. Repeat with bulk `DELETE /api/settings/security/sessions`, and with erasure on another disposable user. Expected after revocation: 401; source predicts 200.

**Fix / acceptance:** use the existing transaction-aware `server/services/session-revocation.ts:40-71` approach for both stores, with a scoped single-session variant. A selected tracking ID must first be resolved under the current user to its session token; never accept an arbitrary SID. Bulk preserves only the intended current device; erasure preserves none and invalidates pending authentication/recovery material. Given two real cookies, deleting B makes B's next protected request fail while A works; bulk and erasure have the corresponding behavior. An injected revocation failure must roll back a destructive account operation. Include a request racing revocation so a late session save cannot resurrect access.

### AH-02 — HIGH / P1: ordinary user/profile responses expose authentication material

**Confidence: high.** `UserRepository.findById` selects the full user row (`server/repositories/UserRepository.ts:44-51`). Registration/login/MFA completion/current-user responses remove only `passwordHash` (`auth.service.ts:209,323,384,485`). Profile read/update do the same (`settings.controller.ts:127,166`), as does picture-upload/delete `toClientProfile` (`settings.picture.controller.ts:137-140,242,304`). The remaining schema includes `emailVerificationToken`, `mfaCode`, and `mfaBackupCodes` (`shared/schema.ts:265,320-323`). These are hashes, not cleartext codes; they are still unnecessary authentication material exposed to every consumer of normal profile/auth responses. MFA completion returns the pre-consumption `user` object as well.

**Reproduce:** seed a synthetic user with sentinel hashed verification/MFA/backup values, call `/api/auth/me` and `/api/settings/profile`, and inspect keys only. Do not put real hashes in an assessment artifact.

**Fix / acceptance:** define explicit allowlisted auth/profile DTOs; apply them consistently to login, register, MFA completion, profile read/update, and upload responses. Given any populated credential/token fields, all public response bodies omit them. Test the real HTTP serializer, not just a TypeScript interface. Password/verification/MFA handling should read private fields only in server code.

### AH-03 — HIGH / P1: registration verification emails open an unregistered route

**Confidence: high.** Initial and public resend emails generate `${APP_URL}/auth/verify-email?token=...` (`auth.email.service.ts:87,120`). The client registers only `/verify-email` (`client/src/App.tsx:124`); no `/auth/verify-email` alias or alternate handler was found. The settings email-change sender uses `/verify-email`, which explains why a narrow test of that path would miss the registration problem. Login later blocks unverified users (`auth.service.ts:278-282`).

**Reproduce:** capture a synthetic registration email in a local sandbox, follow its exact URL in a fresh browser, and observe the not-found route. Also exercise public resend from the login page, not only authenticated settings resend.

**Fix / acceptance:** one canonical verification URL builder and page flow; retain a safe alias if already-issued links must work. Given a captured registration email, following it marks exactly that email verified and leads to login/onboarding; expired/replayed tokens show a useful error and safe resend option. The current VerifyEmail error UI calls authenticated `/settings/security/email/resend` (`useSecurity.ts:187-196`), so a fresh unauthenticated browser also needs a usable resend path. Test actual mail link->router->API->row->subsequent login.

### AH-04 — HIGH / P1: registration grants full access before verification

**Confidence: high.** Registration writes `emailVerified:false` then sets `req.session.userId` (`auth.service.ts:141,160`); the UI navigates directly to `/` (`Login/index.tsx:174`). `requireAuth` checks existence only (`server/auth.ts:22-58`). The newly registered browser can create a household and use protected APIs, whereas a later login for the same unverified account is denied. This contradicts both the active login rule and the earlier “email verification enforced” readiness claim.

**Reproduce:** register a synthetic address without redeeming its email link; keep that cookie and POST a household creation. Then logout and try to login. The two entry paths apply different trust requirements.

**Fix / acceptance:** define a pending-registration state with only verification/resend/logout/recovery access, or formally choose a different explicit policy and implement it consistently. Proposed completion contract: verified email before household/financial access, consistent with the current login rule. Given an unverified registration cookie, all financial and membership endpoints deny access with a structured verification-required result, while verification and recovery remain usable. After verification the transition to authorized access is deliberate and tested. Make registration's user/settings/preference writes atomic or recoverable so an initialization failure does not strand an unusable account. The policy proposal is not an already-approved product decision.

### AH-05 — HIGH / P1: household collaboration is disconnected at several live boundaries

**Confidence: high.** These defects share one user journey and should be fixed as one integration packet:

- Add Member calls `POST /api/household/members` with `emailOrUsername` (`client/src/hooks/use-settings.ts:696-703`). The live router has only GET members, PUT member role, DELETE member, and `POST /invite` (`household.routes.ts:20-29`). There is no matching POST members route.
- Invitation issuance returns `/invite/<code>` (`invitations.controller.ts:174,221`) but `App.tsx:103-128` has no invitation route, and no client `invite/accept` caller was found.
- The API returns flat `name` and `email` fields (`HouseholdRepository.ts:163-177`), while `HouseholdMember` and MemberList read nested `member.user` (`use-settings.ts:555-582`; `MemberList.tsx:198-227`). Identity renders as “Unknown User,” undermining safe role/removal decisions.
- The UI offers `professional` (`AddMemberDialog.tsx:116-123`; `MemberList.tsx:280-285`), but supported server roles are owner/admin/member/view_only (`members.controller.ts:26`; `invitations.controller.ts:36`).
- Transfer ownership and leave endpoints exist (`household.routes.ts:32-33`) but no live client callers were found.

**Reproduce:** as a synthetic owner, open Members, check rendered names, submit Add Member, inspect the request/response, and open a seeded invitation URL. Try the offered Professional role. Current unit tests mock the hook and assert this unsupported role exists (`AddMemberDialog.test.tsx:7-14,44-71`), so their passing does not establish integration.

**Fix / acceptance:** make invitations the explicit client contract; share a member DTO and a consistent role contract; provide self-service pending invites with resend/cancel and accurate delivery state. Preserve the invite across login/register/verification without creating an unwanted default household first. Given a new invitee, the exact emailed link leads through verified authentication to explicit acceptance, creates one membership, renders the correct identity, and grants only the selected role. Existing-household conflict, wrong-account, expired/reused/cancelled invite, role denial, discoverable owner-transfer and leave paths need browser/DB proof. Removal must deny that member's next household API request. Because Professional is already offered, full completion includes an explicitly approved Professional permission matrix, shared schema/storage/API/UI support, and allow/deny tests; omitting it is not an authorized completion shortcut. Its intended powers remain a product decision, not an assumption that it should inherit administrator access.

### AH-06 — HIGH / P1: invite acceptance lacks recipient binding and cross-household serialization

**Confidence: high for missing checks and race; recipient policy must be explicitly approved.** Acceptance obtains an invitation by code but never compares the authenticated user's verified email to `invitation.email` (`invitations.controller.ts:228-285`). Consequently an authenticated holder of a forwarded/leaked invite code can join even when it was addressed to another user. If transferable bearer invitations are intentional, the UI and owner consent must clearly say so; the existing address-targeted workflow does not.

The one-household rule is checked outside the acceptance transaction (`invitations.controller.ts:271-276`). `HouseholdRepository.acceptInvite` locks the target household and invitation and checks only membership in that household (`:553-605`). Two invitations to different households, or create-vs-accept, can therefore both pass for one user. The unique key is only `(household_id,user_id)` (`shared/schema.ts:625`; `migrations/0005_household_members_unique.sql`). Subsequent resolution selects an arbitrary first household (`HouseholdRepository.ts:45-51`), and erasure explicitly rejects multi-household users (`settings.account-deletion.service.ts:441-476`). `createWithOwner` has a per-user advisory lock, but invite acceptance does not take it.

**Reproduce:** use a seeded invite for B and a different-email authenticated household-free C; submit the code. Separately, release two household-accept requests for one household-free user through a barrier. Inspect resulting membership rows; also test create-vs-accept. These races were not executed by this reviewer.

**Fix / acceptance:** bind recipient email/verification under the same authoritative mutation and use one shared per-user membership-lifecycle lock for creation/acceptance/erasure, with documented lock order. Re-check expiry, accepted/cancelled state, invitation household and effective role inside the transaction. Given two invitations in different households accepted concurrently, exactly one succeeds and the user has one membership; the loser receives a recoverable 409. Wrong recipient receives 403 without consuming the invite. Expired/cancelled invitations never add members. Existing supported erasure/ownership tests must still pass.

### AH-07 — HIGH / P1: profile saves silently discard offered data

**Confidence: high.** The live form transforms and submits the entire profile (`useProfileForm.ts:261-275`), including gender, contact numbers, address, NRC, income, employment, financial preferences and social links. The server's Zod update schema accepts only full/first/last/display name, birthday, timezone, language, and bio (`settings.validation.ts:3-12`). Other properties are stripped before persistence (`settings.controller.ts:136-146`) and the API/UI still report success (`:166-168`; `ProfileForm.tsx:28-31`). Gender is also required by the client form, so users can repeatedly fill it, save, and lose it on reinitialization.

**Reproduce:** update synthetic contact/financial values and gender through the form or direct authenticated PUT; compare response, DB row, and fresh GET/reload. A 200 response alone is not proof of a completed save.

**Fix / acceptance:** inventory every field already offered by the profile form and align its input DTO, validation, storage, API output and rendered read-back. Full completion includes personal, contact, employment, financial-preference and social fields already presented to users; hiding them or dropping values is not completion. Do not blindly allow all user columns: credential, system-role, computed, and ownership fields must remain inaccessible. Given each visible editable field, a valid change survives DB read-back and reload; clearing optional fields also persists; rejected/unknown fields produce a clear error rather than false success. Include server validation for dates, enum values and money strings. Whether DOB/gender/NRC and broad financial profiling should remain part of the product is an explicit data-minimization decision for the owner; until such a change is approved, the existing field surface remains in the completion inventory.

### AH-08 — HIGH / P1: account exit and full portability are unfinished

**Confidence: high.** The mounted `POST /api/settings/account/export` only looks up the user and returns `export_<timestamp>`; it creates no job, file, data export row or downloadable result (`settings.account.controller.ts:92-103`). Reporting/transaction exports elsewhere are separate and do not prove full user portability. No user-account export/delete controls were found in the live client settings.

Erasure rejects a user with no household (`settings.account.controller.ts:46-50`), including a registered user who has not onboarded and a member who already left. The erasure service has substantial shared-versus-sole-household logic, but live-session cleanup remains AH-01. Its user scrub does not reference password-reset tokens, so old recovery material also needs deliberate invalidation. Shared-household financial retention and succession must be disclosed and tested, not assumed equivalent to deleting every personal record. `docs/compliance/data-privacy.md` claims full portability, describes soft deletion/retention unlike current code, and lists a placeholder contact.

**Reproduce:** with a synthetic stepped-up user, request full export and inspect resulting DB/artifact state; repeat erasure for a user with no household. Do not perform erasure on real data.

**Fix / acceptance:** deliver discoverable self-service user-data export and account erasure with understandable scope, confirmation, reauthentication, progress, failure recovery and completion states. Export requires a real downloadable artifact with explicit scope/version/counts, authorization, expiry, bounded generation and audit. Make erasure work for household-free, sole-member and shared-member users. Define owned-private versus jointly shared records, invitations, profile files, security history, retained audit and backup retention; revoke credentials and all sessions. Given each lifecycle case, expected rows/files/access are verified and bystander households are unchanged. A working support process supplements these controls; it does not replace them for full completion. Fake queued export success cannot be accepted as functionality. Shared-record ownership and retention choices remain product decisions requiring truthful user-facing disclosure.

### AH-09 — HIGH / P1: view-only members can mutate shared household preferences

**Confidence: high.** `PUT /api/settings/preferences` applies authentication and household membership but no role gate (`settings.routes.ts:113-118`). `settingsController.updatePreferences` writes the household's preference row with no role check (`:364-396`), including `showPendingTransactions` and `allowEditPending` accepted by `settings.validation.ts:31-32`. The product labels `view_only` as read-only (`MembersSection/components/RolePermissions.tsx:23`). The nearby general-household settings route correctly restricts owner/admin, so the two shared settings surfaces disagree.

**Reproduce:** as a synthetic view-only member, directly PUT `{showPendingTransactions:false,allowEditPending:true}` and inspect the shared household row. UI button visibility is not authorization.

**Fix / acceptance:** separate user-level preferences from household-level policy and apply an owner/admin gate to the latter, according to the approved role matrix. Given view-only/member actors, protected household policy writes return 403 and leave rows/audit state unchanged; authorized owner/admin writes persist. Verify the setting's effect in financial workflows as part of the domain audit.

### AH-10 — HIGH / P1: “one-time” MFA consumption is not atomic

**Confidence: high from the read/compare/unconditional-write sequence; no concurrency probe executed here.** `authMfaService.verifyMfaLogin` reads a user (`:108`), validates OTP/backup hashes (`:118-154`), then clears the code or replaces the backup array with an unconditional user update (`:174-181`). It does not lock the row or compare-and-swap the consumed token. Two pending authentication sessions can read the same code before either clears it and both authenticate; concurrent backup-code consumption can also overwrite another consumption. The step-up OTP path has the same read/compare/clear shape (`security.mfa.stepup.ts:58-107,166-173`).

**Fix / acceptance:** centralize atomic challenge/recovery-code consumption; issue a session only after the successful consume commit, and tie the challenge to its intended authentication context. Given two requests racing the same OTP or backup code, exactly one succeeds; two distinct valid backup codes consume both without restoring either. Expiry, resend invalidation and maximum attempts remain effective. A real PostgreSQL barrier test is required; mocking the repository to return success cannot prove one-time behavior.

### AH-11 — MEDIUM / P2, mandatory completion gate: MFA management and policy are unfinished

**Confidence: high.** MFA enable/disable/status APIs exist (`security.mfa.auth.ts:34-175`), but SecuritySection renders only a low-backup warning, email/password, sessions and history (`index.tsx:11-27`); there are no client enable/disable/regenerate callers. The warning asks users to generate codes without an action (`MfaWarningBanner.tsx:20-23`). Policy enforcement is hardcoded off (`auth.mfa-policy.ts:35`), `login` ignores `mfaPolicy.required` and returns only a suggestion (`auth.service.ts:310-326`), and the login client drops that suggestion. Even flipping the flag would not enforce enrollment. The high-value policy sums unlike-currency balances without FX conversion (`auth.mfa-policy.ts:135-145`); do not activate it as a monetary security policy unchanged.

**Fix / acceptance:** complete self-service enrollment confirmation, code storage/download warning, backup regeneration, safe disable/recovery, unavailable-provider states and post-login enrollment routing. These management journeys are mandatory for full completion even though this finding's security severity is medium. Proposed policy: require usable MFA for owners/admins and make the remaining role/threshold behavior explicit; the owner must approve the actual policy. Any selected mandatory policy must block access at the server after password success, including existing sessions after policy changes; tests should not merely assert `suggestMfa`. If the advertised monetary threshold remains, normalize currency consistently before comparison and test unavailable/stale exchange-rate behavior. Do not describe the currently disabled policy as an active enforcement bypass. The email-based method and password-only step-up are the current product design; a different authenticator method is a separate enhancement.

### AH-12 — MEDIUM / P2: password changes can downgrade the registration/reset policy

**Confidence: high.** The live password-change controller imports `settings.validation.ts`, where a new password only needs eight characters and matching confirmation (`:14-23`). Registration/reset use stronger shared validation and registration also checks `validatePasswordComplexity` (`auth.validation.ts:29-38`; `auth.service.ts:95`; `auth.password-reset.service.ts:136`). A separate stronger change schema in `auth.validation.ts` is not the live one.

**Reproduce:** on a disposable stepped-up account, submit a new eight-character lowercase password not in history to `PUT /api/settings/security/password`; compare with registration/reset validation. The client may reject it, so use the API to establish the server contract.

**Fix / acceptance:** one approved password policy at every write boundary, including bounded input length and consistent errors. Given any rejected registration password, authenticated change/reset reject it too; a valid change still preserves only the current session and revokes other live cookies. Include current-password reuse as well as history semantics.

### AH-13 — LOW / P2: visible collaboration controls make unsupported promises

**Confidence: high.** Members settings displays a “Configure shared views” button with no action and hardcoded “Household Premium / Active / Includes 2 members / Unlimited collaborators included” text (`MembersSection/index.tsx:92-138`). There is no verified subscription state behind this card. These are reachable user-visible promises, not harmless unreferenced future code.

**Fix / acceptance:** implement the advertised shared-view configuration journey against an approved visibility/permission model, with persisted selection, role checks, meaningful empty/error states and server-side access enforcement on every affected read/export path. Given an allowed user, the control opens configuration, saves, survives reload and changes only the authorized view; an unauthorized user cannot obtain excluded data by calling the API directly. Reconcile the Premium/Active card with an approved, truthful entitlement model backed by actual state. Whether this product has paid tiers, member limits or included collaboration is an unresolved commercial decision; this finding does not authorize inventing payments or a billing platform. Hiding the control or leaving a fake status does not satisfy full completion. Actual private-account capabilities elsewhere must be assessed separately rather than inferred from this card.

## Verified positive foundations

- Active auth is modular; bcrypt cost 12, cryptographically generated verification/MFA tokens, hashed stored codes, auth/IP limits, login lockout, and session regeneration are present. This is source evidence, not a penetration-test claim.
- Production cookie security, trusted-proxy configuration, restrictive CORS/CSP, and CSRF middleware exist (`server/app.ts:33-131,145-211`). `NODE_ENV=test` skips CSRF at `:198`, so test-mode HTTP success must be supplemented by development/production-mode browser proof.
- Password reset atomically locks and consumes its token, rotates credentials and revokes both session stores (`auth.password-reset.service.ts:151-213`). Password change already reuses both-store revocation (`settings.controller.ts:306-315`). Those helpers provide a clear repair direction for AH-01.
- Household general settings/member/invite controllers do enforce owner/admin or owner-only checks and self-operation restrictions; financial module guards use real household context. The review does not repeat historical claims that all authorization is missing.
- Household creation has an advisory lock and atomic household/owner/default-tag writes (`HouseholdRepository.ts:90-131`). Ownership transfer and last-member removal use transactions. Their protection does not extend automatically to every lifecycle race.
- Erasure differentiates sole/shared membership, retains shared household data when others remain, selects a successor, scrubs a broad user field set, records a durable audit entry, and collects upload paths before post-commit cleanup. That is substantial functionality, despite the identified gaps.
- Profile picture/banner updates use database transactions and audit writes; failure/old-file cleanup is implemented. These should be retained and verified rather than replaced during profile-field remediation.

## Why previous green evidence did not settle these journeys

| Earlier conclusion | Current reconciliation |
|---|---|
| Auth assessment updated 7 July: 98/100, all issues resolved, only staging evidence remains | Modular routing and many controls are real. AH-01 through AH-04/AH-10 are current implementation gaps; 98/100 must not stand in for end-to-end readiness. |
| Household assessment 7 July: invite lifecycle complete, transfer/leave complete, passing client tests | API handlers exist. AH-05 shows the UI calls a missing route, has no invitation page and reads a different member shape; transfer/leave are backend-only. AH-06 adds unresolved trust/concurrency boundaries. |
| Household role enum mismatch closed | Server supports `view_only`, but client still offers `professional`; closure was narrower than the user journey. |
| Settings assessment 7 July: no repo-local P1 remains | Audit calls are present, but AH-01/AH-07/AH-08/AH-09 show material incomplete behavior. Audit-row existence is not outcome verification. |
| Full portability and soft-then-hard deletion in privacy document | Export endpoint is a placeholder; current erasure hard-deletes/anonymizes immediately according to membership. Documentation needs owner-approved reconciliation with actual behavior. |

The inspected tests explain some coverage blind spots: AddMemberDialog mocks `useAddMember`; household “integration” tests mock repositories and register controller handlers; settings security unit tests call a manually registered `/api/settings/password` path rather than the production mount; auth policy tests only assert a suggestion. Genuine real-database password-reset/change, erasure and household tests also exist and are valuable, but should not be generalized to unexercised browser wiring or the separate session-revocation endpoints. No new test pass count is claimed in this document.

## Completion work packets

These are planning ranges for full completion of this audited slice, with no fixed deadline. Effort includes implementation, focused automated checks and local evidence. The cross-boundary QA packet adds staging/security journey evidence; the central plan must also reserve time for full-app deployment, operations and integration. Ranges assume one primary developer familiar with the code and timely decisions on roles, MFA, shared visibility, export/retention and entitlements. Support procedures or feature removal are not effort-reduction assumptions.

| Packet | Findings | Concrete deliverable / dependencies | Effort range |
|---|---|---|---|
| AUTH-W1 Live sessions and safe DTOs | AH-01, AH-02 | Shared both-store single/bulk/erasure revocation; concurrency-safe invalidation contract; explicit public DTOs; two-cookie/response-shape tests. No dependency on UI redesign. | 1.5–3 developer days |
| AUTH-W2 Verified onboarding and mail links | AH-03, AH-04 | Canonical verification URLs, pending-registration access policy, fresh-browser resend/return path, atomic/recoverable initialization, captured-mail browser proof. Depends on sandbox mail and approved registration policy. | 1.5–3 days |
| HOUSE-W1 Complete household membership lifecycle | AH-05, AH-06 | Self-service invite creation/accept page and auth continuation, shared member DTO, all offered roles including an approved Professional matrix, pending invites, discoverable leave/transfer controls, recipient checks and shared lifecycle lock, real concurrent acceptance tests. Depends on AUTH-W2. | 4–7 days |
| SETTINGS-W1 Complete profile persistence and shared settings roles | AH-07, AH-09 | Every offered profile field has allowlisted validated persistence, clearing semantics and field-by-field read-back; owner/admin preference checks; complete upload/display interactions retain their existing behavior. | 3–5 days |
| AUTH-W3 Complete MFA and credential consistency | AH-10, AH-11, AH-12 | Atomic code consumption, shared password policy, self-service enrollment/disable/backup regeneration/recovery UI and approved policy enforcement. No unconverted high-value enforcement. Depends on sandbox mail and AUTH-W1/W2. | 3–5 days |
| EXIT-W1 Complete self-service portability and erasure | AH-08 plus AH-01 cleanup | Versioned export + bounded authorized download, actual progress/error states, self-service household-free/sole/shared erasure, recovery-token/session/file cleanup, truthful notice/contact and support ownership. Support complements the implemented UI. | 4–7 days |
| HOUSE-W2 Shared views and truthful entitlement state | AH-13 | Working shared-view configuration and persisted visibility enforcement, role/relationship/export privacy tests, membership card driven by approved actual entitlement state. Depends on approved product semantics and financial privacy remediation; new paid billing is not assumed. | 3–6 days |
| QA-W1 Cross-boundary completion evidence | All | Full real-router, CSRF-on browser plus DB read-back journeys across two users/one household and a separate household; production-like cookie/proxy/mail tests; every defect acceptance criterion above, including previously backend-only controls. Run after relevant packets, not as a substitute for them. | 3–5 days |

Combined planning envelope for this slice: roughly **23–41 developer days before overlap**, plus any material product change emerging from the unresolved decisions. This is an effort estimate, not a promised elapsed schedule or full-app estimate. Do not add it mechanically to the central plan: consolidate shared financial/privacy remediation and repeated acceptance tests, while preserving every completion outcome. Newly selected paid subscriptions, a multi-household model, or an additional MFA method would require separate estimation; they are not silently included or treated as existing implemented behavior.

### Cross-packet implementation contract

1. **Auth state and API errors:** anonymous, pending verification, pending MFA/enrollment, authenticated, and erased/revoked are distinct states. Use stable error codes. Keep verification/recovery reachable without financial authorization. Never infer state from English message substrings where a structural signal can be used.
2. **Household contract (proposed semantics):** retain the current one-active-household rule; complete owner/admin/member/view_only and the offered Professional role with an approved permission matrix; use verified address-bound invitations unless a different policy is explicitly accepted. Every lifecycle mutation uses the same locking order and preserves an owner/governable household where applicable. Complete self-service transfer, leaving, invitation management and role administration.
3. **Profile contract:** every visible saveable field maps to an approved validated server field; immutable identity/credential/role/computed columns are excluded. Read-back proof is required; UI cache mutation alone is insufficient.
4. **Exit contract:** full-account export differs from a report export. Self-service erasure specifies private versus shared data, other members, files, credentials, security/audit retention and backups. User-facing text reflects that exact contract and has a real support channel. The precise shared-data retention rules require owner approval; the existence of usable export and erasure controls does not.
5. **Audit contract:** include actor, action, target and result without storing raw codes, cookies, passwords or full exports. Atomic critical audit requirements must not be represented by a fire-and-forget log claim.

## Required completion and staging evidence for this slice

- A clean invited user follows a sandbox-captured invitation, registers/verifies, accepts, and completes the intended first shared financial workflow without developer tools or direct database repair.
- Owner/admin/member/view-only and the approved Professional role outcomes are checked using the real mounted routes, not controller-only fixtures. Wrong household, wrong invite recipient, cancelled/expired/replayed invitation and removed membership produce the expected denial and no writes. Transfer and leave are completed through discoverable UI controls and verified after refresh.
- Two-device session revoke, bulk revoke, password change/reset, logout and erasure each prove the old cookie's actual authorization state. Both session stores and pending/recovery states are inspected.
- The same OTP/backup code can be consumed once under real concurrent requests; one user cannot concurrently join/create two households.
- Every offered profile field is compared across UI input, request, DB row, refreshed read and rendered UI, including clearing optional fields and upload replacement/deletion. Unknown fields and server-invalid input cannot produce a deceptive successful save.
- Self-service MFA enrollment, confirmation, disable, backup regeneration and recovery work in the browser. Approved mandatory-policy behavior is tested for affected roles, existing sessions, provider outage and impossible-to-complete enrollment; a bare policy flag is not evidence.
- Full data export and each erasure lifecycle case are completed through self-service controls and produce the declared result, no bystander changes, and traceable audit evidence. Support-assisted procedures are additional recovery evidence, not substitutes.
- Shared-view configuration performs its defined action, persists after reload and enforces the approved visibility model on related data and exports. Membership/entitlement text is derived from actual approved state rather than a hardcoded Active card.
- Staging uses the intended build SHA and real HTTPS/proxy configuration; test-mode CSRF exemptions do not count as production-like security verification. Delivery to an approved sandbox/test mailbox and a fresh-browser verification link are demonstrated.

## Review Summary

| Severity | Count | Status |
|---|---:|---|
| CRITICAL | 1 | block |
| HIGH | 9 | warn |
| MEDIUM | 2 | info |
| LOW | 1 | note |

Verdict: **BLOCK for full completion: all 13 findings and the unfinished self-service/advertised journeys must be closed with evidence.** Security severity determines remediation order, not permission to omit lower-severity functionality. Source inspection is complete for the surfaces recorded above; browser, persistence and staging completion depend on the coordinating evidence register. Role permissions, mandatory-MFA rules, shared visibility, retention and entitlement semantics are explicitly proposed decisions; no feature removal, support-only substitute, or deadline-driven deferral is approved.
