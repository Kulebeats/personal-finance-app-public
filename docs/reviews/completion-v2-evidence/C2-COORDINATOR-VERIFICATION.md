# C2 coordinator verification — 31 October 2026

Candidate: `7bf99d17a7ed5cffcd29a79d10b53b904e8d3f9b`, branch
`codex/c2-review-remediation`, isolated checkout
`C:\Users\USER\.codex\worktrees\c2-review-remediation`.
No C2 application source is integrated into canonical. Read that checkout's
C2-REMEDIATION.md and C2-HANDOFF.md for source changes and outstanding proposals.

## Evidence scope

The author supplied 81 server and 67 client unit/component passes. Parent inspected
those raw logs, then independently ran `npm run check` on the clean candidate:
exit0, TypeScript and all repository guards passed. Check log SHA256:
`187c753bee9d689346a2afa1f54ef9af11a55aaff3d1412f6a320ee6d4c7078e`.
That check is distinct from independent code-review acceptance, still pending.

Parent subsequently executed three serialized protected PostgreSQL/HTTP runs on
the exact unchanged candidate using Node24.22.0 ARM64 SHA256
`df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0`.
Each command used `scripts/run-protected-tests.mjs database vitest --server run`
with `--maxWorkers=1` and the explicit marked target below.

| Files / scope | Actual result | Raw log SHA256 |
| --- | --- | --- |
| `routes/__tests__/import.execute.realdb.integration.test.ts` | 7/7 passed, 90.03s, exit0 | `58d19cd58eb705f72cfda18e4308e87c19889150a677174d4f2579f6b2308ed6` |
| `modules/tags/__tests__/completion-c2.cross-writers.realdb.integration.test.ts`, `completion-r04.tag-writes.realdb.integration.test.ts`, `completion-r04.tag-write-races.realdb.integration.test.ts` | 55/55 passed, 66.36s, exit0 | `7851086a01c3ec9676f5aa65061317cd2230d37d8ab8739e523da501fed68ed3` |
| `routes/__tests__/completion-r01.email-lifecycle.realdb.integration.test.ts`, `security.email-tokens-hashed.realdb.integration.test.ts` | 27/27 passed, 74.28s, exit0 | `b4d05c9d913006eba5c3df9891f28222ac81b042c24bb8a7c7fdeddeb35965b0` |

Total: 89 tests across six files. Mail boundaries are mocked and the protected
network guard denies external dispatch; these are not real email-delivery tests.
The node-cron missing-source sourcemap warning was nonfatal and remains in logs.

Import evidence includes Professional/view-only403 with zero transaction rows
and unchanged balance; owner/admin/member successful import and malformed-row
handling; another member's private account404; visible-only overwrite with
balance reversal and audit. It does not certify every financial writer or R08.

Tag evidence includes bulk-to-single editing across roles, receipt-to-single
editing with duplicate retry, mismatch rollback and independent SQL link/counter
readback, plus the existing writer and actual database lock/race controls. It
does not reconcile historical mismatches or certify every legacy tag producer.

Email evidence covers existing lifecycle/token flows and the adapted sequential
cooldown429/rotation assertions. A true concurrent cross-entry resend issuance
test and real rate-limiter acceptance remain missing, as the author disclosed.

## Isolated target and process ownership

The existing owned `.local/completion-pg` cluster was initially stopped, with no
pidfile or listener on55432. Parent started only that cluster, bound to127.0.0.1
port55432 and timezoneUTC. Independent maintenance readback confirmed PostgreSQL
18.6 and the expected endpoint before creation. Shared5432 was not connected.

The launcher retained a redirected native pipe after pg_ctl had exited. Its exact
PowerShell PID30288 was verified and stopped alone; the already-running owned
PostgreSQL PID34704 was independently checked and not restarted. Original launcher
session62219 ended -1; this is not a successful launcher exit claim. The start log,
explicit pg_ctl status and maintenance identity provide separate startup evidence.

Guarded absent-only bootstrap created `pfa_completion_review_c2oct31a1_test`, run
`c2oct31a1`, with marker
`pfa-synthetic-test:v1:c2oct31a1:pfa_completion_review_c2oct31a1_test`.
It applied15 journaled migrations, exit0. No R14 proposed0015 migration is in this
candidate. Manifest SHA256:
`cc7c7b105f657dc368d8e236449281bddf0bd8b024dc27bb3967ae8bec96432d`.

Evidence packet in the C2 checkout:
`.local/c2/coordinator-db-oct31a/` contains target, bootstrap/identity records,
per-run pre/result/log files, source pins, verification and cleanup records.
All changed-candidate source pins matched after testing and Git stayed clean.
Independent final readback confirmed marker, endpoint, UTC and15 migrations;
users, households, transactions, tags and transaction_tags each had zero rows,
and no other client remained connected to the target. This does not assert every
database table is empty. The disposable target is retained for evidence.

Parent stopped only the identity-checked owned postmaster using pg_ctl; exit0,
pidfile absent and55432 listener count0. All test handles were polled to terminal.

## Remaining acceptance gates

- Independent source/security review, including credential error classification,
  tag lock order/duplicate audit representation, and cooldown TTL assumptions.
- Real browser wrong-password, two-tab rejected-auth, Radix typeahead and
  Firefox/WebKit download behavior; current unit tests do not prove these.
- Concurrent public/authenticated resend proof and limiter verification.
- Outstanding C2 cache/lifecycle/Redis findings and required design adjudications.
- Exact reviewed canonical integration and any affected build/broader checks.
- All campaign, shared-database, external delivery, deployment and release gates.

No source correction was made by these runs. No push, PR, main merge, production
database change, real email or deployment occurred. These results add bounded
HTTP/persistence evidence; they do not close the full C2 review or a campaign group.

## Corrective candidate d6ee653a, 31 October 2026

The authorized review handoff returned four committed source corrections at clean
`d6ee653a7bfea077c9dd66f7aaf0205a84d1da1d`; source/test head is `9e490237`,
with documentation only afterward. Independent Sol general and TypeScript reviews
and Astra High final source review cleared the four findings: mutation-cache
credential rejection, post-rotation login failure broadcasting, duplicate bulk
audit/IP propagation, and challenge expiry minted before lock admission. This
supersedes the source-review gate above for this bounded candidate only.

Author protected UNIT selections total 100 distinct passes: 41 client, 19 server,
40 old-caller tests. Real authentication methods run over synthetic persistence
and session adapters; these are not browser or database evidence. Failed RED logs
are retained. Historical 89 database passes above do not certify the correction.

Fresh coordinator runs with pinned Node 24.22.0 all exited zero:

- `npm run check`; log SHA256
  `187c753bee9d689346a2afa1f54ef9af11a55aaff3d1412f6a320ee6d4c7078e`.
- `npm run build`; log SHA256
  `bd3c9b5b862fceb50eecfcdcfd86b748e8bde319df96bcacbb7346b132c43948`.
  The standard build produced 170 files; this is not R20 installed-profile proof.
- Explicit browser/config TypeScript check; empty log SHA256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

Receipts and output pins are retained in the C2 checkout at
`.local/c2-sol/coordinator-final-d6ee653a/`. All 44 receipt-bound source hashes
matched after the checks; the checkout remained clean. The final author chat
snapshot confirms completed/idle with its handoff returned.

Fresh corrected-candidate database/browser tests, canonical integration and full
C2 acceptance remain outstanding. C2-04/07/08/09/12/13/15/16 and inherited ledger
issues remain open. The earlier automatic approval review rejected the proposed
local runtime startup as "blocked by policy"; no retry has been executed.
