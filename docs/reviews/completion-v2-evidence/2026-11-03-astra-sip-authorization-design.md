# SIP authorization design and concrete erasure choice — 3 November 2026

Status: design accepted for preparation only. Product/schema implementation remains held pending the owner retention decision below and subsequent source assignment/review. No migration number is reserved. This document does not authorize overdue scheduling policy, canonical SIP integration or release.

The owner restored Astra review/orchestration in this chat. This design follows independent read-only inspection of canonical `bb0c0b98dfa60256f94c555b88cf83c4d9924472`, the current master/CAMPAIGN, actual authorization/privacy/session/erasure/audit code, and the held plan's Slice B. Read [the full-delta hold](2026-11-03-astra-sip-full-delta-addendum.md) first. No product, SQL or runtime command was executed by this reviewer.

## Independently verified private-caller RED

Test-only pin `48ec7d4954b549c98707e1274cdeeb11655a3d9f` in `C:/Users/USER/.codex/worktrees/capital-sip-private-caller-red-nov03/personal-finance-app` changes only the 200-line signed-caller test and its plan, based on `ab290d58`. Generic/TypeScript fixture review found no blocking defect. Installed Supertest types support the response type and indexed methods used. Every plan comes from actual authenticated POST; no author or mandate is DB-attested.

Raw `.local/astra-sip-private-red39f` was independently inspected after execution. It records one shared positive pass, four intended failures, zero pending/todo, command exit 1, matching clean source PRE/POST, pinned Node 24.22.0, target OID `1819299`, exact `sipprivatered39f` marker, 28 migrations, all six primary and nine scope counters zero. All 19 evidence-manifest hashes match recalculation.

| Actual case | Observed result |
|---|---|
| Signed shared owner POST and real executor | PASS: fixed price 2 and amount 10 produce five shares, one BUY/lot, system audit, success log, advancing schedule, unchanged cash and no repeated effect. |
| Signed private owner POST and real executor | POST succeeds, executor refuses; no holding/BUY/lot, schedule unchanged and retry fails again. |
| Peer private-account POST | Returns 200 and persists an unauthorized plan; absent-account control returns 500 instead of required opaque 404. |
| Peer list | Returns the owner's private plan/account identifiers in addition to the legitimate shared positive control. |
| Peer deactivate | Returns 200 and deactivates the owner's private plan; absent-plan control returns 500 instead of required opaque 404. |

These are actual source-path failures, not setup/type failures. The shared positive proves the fixture reaches real execution. The author/read/deactivate privacy gaps are confirmed parts of the same held SIP repair; the newer private-account refusal does not make them safe or complete. Four failing test cases are not four independent packets. SIP remains held despite earlier scoped green suites.

## Decisions available from the specification and current code

1. Support the legitimate private owner's plan. Membership, financial capability and source visibility apply independently; household owners/admins never override another person's private account.
2. Record the actual user who authorizes a plan. An old plan, account owner, household owner, purchase creator or retained audit cannot supply a missing mandate actor.
3. Interactive create/reconfirm/deactivate captures the original authenticated user/SID/generation before awaits and rechecks under transaction locks. Reuse `investmentTransactionAccess.ts::lockInvestmentWriterIdentity` with the captured session. Do not substitute a newer credential after a failed snapshot check.
4. Background execution uses a durable authorization plus current identity/grants/source checks, not a fabricated SID or a requirement to keep the original login alive.
5. Ordinary logout, expiry and selected-device revocation end session authority without cancelling a previously granted recurring instruction. Current `revokeSessionByToken` does not increment the global generation.
6. Adopt the conservative engineering design that captures `users.securityGeneration` at authorization and requires equality at execution. Current password-reset/change and revoke-all paths increment it. A mismatch requires explicit reconfirmation; it does not delete history, replay an occurrence or silently reauthorize. This is a proposed visible safety behavior for this implementation, not a claim that the old product already implemented it. No password, hash, session token or SID is stored in the authorization.
7. Current erased/unverified identity, lost membership/write capability, deleted custody or private custody owned by someone else prevents new effects. A tombstone preserves historical attribution, never live authority.
8. Null legacy authorization is incomplete state requiring explicit user action. Do not backfill an inferred actor or hide these plans. Expose truthful authorization-required status only to current source-authorized viewers.

No additional owner approval is needed merely to reproduce these failures, write fixtures or design ordinary permission wiring. The concrete new retention choice below remains separate.

## Minimal operational authorization design

Add an immutable, versioned `investment_plan_authorizations` record with authorization UUID, plan/household IDs, actual authorizing-user ID, per-plan revision, authorization-contract version, grant timestamp, security generation and normalized granted terms: account, instrument, SIP type, exact amount/currency, frequency and initial schedule declaration. Add a nullable current-authorization pointer on the plan, constrained to an authorization belonging to that exact plan/household.

