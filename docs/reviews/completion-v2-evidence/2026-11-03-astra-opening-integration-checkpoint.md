# Astra opening integration checkpoint — 3 November 2026

## Read first

This is a local continuation record, not campaign completion or release approval. The governing master remains `docs/plans/2026-10-15-master-completion-spec.md`; reconcile canonical `CAMPAIGN.md` before resuming. The owner restored Astra coordination/review, with two Sol Extra High implementation lanes and independent Astra High review. No push, PR, main merge, deployment, shared/production database change, paid provider or real external delivery is authorized.

- Canonical worktree: `C:/Users/USER/.codex/worktrees/capital-completion-v2/personal-finance-app`, branch `codex/capital-completion-v2`. The implementation was integrated at `95f7e5d7`; later checkout-policy/documentation commits do not change its application, schema or SQL blobs.
- Accepted local composition: `95f7e5d786226059a4066f97210364cec2f4f92f`, preserved branch `codex/r13-opening-form-protected-nov02`, worktree `C:/Users/USER/.codex/worktrees/capital-r08-fin17-base-check-nov02`. Independent Astra accepted the raw verification and approved the canonical fast-forward from `fcc67785`.
- Server author: `C:/Users/USER/.codex/worktrees/capital-r13-manual-holding-basis-nov02`, frozen `7400eeae` (source `336f44a9`; previous replay admission source `23174e01`). Frontend author: `C:/Users/USER/.codex/worktrees/capital-r13-opening-decimal-nov02/personal-finance-app`, frozen `1e07ab87`.

## Accepted canonical progress

The typed holdings missing-FX response was integrated at `8008830c`: missing conversion returns 422 only after current access is rechecked; revocation and source-conflict precedence remain intact. Source `2ff5dd44` passed 104 cases and the full project check; the exact-envelope followup passed all 28 signed cases. Opening precision/native denomination and zero-shell/gift/number-syntax compatibility were integrated at `fcc67785`, after independent review, 20 mounted cases and the full project check. These scoped integrations do not close full R12/R13.

## Accepted local composition and verified receipts

`95f7e5d7` contains atomic record-only opening BUY/lot provenance, source-consistent remaining basis, credential-bound create/update admission, protected no-op readback, immutable operation receipts, native-unit expectations and the shared opening form. Existing financial corrections are refused until a supported correction flow exists. Exact-key retry returns the original creation DTO, while later legitimate trades can change the live position. Replay witnesses the original acquisition rather than unrelated later private history. Unknown and zero native/base declarations remain distinct where economically different.

Independent Astra reviewed the immutable source pins, both merge-conflict resolutions and final raw receipts. All paths below are under the composition worktree:

| Receipt | Actual evidence |
| --- | --- |
| `.local/r13-resume-openingfinal36i` | Final-head 276/276 across eleven complete server suites, including existing FIFO/HTTP/holding privacy callers, 44 replay cases and four actual erasure cases. Fresh target; six-zero postflight. |
| `.local/r13-resume-openingbrowser36j` | Final-head Vite build and signed Chromium journey, retries disabled: commit succeeds, acknowledgement is dropped, actual holdings refetch removes the empty control, the header retries the same UUID/body, original 201 DTO returns, and reload/SQL show one holding/BUY/lot/receipt, two exact actor-only audits, cash 125 unchanged. Fresh target; six-zero postflight. |
| `.local/astra-check-openingfinal36k` | Final-head full `npm run check`, exit zero through its last configured check. |
| `.local/astra-openingcomposed36a` | 44/44 across four full frontend files at `aaa83655`. The entire frontend tree is byte-identical at the final composition. |

The browser's USD toggle proves a real refetch and page transition. It does **not** prove USD valuation: an existing client `baseCurrency` / server `currency` mismatch remains separate R12 work.

## Owner erasure decision

The owner explicitly selected **delete the erased member's retry records** while retaining shared financial history. Source `336f44a9` deletes only that actor's receipts across households, after marking the actor erased and within the same erasure transaction. The new guard permits that deletion or a physical parent cascade; it still rejects updates and ordinary active-actor deletion. Real erasure tests cover selective purge/peer replay/stale session denial, last-household cascade, actual purge failure rollback, and prohibited ordinary deletion. This settles the new operational receipt choice, not all OI-04 retention, backups or privacy-release decisions.

Migration `0026_r13_opening_operation_receipts.sql` is independently reviewed, adds one table, and preserves prior snapshot/journal entries. Exact reviewed LF SQL SHA-256: `e2cff1ebace55d089da92332cd292b4109197ecba1263406c971d86aca9b1d7c`. Git blob: `dcf5ea1ed87314effdc9d6e74fb95a1b3bc19faa`. Checkout CRLF was restored to this exact blob before the fresh final runs; the original checkout hash is preserved in `.local/erasure-source36i-sql-eol.json`.

