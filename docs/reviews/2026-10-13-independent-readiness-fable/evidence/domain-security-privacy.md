# Domain evidence: security-privacy (authorization, household isolation, privacy, sessions)

Verifier: `security-privacy` (relaunch). Revision: main @ 381e943. Target: audit server http://localhost:5055, DB `finance_app_audit_fable_20261013`.
Fixtures: `a5owner` (audit_a5_owner, owner, household `b209940c-…` "A5 Security Household"), `a5member` (audit_a5_member, no household at start), `a5outsider` (audit_a5_outsider2, owner of `13700fb7-…` "A5 Outsider Household").
Scripts: `.local/readiness-fable-2026-10-13/scratch-security-privacy/*.mjs` (helper `lib.mjs`: cookie jar + automatic CSRF).
Previously recorded by lead (cited, not re-derived): F-AUTH-04 (CSRF bound to non-persisted session id blocks unauthenticated verify-email), F-AUTH-02 (`/api/auth/me` returns mfaCode/mfaBackupCodes/nrc etc.).

## 1. Household lifecycle (invite, accept, roles)

Script: `h1.mjs`, `h2.mjs`, `h3.mjs`. DB read-back via `q.sh` (household_invitations, household_members).

### Findings

| ID | Surface | Expected (source) | Observed | Impact | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|---|
| SEC-01 | `POST /api/household/invite/accept` | An invitation is addressed to one email (`household_invitations.email`; email says "This invitation was sent to audit-a5-member@…"). Accept must require `currentUser.email == invitation.email` | Owner invited `audit-a5-nobody@audit.invalid` with role **admin**. User `audit_a5_member` (email `audit-a5-member@…`) posted that code → **200 `{"accepted":true,…,"role":"admin"}`**. DB: invitation for nobody@ `accepted_at` set; `household_members` row for member with role `admin`. Code path `server/modules/household/invitations.controller.ts:228-290` never compares emails. | The invite code is a pure bearer token. Anyone who obtains a forwarded/leaked/logged invite link joins the household with the granted role (incl. admin), sees all shared financial data, and can invite others. | P1 | High | PRESENT (bug) / HTTP+DB |
| SEC-02 | Invite email link | Link in email must open a working accept screen | Email (smtp-sink) link = `http://localhost:5055/invite/<64-hex>`. `client/src/App.tsx:88-109` has **no `/invite/:code` route** (SPA fallback serves index → `NotFoundRoute`); no client code calls `/api/household/invite/accept` (grep: 0 hits). | Invitation feature is unusable end-to-end by a real user; only reachable through raw API. | P1 (functional) | High | MISSING / SRC+HTTP |
| SEC-03 | `PUT /api/household/members/not-a-uuid/role` | 400 validation error (Rule 8) | **500 INTERNAL_ERROR** (Postgres uuid cast error surfaced as 500) | Noisy 500s, error-budget pollution; no data exposure | P3 | High | PARTIAL / HTTP |
| SEC-04 | Timestamps (cross-cutting) | One consistent UTC clock | `household_invitations`: `created_at` 22:17:06Z (DB `now()`), `accepted_at` **20:17:35Z** (JS `new Date()`), `expires_at` = created+7d−2h. API returns `createdAt 2026-10-14T00:17Z` while error `timestamp` is `2026-10-13T22:17Z`. A row is "accepted" 2 h before it was created. | `timestamp without time zone` columns mix DB-local `now()` (Africa/Lusaka, +2) and JS UTC writes. Expiry windows are 2 h short; audit chronology is wrong. | P2 | High | PRESENT (bug) / HTTP+DB |

### What works (HTTP-verified)

