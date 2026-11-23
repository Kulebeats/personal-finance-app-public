# Skeptic pass: attempt to refute the 2026-10-13 readiness package

Role: adversarial skeptic (Opus 5.5), no stake in the verdict. Revision `main` @ 381e943. Audit server http://localhost:5055, DB `finance_app_audit_fable_20261013`. Run 2026-10-14 00:47–01:15 Lusaka.
Read: README, GAPS, COMPLETION_SPEC, LAUNCH_PLAN, COVERAGE, EVIDENCE, DECISIONS, `evidence/findings-draft.md`, `evidence/domain-*.md` (security-privacy and reports in full, the others at their finding tables).

**Bottom line.** I could not refute the verdict. Every P0 I re-ran reproduced, and a ledger-wide reconciliation found no balance drift. What I can refute is the package's internal bookkeeping. The effort sums do not add up. The "smallest safe pilot" leaves out several items GAPS marks **Must**. COVERAGE still marks surfaces PRESENT after GAPS records P0/P1 defects in them. EVIDENCE and COVERAGE still carry an F-TXN-01 root cause that the findings draft withdrew. Finding IDs collide across domain reports. The plan's weekday labels are wrong for 2026. None of this changes NO-GO. All of it should be fixed before the owner compares packages.

## Disclosures (my own side effects)