## Populated migration acceptance and next action

The protected **populated 0025 → 0026 preservation gate is closed** by independent raw-evidence adjudication. Main alone executed the reviewed operator artifacts against the marked `openingupgrade36l` target on port 55432. Empty fresh bootstraps above remain separate evidence.

The first actual attempt remains recorded as exit 1: baseline bootstrap created the target with 26 migrations; seed sealed nine complete source tables at aggregate SHA-256 `0934f21424b9b3d4690cb054a34d23cd8c5b879dc791e3003efeca6fae93d040`. The migration applied, then its collector failed before writing `after.json` because PostgreSQL 18 reports nine additional NOT NULL catalog constraints. Original operator SHA `9bd638624b82cfc4cc7ec176684f44e68043bd7a9e226050233e04fee8917079`, before packet, staged SQL bytes and failed receipts remain unchanged. No migration was repeated.

A separately reviewed verifier, SHA-256 `eed9aa6ec79d4cf1217c65b1b3c25cff6a38feb8f35587a4361909439b3c1b20`, then ran successfully in a repeatable-read, read-only transaction. It confirmed the same database OID `1715478` and marker, all nine complete source-table hashes/counts unchanged, all 26 prior migration rows unchanged, the reviewed 27th migration, zero inferred receipts, five exact core constraints, nine validated single-column NOT NULL constraints and the expected guard/trigger. Packet `.local/r13-populated-openingupgrade36l/verify-pg18-1793661657706.json` has SHA-256 `9b6a168a9eb336420381e096dab00959106bca5935e8c126a25706abe7d009ce`; its wrapper receipt and six-zero postflight are under `.local/r13-resume-openingupgrade36l/`. This successful read-only verification supplies the corrected post-upgrade evidence; the original apply wrapper is still a failure record.

The reviewed composition was fast-forwarded locally to canonical. Followup `c2efd7d8` pins LF only for migration 0026, with a `core.autocrlf=true` checkout proof retaining the exact reviewed SQL hash; older migration inputs are unchanged. Do not rerun the historical operator unchanged: canonical has advanced beyond its pinned baseline. The full goal and automation remain active, and no production readiness follows. The next bounded implementation is holding DELETE lifecycle/authority and its real bodyless 204 caller; see below.

## Requirements still open and next dependency-ready work

- General holding DELETE remains under the old custody/history contract. Current actor/session authority and atomic audit must protect it; positive, fully disposed, originally positive and otherwise posted positions must retain their BUY/lot/cash history. A supported history-free zero shell needs genuine success controls. The exported hook currently parses JSON from bodyless 204 and has no mounted control; real hook/cache, visible control and same-key deletion acknowledgement are separate requirements. The replay test's old HTTP deletion behavior is not the final lifecycle policy; use a synthetic direct-DB damage fixture to retain its missing-position replay oracle when that route is repaired.
- Legacy acquisition reconciliation, supported financial corrections, private acquisition-basis aggregate egress and complete valuation provenance remain open.
- R12 read-only inventory found holdings and portfolio-summary currency alias/metadata mismatches; performance snapshots/flows lack coherent unit provenance; FX attribution mixes asset denomination with ZMW monetary values and user formatting; FX-history envelope/cache-limit handling differs. No implementation or runtime clearance exists for that inventory. Avoid relabelling unconverted values.
- SIP source `7d90fd8f` remains held. Read-only composition analysis suggests the new manual remaining-basis helper addresses ordinary sale→next-SIP cost drift and prevents a newer lot masking an unsupported legacy opening. These need actual composed tests before clearing findings. New declared opening FX evidence survives in its original BUY/lot; carrying old aggregate FX into an enlarged total would be wrong. Legacy aggregate-only FX preservation, private-plan mandates/current authority, and overdue occurrence identity remain real work. Preserve SIP's `recordPurchaseLot` helper and broader dated-trade history signature when composing; do not replace whole trees.

Failed evidence remains preserved: opening edit baseline 35q (3/11 failures), stale aggregate 35s (3/15), declaration origin 35v (3/18), receipt baseline 35x (19/28), original-source/snapshot 36b (8/36), selected ZMW 36c (4 failures, one pass, 36 skipped), selected semantic replay 36e (one failure, 43 skipped), and actual erasure baseline 36h (two failures, two passes). These are distinct baselines, not final failures or broader test claims.