Use a client operation UUID plus normalized request digest for create/reconfirm replay. Keep replay identity as operational data that can be purged independently of completed-purchase evidence; do not copy it into financial notes/audit details. Unique identity must prevent duplicate plan/authorization creation. Same key with changed intent is 409; identical replay rechecks current access and never resets an advanced schedule. Legacy plan rows receive a null pointer and no fabricated authorization. Migration rehearsal must prove existing plan, trade, lot and audit preservation.

Keep existing create/deactivate callers. Add an explicit authorize/reconfirm operation for a visible existing plan, with expected revision and exact current terms. A current authorized person grants their own new revision; the system never acts as the old author. A general plan editor is not needed for this bounded repair. If future edits are introduced, all executable term changes require a new explicit revision. Shared financial-write capability remains sufficient to manage visible shared plans; do not silently add creator-only administration. Private management remains owner-only through source visibility.

Creation/reconfirmation, authorization pointer and required audit commit together. UI must keep an operation key for uncertain retry, display reconfirmation-required state and submit an actual signed reaffirmation. Do not acknowledge an executable plan that cannot be authorized.

## Execution and source locks

Use `household -> actual author membership -> current user -> plan/authorization -> holding -> custody -> instrument -> acquisition sources`. This matches the established household-erasure anchor and manual investment writer order. A preliminary unlocked plan read may discover author identity, but the locked plan/pointer must match it before use. If revised meanwhile, retry or refuse; do not keep the stale actor.

Within the transaction, require current authorization, unchanged executable terms, captured security generation, current verified/non-erased identity, financial.write membership and actual custody visibility. Carry a validated internal authority result into `recordSipPurchase`. Replace blanket private denial only behind that boundary. Preserve exact arithmetic, first-position serialization, real BUY/lot provenance, unsupported-opening refusal and original-FX guard. Purchase, lot, actual-effect audit, completion evidence, success log and schedule advancement commit atomically. Refusal leaves financial state and schedule unchanged and emits no hidden-source details.

Do not weaken manual BUY/FIFO authorization or pass a made-up human/SID into actor-bound helpers. Internal source reconciliation does not itself grant source-read permission.

## Actual-effect audit audience

A private automated purchase is a system execution authorized by a person. Preserve that distinction: actual financial audit `userId=null`, actor=system; private audit `householdId=null`. The plan authorization records the actual author separately. Use an explicit authorization-contract version and completed-purchase proof linkage, not a human executor impersonation. Current nullable audit fields permit this without a broad audit-schema redesign.

Every reader/export must reauthorize underlying custody/source access; null household is never public. Keep private plan terms and identifiers out of household-wide audit/notification/error channels. A mandatory audit of a real completed purchase is distinct from the withdrawn proposal for an unnecessary actorless observation of legacy evidence. No such observation is reinstated.

## Concrete retention proposal for the owner

Recommended choice: erase all live/unused authorization material, retain only a minimal pseudonymous proof attached to each real completed purchase. The following is the exact proposed retained shape after erasure, not an open-ended permission to retain full mandates.

Use a small completed-purchase authorization-proof record, created atomically at successful execution, with a unique/FK-bound `purchase_id`. It must reference an actual committed investment BUY; never create it for a failed, skipped or merely authorized plan. The original operational authorization can therefore be deleted without destroying the provenance of a booked financial effect.

| Retained column | Purpose and minimization |
|---|---|
| `purchase_id` | Unique reference to the actual completed BUY. Its existing household/account/instrument/amount/currency/date supply the economic facts; do not duplicate those columns in the proof. |
| `author_user_id` | FK to the already anonymized user tombstone, solely as pseudonymous historical attribution. Never a live authority check or successor link. |
| `authorized_at` | Time of the actual signed grant, distinct from the purchase booking date. |
| `authorization_contract_version` | Identifies the authorization semantics and deterministic terms-digest format that were actually granted. |
| `authorized_frequency` | Cadence the person authorized. A single purchase cannot establish this recurring instruction. |
| `authorized_initial_date` | Original declared start date. The current plan's advanced next-date and a later purchase cannot reconstruct it. This adds no overdue booking policy. |
| `authorized_terms_digest` | Digest of exactly the versioned normalized monetary/source terms plus frequency/initial-date/record-only SIP type. It permits checking that the booked BUY's account/instrument/native amount/currency matched the granted terms without retaining a second financial snapshot. |

Define the digest input before coding: canonical account UUID, instrument UUID, fixed-scale native amount, uppercase currency, literal SIP record-only type, frequency and initial declared date, under the retained contract version. It excludes operation UUID, plan UUID, authorization UUID, SID, password/credential material, security generation and personal data. At execution the same normalized terms must match both the locked authorization and the newly persisted purchase before proof insertion; a digest is not permission to skip that comparison. Later verification reconstructs economic fields from the retained purchase and cadence/start from the proof. Preserve original booked values; no retrofit proof is generated for legacy purchases.