| What | Effect |
|---|---|
| By mistake I ran a loop of 8 `GET /api/auth/me` calls (output suppressed) while checking the jars, against the brief's "do not call /api/auth/*" | Used part of the per-IP auth limiter budget for about a minute. Created no users and made no logins |
| To re-test PRIV-* I re-joined `a5member` to the A5 household: `a5owner` (admin) `POST /api/household/invite` → 201, then `a5member` `POST /api/household/invite/accept {"inviteCode":…}` → 200 role member | A5 now has 2 members again (it was ownerless and single-member after the security verifier's SEC-06 test) |
| For IMP-01 I created account `SKEPTIC IMP01 Checking` (`2bd77a8a-f325-4005-9456-43b6c40f06ec`) in the a2 household and ran two imports into it | 3 rows, all now soft-deleted. Balance 500.00. The verifier's own evidence accounts were not touched |

## 1. Verdict attack: the seven P0 rows

### 1a. Does the cited evidence exist?

| P0 | Evidence cited in GAPS | Present in evidence files? | Re-run by me |
|---|---|---|---|
| ISO-01 | domain-security-privacy §4: request, body excerpt, `goals.controller.ts:359-369`; scripts `i2.mjs`/`i3.mjs` | Yes | **Yes, reproduced** |
| PRIV-01..05 | same report §2: marker scan `p2.mjs`/`p5.mjs`, DB read-back of `is_private=false` | Yes | **Yes, reproduced** (PRIV-02, PRIV-03, PRIV-01 activity and summary) |
| IMP-01 | domain-import §IMP-01: runs 1 and 3, `exec2_prioritize_*.json`, `a.sh` | Yes | **Yes, reproduced on a fresh account** |
| GRZ-01 | domain-investments: exact `pay` request and SQL | Yes (request and SQL given, ids truncated `783971ea-…`) | Not re-run |
| GRZ-02 | same, `pay` after `PUT /bonds/:id/sell` | Yes (ids truncated) | Not re-run |
| RC-01 | domain-reports RC-01 row + `AnalyticsRatiosRepository.ts:46-81,185-216` | Yes | **Yes, reproduced** |
| F-OPS-01 | findings-draft F-OPS-01 (SRC) | Yes, SRC only | Confirmed by source: `render.yaml` defines only a web service, Key Value and Postgres. `server/scheduler.ts:123,135,148` schedules only three node-cron jobs (08:00 daily, 02:00 daily, Monday 09:00); none calls recurring, rollover, snapshots or FX |

### 1b. Live re-verification (exact requests and responses)

**ISO-01: reproduced.** Outsider in a different household (`13700fb7-…` "A5 Outsider Household"):
```
MSYS_NO_PATHCONV=1 node .local/readiness-fable-2026-10-13/api.mjs a5outsider GET /api/goals/95e6270b-582a-4076-b700-066cd9670832/activity
→ 200 {"success":true,"data":[ … {"activityType":"transaction_unlinked","amount":"777.77",
   "metadata":{"transactionId":"fa7a446c-…","transactionName":"PRIVSECRET"},"createdBy":"1fd941b7-…"}, … ]}
control: a5outsider GET /api/goals/95e6270b-… → 404 "Goal not found not found"
```
The same outsider gets 404 on the goal itself but 200 on its activity. This is a cross-tenant read. (Side note: the 404 message says "not found not found", a P3 string bug.)

**PRIV-01/02/03: reproduced** (`a5member`, role member, same household; owner as control). A marker scan for `PRIVSECRET|pwn|777.77|ce6d5a98|fa7a446c|Vault`:

| GET (member) | Status | Private markers in body |
|---|---|---|
| `/api/goals/95e6…/activity` | 200 | `PRIVSECRET`×2, `777.77`×4, `fa7a446c`×2 |
| `/api/goals/summary` | 200 | `777.77`×2 (recent activity entries for the private txn) |
| `/api/tags/9f79…/transactions` | 200 | `{"id":"fa7a446c-…","name":"PRIVSECRET","amount":"777.77"}` |
| `/api/recurring`, `/recurring/7054…`, `/transactions`, `/history` | 200 ×4 | private `accountId ce6d5a98`, `777.77`, `PRIVSECRET` (history), rule name `pwn` (renamed by the verifier's PRIV-04 write) |
| `/api/goals/95e6…/transactions` | 200 | none (the verifier's PRIV-04 unlink removed the link, so this path can't be re-observed now) |
| controls: `/api/transactions/fa7a446c…`, `/api/accounts/ce6d5a98…` | 404 / 404 | none (direct reads correctly hidden) |

**RC-01: reproduced, but GAPS describes it wrongly.** Household a4:
```
a4 GET "/api/reports/ratios?startDate=2026-10-01&endDate=2026-10-31"
→ 200 … "liquidAssets":{"amount":"40202.92","currency":"ZMW"}, "monthlyDebt":{"amount":"37.88"} …
DB accounts: Checking ZMW 36840.26, Private ZMW 287.66, Savings ZMW 3000.00, USD 75.00, Credit 454.50
hand: 36840.26 + 287.66 + 3000.00 + 75.00 = 40202.92  → USD 75 added as 75 ZMW
correct at the latest USD→ZMW rate 26.5000 (dated 2026-10-13, present in fx_rates): 40127.92 + 1987.50 = 42115.42
```
GAPS frames RC-01 as "Missing FX rate fails closed" and EVIDENCE calls it "silent FX". In fact the rates **exist** (4 rows in `fx_rates`). The ratios/debt queries never convert at all. Adding `assertFxRatesAvailable`, the guard WP-07 item 1 names, would not fix this case. The conversion via `fxRateExpr` is the essential part. The acceptance test (`/ratios` with no rate → 422) does not prove conversion either. It needs the "USD 100 at rate 25 → 3500.00" case from the reports report.

**IMP-01: reproduced on a new account** (a2 household, account `2bd77a8a-…`, initial 500.00). Rows: 2026-07-01 −100.00, 2026-07-02 +1000.00, 2026-07-03 −25.00. Expected after any number of imports: 1375.00.
```
POST /api/import/execute {"targetAccountId":"2bd77a8a-…","strategy":"prioritize_coppercoin",…3 rows}
→ 200 {"imported":3,"skipped":0,"deleted":0,"errors":[]}   DB balance 1375.00, 3 live rows
POST /api/import/execute {… "strategy":"prioritize_csv", same 3 rows}            ("Overwrite & Import")
→ 200 {"imported":0,"skipped":3,"deleted":3,"errors":[]}   DB balance 500.00, 3 rows deleted_at set, GET /api/transactions?accountId=… → 0 rows
```
Confirmed: the ledger loses data and the balance is wrong. One nuance: the response does say `imported 0, deleted 3`, so the API is not literally silent. Whether the UI surfaces that is unverified.

**Ledger-core cross-check (supports the package).** A read-only reconciliation over every audit account (21 accounts, 89 transactions, 18 soft-deleted, 7 households) compared `balance` with `initial_balance + Σ live (income − expense ± transfer leg)`. Zero rows drifted. The credit card also reconciles under the *asset* sign convention, which independently confirms RC-03: liabilities are stored with the asset sign.

**Severity challenges (not refutations).**
- **RC-01 as P0 doesn't match how BGR-01 is rated.** Both put a USD amount into a ZMW aggregate at 1.0, but RC-01 is P0 and BGR-01 (budgets, which a user acts on monthly) is P1. RC-01 is a read-only derived ratio that is never persisted. By GAPS §1's own definition ("security, privacy, money corruption, data loss") it is P1. If it stays P0, BGR-01 should too.
- **GRZ-01 "creates money" depends on the holdings-only decision.** If the user records the purchase outflow by hand (the logical consequence of ASM-06), crediting cash at maturity is real cash. The defect is then *classification* (income instead of return of capital) and possible double counting with the bond's holding value. It is still a launch blocker if GRZ is enabled, but the wording overstates it. GRZ is hidden for the pilot anyway.
- **F-OPS-01 is P0 on source evidence alone.** That is legitimate, but it is the only P0 nobody executed. The proof needed is a staging cron run, already listed in DECISIONS §4.

## 2. Over-claims

| # | Claim (exact string, file) | Problem | Evidence |
|---|---|---|---|
| O1 | README Q1 and GAPS §5: "37 view-only writes denied" / "37 view_only writes to shared financial data denied" | The verifier sent 37 writes and **4 returned 2xx** (`POST /reports/exports`, `POST /weekly-recap/generate`, `PATCH /weekly-recap/settings`, `PUT /notifications/read-all`) | domain-security §3 |
| O2 | GAPS F-SEC-01 row: "`POST /api/import/execute` … lack `requireRole` (verifier: …)", Verif "HTTP", P1. WP-01 G/W/T requires `import/execute` → 403 for view_only | The verifier observed `import/execute` **already returns 403** for view_only (in-handler check, `routes/import.ts:138`). It wrote "**No P1 view_only finding**" and rated the rest SEC-05 **P3**. The findings draft still has F-SEC-01 as "SRC (runtime check pending)". GAPS upgraded it to P1/HTTP without new evidence | domain-security §3; findings-draft line 22 |
| O3 | README Q1: "Verified by 21 browser journeys with database read-back" | R18 is curl, R19 is a scripted HTTP run, R20 says "file upload not exercised". R8, R12, R13, R15 and R16 have no DB read-back. About 13 of 21 are browser + DB | EVIDENCE §4 |
| O4 | GAPS §5 Platform: "every limiter uses Redis when configured" and "all 12 tools pass the sanitiser" listed as "verifiably works" | Both are **SRC only**. Redis was not configured (EVIDENCE §2), and the settings verifier labels sanitiser coverage "(SRC)" | EVIDENCE §2; domain-settings line 60 |
| O5 | README Q1: "outsider denied on every id-based endpoint but one" | ISO-02: `/transactions/:id/goals` and `/recurring/:id/history|transactions` return **200 `[]`** for foreign ids. ISO-03: foreign attachments return **500** (not a leak, but not denied either) | domain-security §4 |
| O6 | COVERAGE §10: "Profile / display / notifications / preferences / … every offered field persists \| **PRESENT**" | Contradicts SET-01 ("drops 14 of ~22 form fields") and SET-02 ("MISSING"), which GAPS rates P1 Must | GAPS §2d |
| O7 | COVERAGE §3: "Transactions summary panel … BROWSER+HTTP: excludes `endDate` day"; EVIDENCE R6: "(F-TXN-01: `endDate` exclusive)" | The findings draft withdrew this: "Root cause is NOT an exclusive `endDate` (re-tested 2026-10-13T23:05Z)". Two package files still carry the refuted cause | findings-draft line 30 |
| O8 | COVERAGE §7: "Multi-currency / FX \| fail closed on missing rate \| PRESENT (design)" | RC-01 (no conversion at all), RC-06 (summary uses the latest rather than the dated rate, and returns 200 where reports fail closed) and RC-07 (recap zeros) contradict "PRESENT" | domain-reports |
| O9 | COVERAGE marks Private accounts and Cross-household isolation "PRESENT (core)", and CSV import, Receipts, Holdings, Account deletion, Budget create/…/recalc/rollover and Weekly recap "PRESENT" | Each has a P0 or P1 in GAPS (PRIV/ISO, IMP-01, RCP-01/02, INV-01..03, DEL-01/02, BGR-01..03, RC-07). Under the package's own legend these are PARTIAL | GAPS §1–2 |
| O10 | COVERAGE §10: "Password change \| PRESENT \| verifier security/settings" | The security verifier says it was "Not exercised over HTTP" (SRC). The settings verifier did exercise it (`PUT /password` after step-up → 200), so this is supportable, but only via the settings report | domain-security §5; domain-settings line 111 |
| O11 | COVERAGE §3: "Split transactions … verifier budgets (split counted once?)" | An unresolved question mark left in a verification cell. The budgets report does verify it (lines 24-25, PASS), so the cell should say so | domain-BGR |

## 3. Under-claims and downgrades

No domain P0 or P1 is missing from GAPS. Everything is present, sometimes folded into another row. Downgrades and silent merges:

| Domain ID (sev) | In GAPS | Note |
|---|---|---|
| PRIV-04 (P1, write: member renames a private rule, unlinks a private goal link) | folded into the P0 PRIV row | fine, but it is a *write* integrity issue and WP-01's G/W/T has no write case for it |
| GRZ-04 (P2) | folded into the P0 GRZ-02 row | effectively an upgrade |
| RUL-01 (P1) | folded into ORG-02 "Should" | fine |
| PEN-01 (P1, pension balance corrupted by unvalidated totals/negatives) | inside "INV-10 / pension", Hide or Must | fine |
| SEC-07 (P2: role endpoint creates a second owner who can demote the original) | P2 | arguably P1 with SEC-06, since both produce unrecoverable ownership states. WP-04 fixes transfer but not the `PUT /members/:id/role {role:"owner"}` path |
| DEL-02 | P1 in GAPS | the settings report's table says **P2** while its own summary line 159 says P1. The report contradicts itself |
| Domain P1 counts | GAPS §0 says investments 13 P1, reports 8 P1, import 6 P1, lead 14 P1 | I count 12 (11 GRZ/INV + PEN-01), 7 (RC-02..08), 7 (IMP-02/03, RCP-01/02, RUL-01, ORG-01/02) and about 21 F-* P1 rows in GAPS §2. The §0 table can't be reproduced from the rows |

## 4. Consistency

**4a. ID collisions break traceability.** The README promises "stable IDs", but they collide:
- **SEC-01** is invite-acceptance in the security report and fresh-browser e-mail verification in the settings report. GAPS F-AUTH-04 cites "settings verifier SEC-01", while GAPS SEC-01 is the invite row.
- **SEC-02** is the invite link in the security report and e-mail/password-change notices in the settings report. GAPS uses both.
- **REC-01..04** are recurring findings in the budgets report and recap findings in the settings report. GAPS P2 has "REC-03 one missed occurrence per run" next to "REC-03 recap e-mail labels ZMW as $".

COMPLETION_SPEC traceability maps "SEC-01/02/06" to WP-04 and "REC-02/03/04" to WP-08, so the settings-report SEC-01 (verify-email CSRF, really WP-02) and the recap REC items (really WP-10/16) are mis-routed.

**4b. GAPS → WP mapping.** Every P0/P1 maps to a packet. Gaps: PRIV-04 writes have no G/W/T; SEC-07 is not covered by WP-04's in-scope list; RC-01's G/W/T doesn't test conversion (see §1b).

**4c. "Must" rows missing from the pilot scope** (LAUNCH_PLAN §2/§5, README Q4):

| GAPS row marked **Must** | Packet / item | In the "smallest safe pilot"? |
|---|---|---|
| RC-03/RC-04 credit-card accounting | WP-07 item 2 | **No** (only items 1, 3, 4, 5) |
| BGR-01 budgets count USD as kwacha | WP-07 item 6 | **No** |
| SET-01 profile fields dropped, SET-02 preferences no-op | WP-10 | **No** (LAUNCH_PLAN §5 pilot condition list omits WP-10) |
| DEL-02 PII retained after erasure / audit history deleted | WP-11 | **No** (DEL-01 is covered via WP-03) |
| RC-13 (Should) | WP-11 | No (consistent with Should) |

LAUNCH_PLAN §5 says "Go/no-go is binary on the pilot conditions", yet those conditions would allow a launch with four open "Must" rows. Either the rows should be relabelled (Should, or Hide budgets' multi-currency, for example) or the scope enlarged. DECISIONS ASM-02 adds to the confusion: it calls F-HH-01 and F-MOB-01 "P0 for a pilot", while GAPS lists both as P1.

**4d. DECISIONS §5 acceptance checks** cover 12 items, one of them P2 (F-DATE-01). They cover **none of the seven P0s** (ISO-01, PRIV-*, IMP-01, GRZ-01/02, RC-01, and F-OPS-01 only as #9). They also miss these Must P1s: SEC-01, SEC-06, SES-01, BGR-01, BGR-03, RC-02/03/04/05, IMP-02/03, SET-01/02, DEL-01/02, F-OPS-02/06/07. COMPLETION_SPEC's G/W/T blocks do cover most of them, so §5 is incomplete rather than wrong. It should point to them, or list one check per blocker.

## 5. How the product could still fail (hypotheses not covered by the package)

| # | Hypothesis | First test (file:line / endpoint) |
|---|---|---|
| H1 | **The local environment doesn't match production on time zones.** The host is Africa/Lusaka and the DB session TimeZone is Africa/Johannesburg, but Render is UTC. SEC-04 and F-DATE-01 (DB `now()` vs JS UTC in `timestamp without time zone`) may vanish on Render while other date bugs appear, e.g. raw `pg` reads of `date` columns, which `q.mjs` shows as `2026-06-30T22:00Z` for a 2026-07-01 row. The package's date findings and fixes are calibrated to the wrong TZ | Re-run the reports and GRZ verifier fixtures against an audit DB with `ALTER DATABASE … SET timezone='UTC'` and `TZ=UTC` on the server. Compare month buckets, coupon dates and `/weekly-recap` windows |
| H2 | **WP-09h (404 on `/api/investments/*`) removes the only way to enter FX rates.** `POST /api/investments/fx-rates` (`investments.service.ts:242-255`) is also the RC-02 write vector. With it hidden, a USD account has no rate source except the external market job, so every report fails closed with 500s (RC-10) for multi-currency households | Enable the WP-09h flag in a branch, create a USD account, and call `/api/reports/cashflow` and `/api/accounts/summary` |
| H3 | **Editing transactions isn't covered.** The "ledger core is sound" claim rests on create, transfer and import. Edits of amount, account or type and single deletes (no UI control) weren't hand-checked. My reconciliation shows no drift *on the paths that were exercised* | `PUT /api/transactions/:id` changing `accountId` and `amount`; `DELETE` after step-up; then the reconciliation SQL in §1b (`server/services/transaction/service.ts:208-240`) |
| H4 | **WP-13's proposed generalLimiter "300/min per user" interacts with the Redis store.** Today's double-mount shares one prefix, so with Redis in production each request counts twice cluster-wide. A fix that dedupes in-memory mounts but not the Redis key prefix keeps the self-inflicted 429 | `server/middleware/rateLimit.ts:42-83` (store prefixes) and `routes.ts:112,142`; load the dashboard against a Redis-backed instance and read `ratelimit-remaining` |
| H5 | **The raw invite bearer code leaks outside the e-mail.** `POST /api/household/invite` returns the raw 64-hex code to the caller (observed today: `"inviteUrl":"/invite/a6f4…"`). It therefore sits in browser devtools, client logs and any proxy log. Until the SEC-01 recipient binding ships, that copy is as good as the e-mail. WP-04 should both bind acceptance to the verified recipient e-mail and stop returning the code (or prove that binding makes it harmless) | `server/modules/household/invitations.controller.ts:158,228-290`; after WP-04, accept a code with a mismatched verified e-mail → expect 403/409 |

## 6. Date and effort arithmetic (LAUNCH_PLAN §1)

Packet ranges from COMPLETION_SPEC, summed by hand:

| Scope (LAUNCH_PLAN §1) | Claimed | My sum | Note |
|---|---|---|---|
| Full, WP-01…16 with WP-09 full | 46–62 | **44–64** | 3+1+1+3+3+2+6+3+6+2+3+3+1+2+3+2 = 44; 5+2+2+4+4+4+9+4+8+3+4+5+1+3+3+3 = 64 |
| Pilot, investments hidden (15 packets incl. WP-09h 0.5) | 37–51 | **36.5–53.5** | the high end is understated by 2.5 days |
| Smallest safe pilot (13 packets) | 24–34 | **≥ 22.5–33.5 before any WP-07/WP-08 work** | WP-01/02/03/04/05/06/09h/12/13/14/15 alone = 22.5–33.5. That leaves 1.5 (low) and 0.5 (high) days for WP-07 items 1, 3, 4, 5 (item 1 includes a schema migration and 7 repositories) plus the WP-08 recurring form. A realistic estimate is about **28–41** |
| README "Public multi-household launch: 37–62 developer-days" | — | mixes rows | 37 is the pilot-hidden low and 62 the full-product high. The public launch needs WP-09 (or removal) and WP-16, so ~44–64 |

Calendar (2026): **15 Oct is a Thursday and 17 Oct is a Saturday.**
- LAUNCH_PLAN §3 "Wed 15 – Fri 17 Oct" and README action 1 "by Friday 17 October" are wrong. The working days are Thu 15 – Fri 16 Oct.
- §1's "20 working days between Thursday 15 October and Wednesday 11 November" is correct if launch day counts: 2 + 5 + 5 + 5 + 3.
- Plan B "15–17 Oct" holds 2 working days, but schedules decisions + WP-13 (1) + WP-09h (0.5) + WP-06 (2–4) = 3.5–5.5 days.
- Plan B's 19–30 Oct (10 days) holds WP-01 + 02 + 03 + 05 + staging = 8–13 days plus OPS.
- 4 Dec is working day 37 from 15 Oct. The smallest scope at its high end (34, or ~41 by my estimate) plus 3 days of UAT plus launch puts the one-developer date around **7–16 December**, not 4 December. Plan B also schedules WP-10 and WP-07 item 2, which are outside the smallest scope.
- Plan A gives WP-12 "1 day" against a 3–5 day packet. Dev A carries WP-13, 09h, 01, 03, 05, 12, WP-07 items and WP-15 = about 16–28 days in the 15 working days before the 4 Nov freeze. It fits only at the low end, which supports the package's own "realistic 18 November" caveat rather than the 11 November stretch.

## 7. What survives

The NO-GO verdict, the seven P0 rows (four reproduced live today, one confirmed in source, two with intact evidence) and the "ledger core is sound" claim (zero drift across 21 accounts) all survive. The fixes needed are editorial and planning ones: the effort sums, the pilot scope versus "Must" rows, COVERAGE labels, the stale F-TXN-01 cause, the ID collisions, the RC-01 framing and acceptance test, the F-SEC-01 evidence and severity, and the weekday labels.