| Check | Result |
|---|---|
| Duplicate invite same email / upper-cased email | 409 "already pending" (normalised lower-case) |
| Invite an existing member (owner's own email) | 409 "already a member" |
| Invite with role `owner` | 400 enum rejection |
| Non-member (no household) invites | 404 |
| Outsider (already in another household) accepts a valid code | 409 "member of another household" |
| Random code / used code / re-accept by existing member | 404 / 409 "already been used" / 409 "already a member" |
| Invite code entropy | 32 random bytes hex (`invitations.controller.ts:158`), 7-day expiry |
| Owner sets member → view_only → admin → member | 200 each, persisted |
| Owner/admin modifies own role | 400 "Cannot modify your own role" |
| Admin: change owner role / remove owner / transfer ownership | 403 / 403 / 403 |
| Admin: rename household, list invitations | 200 (admin is allowed by design) |
| Member: invite, change roles, remove owner, list invitations, PUT general, transfer ownership | all 403 |
| Member creating a 2nd household | 409 |
| Outsider: change role / remove member of A5 | 404 (scoped to caller's household) |
| `GET /api/household/members` as `member` | returns id, householdId, userId, role, joinedAt, lastActiveAt, name; **email omitted** for non-admin (`members.controller.ts:41-52`). Owner/admin see emails. Acceptable. |

## 2. Privacy (private account / private-account transactions vs another member)

Setup (owner, `p1.mjs`/`p3.mjs`/`p5.mjs`): private account `A5 PRIVATE Vault` (`ce6d5a98-…`, `isPrivate:true`, owner-owned, balance 5000), shared account `A5 Shared Checking` (1000). Expense 777.77 "PRIVSECRET" on the private account (`fa7a446c-…`), expense 11.11 "SHAREDTXN" on the shared account. Owner tagged both with `A5Tag`, linked the private txn to the shared goal "A5 Shared Goal" (`95e6270b-…`, spending link), and created recurring rule `7054e600-…` from the private txn. DB read-back: the private transaction row has `transactions.is_private = false`; its privacy comes only from `accounts.is_private = true`.
Marker scan (`p2.mjs`, `p5.mjs`): each GET was run as owner (control) and member, scanning the body for `PRIVSECRET`, `Vault`, the private ids, `777.77`, `788.88` (=777.77+11.11), `4222.23` (private balance after txn), `5211.12` (=4222.23+988.89 net worth incl. private).

### Findings

| ID | Surface | Expected (source) | Observed (member, role `member`) | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|
| PRIV-01 | `GET /api/goals/:id/transactions`, `GET /api/goals/:id/activity`, `GET /api/goals/summary` | Rule 11: private items visible only to owner; cross-entity links must use visibility checks | **200 with `PRIVSECRET`, private accountId `ce6d5a98…`, txn id, `777.77`** on `/transactions` and `/activity`; `/goals/summary` includes 777.77. Owner merely linked his private txn to a shared goal. | P0 | High | PRESENT (leak) / HTTP |
| PRIV-02 | `GET /api/tags/:id/transactions` | same | **200 listing `PRIVSECRET` 777.77** (txn id). Root cause `server/repositories/TagRepository.ts:240-245` filters only `transactions.isPrivate`, never `accounts.isPrivate`. (`GET /api/tags/transaction/:privTxn` correctly 404.) | P0 | High | PRESENT (leak) / HTTP+SRC |
| PRIV-03 | `GET /api/recurring`, `/recurring/:id`, `/recurring/:id/transactions`, `/recurring/:id/history` | same | **200 with rule name `PRIVSECRET`, amount 777.77, private `accountId`, linked private txn id** on all four. | P0 | High | PRESENT (leak) / HTTP |
| PRIV-04 | `PUT /api/recurring/:id` (rule on private account), `DELETE /api/goals/:goalId/transactions/:privTxnId` | Non-owner must not modify objects bound to another member's private account/txn | Member **renamed the private-account rule** (200; DB `recurring_transactions.name='pwn'`, `account_id=ce6d5a98…`) and **unlinked the owner's private txn from the goal** (200 "Transaction unlinked"). | P1 | High | PRESENT (bug) / HTTP+DB |
| PRIV-05 | Root cause (cross-cutting) | One privacy predicate | Two-level privacy model: `transactions.is_private` (never set by create API; create schema has no `isPrivate`) and `accounts.is_private`. Paths that join accounts (`TransactionQueryRepository.ts:165-177`, `TransactionRepository.ts:227-244`) are correct; paths that check only the txn flag or nothing (tags, goals links/activity, recurring) leak. | P0 driver | High | SRC+HTTP |
| PRIV-06 | `GET /api/recurring/detect` | 200 | **500** for owner and member (functional defect, no leak) | P2 | High | HTTP |

### What works (member sees no private markers; owner control shows them)

| Endpoint (member) | Result |
|---|---|
| `GET /api/transactions` (plain, date-range, `?search=PRIVSECRET`) | 200, no private rows |
| `GET /api/transactions/:privTxn` | **404** (not 403: does not confirm existence) |
| `GET /api/transactions/summary?startDate&endDate` | 200, totals exclude 777.77 (owner sees 788.88) |
| `GET /api/accounts`, `?includeHidden&includeArchived`, `/accounts/:priv` (+`/balance-history`, `/transactions/export`, `/balance-history/export`) | list excludes Vault; detail/exports 404 |
| `GET /api/accounts/summary`, `/summary/history`, `/net-worth/history`, `/summary/export` | no 5211.12 / Vault (owner sees them); `?scope=household` → 403 for member |
| `GET /api/reports/cashflow`, `/income`, `/savings-rate`, `/spending/trend`, `/sankey`, `/ratios`, `/net-worth`, `/net-worth/changes`, `/spending/breakdown` | no private amounts (owner sees 788.88 / 5211.12) |
| `GET /api/notifications` | owner's "PRIVSECRET" notification not visible to member |
| `GET /api/tags/transaction/:privTxn` | 404 |
| Member writes against private objects: link priv txn to own goal, tag priv txn, recurring-from priv txn, PUT/DELETE priv txn, PUT priv account, assign priv account to goal | 404 / 404 / 404 / 404 / 404 / 404 / 400 "access denied" |
| Member creates txn on private account | 403 "Access denied to private account" |
| Member transfer from private account | 401 STEP_UP_REQUIRED (step-up gate fires before the privacy check; not exercised past it) |

### Additional privacy checks (all PASS)

| Check | Result |
|---|---|
| `GET /api/reports/transactions`, `/annual`, `/expenses/classification`, `/spending/subcategory`, `/cashflow/budget`, `/goals/progress`, `GET /api/goals/available-funds`, `/api/weekly-recap/history` (member) | no private markers; owner control shows PRIVSECRET / 788.88 / 5211.12 / Vault where applicable |
| `POST /api/weekly-recap/generate {weekOf:"2026-10-05"}` | member net worth 988.89 (shared only); owner 5211.12 |
| Reports CSV export (`p7.mjs`): owner creates transactions export `c3cfbb6c-…`; owner download contains PRIVSECRET | member (role member): `GET /exports/:id` → 403, not in `GET /exports?includeHousehold=true`; member promoted to admin: metadata 200, **download regenerated under the downloader's visibility → CSV contains only `SHAREDTXN`** (`reports.exports.controller.ts:100-180`). |
| PRIV-07 (P3) | Export metadata exposes `recordCount: 2` (DB `data_exports.record_count=2`) to an admin whose CSV has 1 row, so it discloses that hidden rows exist. Low impact. |

## 3. Roles: `view_only` write sweep (`v1.mjs`, `v2.mjs`)

Member set to `view_only` (200, persisted). 37 write requests with schema-valid bodies where needed.

| Result | Endpoints |
|---|---|
| **403 "requires member role or higher"** | POST/PUT/DELETE `/api/transactions` (DELETE target = owner's throwaway txn), `/transactions/transfer`, POST/PUT `/api/accounts`, `/accounts/:id/archive`, PATCH `/accounts/:id/settings`, POST `/api/budgets`, `/budgets/recalculate`, POST/PUT/DELETE `/api/goals`, `/goals/:id/contribute`, POST/PUT `/api/recurring`, POST `/api/categories` (`/seed` needs admin), POST/PUT `/api/tags`, POST `/api/rules`, POST `/api/merchants`, `/merchants/seed`, POST `/api/filter-presets`, POST `/api/investments/holdings`, POST `/api/grz/tbills` |
| 403 (in-handler check) | `POST /api/import/execute` with a valid body ("Import execution requires member access or higher", `routes/import.ts:138`); `PUT /api/household/general` |
| 409 / 403 | `POST /api/household` (already has household); `POST /api/ai/chat` (consent gate, AI unconfigured) |
| **2xx for view_only** | `POST /api/reports/exports` (200, `data_exports` row `187accc4-…` written + export audit), `POST /api/weekly-recap/generate` (200, recap computed/stored), `PATCH /api/weekly-recap/settings`, `PUT /api/notifications/read-all` |

Assessment: the four 2xx writes are read-derived or per-user preference writes (no household financial data changes). No route in `server/modules/*/*.routes.ts` or `server/routes/*.ts` that mutates shared financial data accepted a `view_only` write. **No P1 view_only finding.** Recorded as SEC-05 (P3, design note): `POST /reports/exports` and `/weekly-recap/generate` have no `requireRole`; acceptable if "view" includes export, but this should be an explicit product decision, since exports are the DPA egress path.
Not exercised: receipt upload (multipart, `POST /api/receipts/upload` is `requireRole("member")` in `receipts.routes.ts:34-39`, SRC only), `POST /api/reports/custom` (read-only compute; my body failed validation).

## 4. Cross-household isolation (IDOR) with the outsider jar (`i2.mjs`, `i3.mjs`)

Target ids (owner household `b209940c-…`): shared account `9ec6736e-…`, shared txn `401aa5b3-…`, budget `390b8d09-…`, goal `95e6270b-…`, recurring `7054e600-…`, tag `9f7937e2-…`, rule `8ca13b8b-…`, merchant `0bf310af-…`, filter preset `fc89c25a-…`, export `c3cfbb6c-…`, category `f7d7fadb-…`; throwaway txn/goal/account for DELETE probes.

### Findings

| ID | Surface | Expected (source) | Observed (outsider, another household) | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|
| ISO-01 | `GET /api/goals/:id/activity` | 404 for a goal outside the caller's household (Rule 11 "always scope by householdId") | **200 with the full activity log of the owner household's goal**: `transaction_linked` / `transaction_unlinked` entries with `amount "777.77"`, `metadata.transactionName "PRIVSECRET"`, `transactionId fa7a446c…`, `createdBy` user ids of both A5 users, `initialTarget 10000.00`. Root cause `server/modules/goals/goals.controller.ts:359-369`: `goalActivityLogService.getActivity(id, …)` is called with the goal id only; `req.householdContext` is never read. Goal ids are returned by many list endpoints and appear in URLs (`/goals/:id`), so they are not secrets. | **P0** | High | PRESENT (leak) / HTTP+SRC |
| ISO-02 | `GET /api/transactions/:id/goals`, `GET /api/recurring/:id/history`, `GET /api/recurring/:id/transactions` | 404 for foreign ids | **200 `{"data":[]}`** for foreign ids, while the owner gets the link list (`txn/:id/goals` returns the 11.11 link for the owner). Data is not leaked (queries are household-filtered), but the endpoints do not 404 and confirm nothing; inconsistent with the rest of the API. | P3 | High | PARTIAL / HTTP |
| ISO-03 | `GET /api/transactions/:id/attachments` (foreign id) | 404 | **500** for the outsider (owner gets 200 `[]`) | P3 | High | PARTIAL / HTTP |
| ISO-04 | `GET/PUT /api/merchants/undefined` (malformed id) | 400 | 500 (no UUID validation on the param) | P3 | High | PARTIAL / HTTP |

### What works (outsider denied)

| Resource | GET | PUT/POST/DELETE |
|---|---|---|
| Accounts (`/:id`, `/balance-history`, `/transactions/export`) | 404 | PUT 404, adjust-balance 404, DELETE throwaway → 401 STEP_UP_REQUIRED (gate fires first; not exercised past step-up) |
| Transactions `/:id`, `/attachments/:aid/download`, `/tags/transaction/:id` | 404 | PUT 404, DELETE 404, POST into owner account 404 "Account not found" |
| Budgets, goals (`/:id`, `/transactions`, `/projection`, `/contributions`), recurring `/:id`, tags (`/:id`, `/:id/transactions`), rules, filter presets, categories, reports exports (`/:id`, `?download=true`), receipts `/:id` | 404 | PUT/PATCH/DELETE 404; link owner txn to owner goal 404; tag owner txn 404; import/execute with `householdId` of A5 → 403 (`routes/import.ts:131-145` checks membership of the target household) |
| `?householdId=<A5>` query on `/api/household/members`, `/api/transactions`, `/api/accounts` | 200 but **returns the caller's own household data** (parameter ignored) | n/a |
| `/uploads/<prefix>/<A5 hh>/…`, `/uploads/merchant-logos/<other hh>/<real file>`, flat `/uploads/banners/<file>`, `/uploads/profile-pictures/<file>` | 403 (`middleware/uploadsAuth.ts:89-117` requires `{type}/{callerHouseholdId}/…`) | n/a |

Note: `/uploads/profile-pictures/<file>` and `/uploads/banners/<file>` real files on disk are flat (no household segment), so they are 403 even for their own household (possible functional gap for legacy files; not a leak).

## 5. Sessions, step-up, CSRF, cookies, health, rate-limit headers (`s1.mjs`, `s2.mjs`)

Pre-state (DB): owner had two `user_sessions` rows (`3fa963b1` → store sid `Kus_4Ga3…`, `12a8dd4a` → sid `SbLjuo3r…` = the jar) and two matching rows in the connect-pg-simple `session` table. Jar copied to `a5owner_copy` before revoking. Step-up used the fixture password from `mk-agent-users-v2.sh` (local test value).

### Findings

| ID | Surface | Expected (source) | Observed | Sev | Conf | Impl / Verif |
|---|---|---|---|---|---|---|
| SES-01 | `DELETE /api/settings/security/sessions/:id` and `DELETE /api/settings/security/sessions` (revoke-all) | Revoked session can no longer authenticate | Both return 200 and `GET /sessions` then shows `[]`, but the **`session` store rows are untouched**: after revoking `3fa963b1` and then revoke-all, DB still has `Kus_4Ga3…` (expire 2026-11-12) and `SbLjuo3r…`. The revoked own session (copy jar) → `GET /api/auth/me` **200**. Root cause: `server/routes/security.sessions.ts:64-75,103-117` deletes only from the `user_sessions` tracking table; `requireAuth` (`server/auth.ts:20-36`) checks only `req.session.userId`, never `user_sessions`. The correct helper exists (`server/services/session-revocation.ts:39-65` deletes from `"session"` too) and is used by password change but not by these endpoints. | **P1** | High | PRESENT (bug) / HTTP+DB+SRC |
| SES-02 | Session list | Accurate device list | After revocation the list is empty while two live sessions exist (false assurance to a user reacting to a stolen device). `lastActiveAt` is never updated (equals `createdAt − 2h`, see SEC-04 clock skew). | P2 | High | HTTP+DB |
| SES-03 | `DELETE /sessions/<random uuid>` | 404 | 200 "Session revoked" + an audit row for a non-existent session | P3 | High | HTTP |
| SES-04 | `GET /health/ready` (unauthenticated) | Liveness only, or auth/IP-restricted | Returns DB/cache status + latency, `version`, process `uptime`. `GET /api/health/routes` returns cut-over status. Low info disclosure. | P3 | High | HTTP |
| SES-05 | `/api/reports/*` limiter | 30 req/min per user (`rateLimit.ts:162-170`) | analyticsLimiter is mounted twice (`routes.ts:142` and `reports.routes.ts:30`, same store prefix): one reports call drops `ratelimit-remaining` 30→28, so the effective cap is **15/min**; the bucket is shared with `/api/goals/available-funds`, `/weekly-recap`. A reports dashboard that fires ~12 widget queries plus a date change returns 429 to a normal user (I hit 429 on both users after ~12 report calls). | P2 | High | HTTP+SRC |

### What works

| Check | Result |
|---|---|
| Revoke without step-up | 401 `STEP_UP_REQUIRED` level SETTINGS, ttl 15 min |
| Step-up wrong password / right password | 401 INVALID_CREDENTIALS / 200 `expiresIn: 900` |
| Step-up levels (SRC `middleware/requireStepUp.ts:21-24`) | FINANCIAL 5 min, SETTINGS 15 min, DESTRUCTIVE 5 min; transfer and account delete demanded step-up (`level FINANCIAL`/`DESTRUCTIVE`) in sections 2 and 4 |
| Password change (SRC) | `settings.controller.ts:253-320` revokes every other session in both tables inside `withTransaction` via `revokeUserSessions(…, {exceptSessionId})`, rejects reuse of recent passwords. Not exercised over HTTP: a copied jar is the *current* session (kept by design) and creating a second session would need an extra login, which the brief forbids. |
| CSRF | Mutation without header, with a garbage header, and with another user's valid token → 403 `CSRF_INVALID` (3/3). Lead's F-AUTH-04 (token bound to a non-persisted session id for anonymous flows) stands; not re-derived. |
| Cookies | `csrf-token`: `HttpOnly; SameSite=Lax; Path=/` (dev: no `Secure`, prod switches to `__Host-csrf` + `Secure`, `app.ts:179-186`). Session cookie config `httpOnly`, `sameSite: lax`, `secure` in production, 30-day maxAge (`app.ts:147-160`). Headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`. |
| 429 contract | `ratelimit-limit: 30`, `ratelimit-policy: 30;w=60`, `ratelimit-remaining`, `ratelimit-reset`, `retry-after: 60`, body `{code:"RATE_LIMITED", retryAfter:60}` |

## 6. Admin endpoints and input validation (`s2.mjs`, `s3.mjs`, `e1.mjs`)

| ID | Surface | Expected | Observed | Sev | Conf | Verif |
|---|---|---|---|---|---|---|
| VAL-01 | Invitation email HTML (`invitations.controller.ts:47-70`) | User-controlled strings escaped in HTML email | Outsider renamed household to `A5 Outsider <i>Household</i>` and invited an address: email HTML part contains `<strong>A5 Outsider <i>Household</i></strong>` unescaped (`inviterName` = user's fullName is also raw). Any registered user can send app-branded mail with arbitrary markup/links to **any email address** (no recipient binding, see SEC-01). Phishing vector. (Household name restored afterwards.) | P2 | High | HTTP+sink |
| VAL-02 | Path ids `GET /api/{transactions,goals,accounts,budgets,recurring,tags,rules}/not-a-uuid`, `PUT /household/members/not-a-uuid/role`, `POST /transactions {accountId:"not-a-uuid"}` | 400 | **500** on all 9 (ownership validator: "Failed to validate entity ownership") | P3 | High | HTTP |
| VAL-03 | `POST /api/filter-presets` without `context` | 400 | 500 (Zod `parse` error not mapped) | P3 | High | HTTP |
| VAL-04 | Far-future dates | Reasonable bound | `POST /transactions date 9999-12-31` → 201; goal `targetDate 9999-12-31` → 201. Pollutes forecasts/net-worth series. | P3 | High | HTTP |

What works: `/api/admin/users`, `/audit-logs`, `/system-roles`, `/calculation-shadow-status`, `POST /admin/users/:id/unlock`, `POST /admin/users/:id/roles` as a household owner → 403 (6/6). 150 KB JSON → 413 `PAYLOAD_TOO_LARGE`. Amount 0, −5, 3 decimals, 1e15 → 400 with field messages; `2026-02-30` → 400; transaction currency ≠ account currency → 400; budget amount 0 → 400; tag colour must be hex (400). HTML in a tag name is stored verbatim and returned as JSON; the client renders through React escaping. Client `dangerouslySetInnerHTML`: only `client/src/components/ui/chart.tsx:79` (shadcn `<style>` from ChartConfig colours; tag/category colours are hex-validated) and a comment in `MessageBubble.tsx`; no HTML sink for user text found.

## 7. Household lifecycle part 2: resend/revoke, co-owners, transfer, remove, leave (`h4.mjs`–`h6.mjs`)

| ID | Surface | Expected | Observed | Sev | Conf | Verif |
|---|---|---|---|---|---|---|
| SEC-06 | `POST /api/household/transfer-ownership {newOwnerId: <caller's own id>}` | 400 "cannot transfer to yourself" | **200 `{"transferred":true}` and the household is left with NO owner**: DB `household_members` for A5 = owner→`admin`, member→`member`. `HouseholdRepository.transferOwnership` (`server/repositories/HouseholdRepository.ts:244-290`) sets target=owner then current=admin; when target==current the second update wins. Nobody can now transfer ownership or promote to owner (`members.controller.ts:101-108` requires an owner), and the remaining admin may `/leave` (only owners are blocked, `:293`), orphaning the household. Irreversible via the API; one click in a UI. | **P1** | High | HTTP+DB+SRC |
| SEC-07 | `PUT /api/household/members/:id/role {role:"owner"}` | Single-owner model (transfer-ownership is locked "so … can't leave two owners or no owner", `members.controller.ts:240-241`) | Owner promoted member to `owner` → 200; **two owners**. The co-owner then demoted the original owner to `view_only` (200), who lost settings access (PUT general → 403). Restored afterwards. | P2 | High | HTTP |
| SEC-08 | Lockout message | Uniform response | After lockout, correct password → `403 "Account is temporarily locked. Try again in 13 minute(s)."` vs `401 "Invalid email or password"` for unknown/wrong: discloses that the account exists (enumeration). | P3 | High | HTTP |
| SEC-09 | `/api/auth/*` limiter | authLimiter 10/min (`rateLimit.ts:173-185`) | Mounted twice (`routes.ts:112` and per-route in `auth.routes.ts:20-23`): `ratelimit-remaining` dropped 8,6,4,2,0 across 5 login attempts (effective 5/min, on top of the 5/min IP limiter). Same double-mount pattern as SES-05. | P3 | High | HTTP+SRC |

Works: resend pending invite 200 (new expiry); resend/cancel an accepted invite 409; member resend/cancel 403; cancel 204 then 404; outsider cancel A5 invite 404; transfer to a non-member 404; member "remove self" 400; admin removes member 200, removed member then gets 404 HOUSEHOLD_NOT_FOUND on `/transactions`, `/accounts`, `/goals/:id/activity`; re-invite → accept 200 → `POST /leave` 200 → 404 household.

**Side effect for the lead:** because of SEC-06 the A5 household (`b209940c-…`) is now ownerless (audit_a5_owner = `admin`, sole member). audit_a5_member has no household and is locked until ~22:50Z (2026-10-13, server clock) from the lockout test. No DB repair was attempted (read-only brief).

## 8. Lockout test (`lock.mjs`, run last)

5 wrong-password logins for audit_a5_member (1 s apart): attempts 1-5 → `401 "Invalid email or password"`; DB after: `failed_login_attempts = 5`, `locked_until` = +15 min (`MAX_FAILED_ATTEMPTS = 5`, `LOCKOUT_DURATION_MS = 15 min`, `auth.service.ts:57-58,421-430`). After 62 s (to clear the 5/min IP limiter) one login with the **correct** password → `403 "Account is temporarily locked. Try again in 13 minute(s)."`, no session cookie issued. Lockout: PRESENT / HTTP+DB. Step-up password failures share the same counter (`security.mfa.stepup.ts:73-115`, SRC).

## 9. Not exercised

| Item | Reason |
|---|---|
| Receipts (upload, thumbnail/ocr-image IDOR, receipt matched to a private txn) | Multipart upload not supported by `api.mjs`; time budget. Receipt GET by foreign id → 404; upload route is `requireRole("member")` (SRC). |
| Goal image / attachment download IDOR with a real file | No owner upload created; `/uploads` household-segment check verified with real on-disk files of another household (403) and attachments download with a foreign txn id (404). |
| Revoked-session check after password change over HTTP | Would need a second live session (extra login). SRC shows correct revocation in both tables. |
| Transfer/delete past the step-up gate for privacy/IDOR | Step-up gate returned 401 first; I did not step-up the member/outsider to keep auth calls minimal. |
| `POST /api/reports/custom` as view_only | Body failed validation; endpoint computes a read-only chart. |
| Search/autocomplete beyond `/transactions?search=` and `/merchants/autocomplete` | Command palette search not separately routed (no dedicated endpoint found). |

## 10. Summary table

| ID | Title | Sev |
|---|---|---|
| ISO-01 | Outsider reads any household's goal activity log (private txn name + amount) by goal id | P0 |
| PRIV-01 | Private-account txn exposed to other members via goal transactions/activity/summary | P0 |
| PRIV-02 | Private-account txn exposed via `/tags/:id/transactions` | P0 |
| PRIV-03 | Recurring rule from private txn exposed (name, amount, private accountId) | P0 |
| PRIV-05 | Root cause: two-level privacy model, many paths check only `transactions.is_private` | P0 driver |
| SEC-01 | Invite code is a bearer token; accepted by a user whose email differs (joined as admin) | P1 |
| SEC-02 | Invite email link `/invite/:code` has no client route; no accept UI | P1 (functional) |
| SEC-06 | Transfer-ownership to self leaves household ownerless | P1 |
| SES-01 | Session revoke / revoke-all do not invalidate the session store; revoked cookie still 200 | P1 |
| PRIV-04 | Member can rename a recurring rule on another member's private account and unlink their private goal link | P1 |
| SEC-04 | Timestamp skew: DB `now()` local vs JS UTC in `timestamp without time zone` columns | P2 |
| SEC-07 | Role endpoint allows multiple owners; co-owner can demote original owner | P2 |
| SES-02 | Session list shows `[]` while sessions live; `lastActiveAt` never updated | P2 |
| SES-05 | Reports analytics limiter double-mounted, effective 15/min shared bucket | P2 |
| VAL-01 | HTML injection in invitation email (household name / full name) | P2 |
| PRIV-06 | `GET /api/recurring/detect` → 500 | P2 |
| SEC-03, VAL-02, VAL-03, ISO-03, ISO-04 | 500s for malformed UUIDs / missing field / foreign attachments | P3 |
| ISO-02, SES-03, SES-04, SEC-05, SEC-08, SEC-09, PRIV-07, VAL-04 | Minor consistency / disclosure / design notes | P3 |

Acceptance tests to add (real HTTP + real Postgres): (1) member GET `/goals/:id/transactions|activity`, `/tags/:id/transactions`, `/recurring*` never contains a txn whose account is private to another user; (2) outsider GET `/goals/:id/activity` → 404; (3) accept invite with mismatched email → 403; (4) transfer-ownership to self → 400 and exactly one owner remains; role endpoint rejects `owner`; (5) after `DELETE /sessions/:id`, the corresponding `session` row is gone and that cookie gets 401.