The retained proof contains NO name, email, phone, address, IP, user agent, SID, session token, password/hash, security-generation snapshot, free text, retry operation UUID, request-body snapshot, last/next execution date or copied amount/account/instrument/currency. No full mandate is retained behind an opaque JSON field. One proof per completed purchase avoids ambiguous evidence created from failure logs. A live internal authorization FK may be nullable and cleared during purge; it is not part of the retained shape.

On actor erasure, in the same authorized transaction:

1. Fence current execution with existing household/member/user ordering; mark the identity erased. Deactivate plans whose current authorization belongs to this actor and clear their current pointers. Plans now explicitly authorized by someone else retain that distinct current grant.
2. Delete this actor's operational authorization rows, including all unused and superseded rows, plus all associated replay records, operation UUIDs and request digests. Remove new authorization-event payloads that would otherwise retain those full terms or retry identifiers. Never retain an unused authorization merely to justify its old active flag.
3. Retain only the compact proofs above for actual completed purchases and legitimate existing financial/audit history under the current retention boundary. Private proofs remain private; pseudonymization never widens audience.
4. Do not transfer authorization to a successor household owner. Any later execution requires a new explicit grant by a currently permitted person. Do not infer that an old private account becomes shared because its owner was erased.
5. If the household itself is deleted, remove its proof rows through the existing financial-data deletion/cascade path. No financial proof should outlive the purchase it describes. Purge failure rolls back erasure; no half-erased active pointer remains.

This proposal deliberately retains the grant time/cadence/start/digest because purchase facts alone cannot show what recurring action was authorized. It does not duplicate purchase price, quantity, basis, cash or FX. The tombstone link supports attribution without retaining identity fields. Retention duration, legal holds and backup obligations remain OI-04; no duration or legal compliance is invented.

Alternative owner choice: erase all new authorization proofs as well, retaining only booked financial history and its ordinary audits. That gives less historical authority evidence; it does not permit deleting the booked financial effect or continuing the erased person's mandate.

**Copy-ready owner question:** When a user erases their account, may we delete all unused SIP authorizations and retry keys while retaining only the seven-field pseudonymous proof above for purchases that actually completed, or should we delete those proofs too and retain only the booked purchases and ordinary audits? I recommend retaining the minimal completed-purchase proof.

The reviewer and coordinator accept this technical proposal for preparation only. The owner has not selected either retention option. No implementation/migration is approved by this document.

## Required acceptance and exclusions

Retain the actual 39f failures. After authorized implementation require signed private-owner/shared positives, peer omission/denial, one effect/lot/audit/proof, idempotent replay and changed-intent conflict, generation-change refusal and actual logout survival, stale revision, late grant/source withdrawal, creator erasure with surviving peers, last-household cascade, audit/proof/purge rollback and legacy null-authority refusal. Verify the chosen retained columns and absence of operational IDs/credentials after erasure. Directly seeded positive plan fixtures must become genuinely signed authorization fixtures; do not simply turn them into expected denials or skips.

Rerun prior manual BUY/FIFO, SIP-sale-SIP, legacy quantity, original FX, first-purchase concurrency and old public-client callers. Keep dates/current quotes truthful. Do not add timezone/31st anchor, overdue catches, historical quote/booking dates, durable occurrence schema or scheduler claims in Slice B; those remain separate reviewed work. This design does not settle real tax/rollover/private-history release policy.

## Review Summary

The held repair now has independently reproduced private-owner execution failure and peer create/list/deactivate privacy failures. No blocking test-fixture defect was found. Source integration remains blocked pending implementation and fresh verification; ordinary engineering preparation may proceed within the stated boundary. The exact retention choice above requires the owner's answer before the dependent design is implemented.

## Owner decision and implementation assignment — 3 November 2026

The owner explicitly selected: **Retain minimal completed-purchase proof (Recommended)** in response to the exact seven-field erasure question. This supersedes the pending-choice statements above. Retain only purchase ID, pseudonymous tombstone user ID, authorization time, contract version, authorized frequency, original initial date and normalized terms digest for real completed purchases. Stop future execution, clear affected active pointers and delete operational authorization/retry records at erasure. No other retained columns, duration, legal compliance or wider OI-04 policy is approved.

The coordinator accepts the bounded technical design above for isolated implementation and review. One Sol lane will own authorization schema, signed API/executor/erasure integration and meaningful old/new caller tests; UI completion follows the same contract. Migration0028 is available in current committed history and may be prepared as an isolated candidate subject to independent SQL review and fresh/populated disposable-target rehearsal. This does not authorize applying it to shared/production databases, canonical integration without verification, overdue/anchor/scheduler policy or release. Preserve the failed39f oracle and original held SIP source. Rebase/composition must preserve accepted R12/R08 source; no unrelated changes.
