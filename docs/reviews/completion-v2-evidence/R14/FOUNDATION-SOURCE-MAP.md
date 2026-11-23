# R14 job capability source map

30 October2026. Source-only discovery by Sol Extra High
`r14_job_capability_map` at canonical774d3ab1c184a1149c19e9ba7c69b4e934e346ab.
Coordinator records its findings for an Astra architecture checkpoint. No source
implementation, SQL application, test, database connection or gate removal occurred.
Master R14/R19 and R08 dependencies remain governing.

## Existing contracts and gaps

`server/core/jobs/service.ts` has JobTypes, process-local handlers, persisted jobs,
optional idempotencyKey and conditional pending-to-running UPDATE. Its comment
at line138 promising FOR UPDATE SKIP LOCKED does not describe the implementation.
No production consumer was found outside that queue's runner/index; the actual
scheduler invokes services directly. `shared/schema.ts:3214` defines the existing
generic jobs table.

Missing: declarative complete producer registry; unique job/scope/due identity;
claim token, generation, expiry/reclamation and heartbeat; database-clock lease
authority; fenced transactional effect/result/checkpoint; retained attempts and
restart recovery. Handler execution and job status updates currently occur
separately by job ID. A storage-only foundation cannot admit required production
jobs or clear the current refusal.

Preserve existing recurring rule locks, due-state recheck, deterministic transaction
key and atomic transaction/audit/link/next-date/history behavior in
`server/services/recurring/RecurringProcessingService.ts:161`. This is useful
transactionality, not a generic job fence. Existing
`server/repositories/TransactionRepository.ts:392` provides createWithinTransaction
with audit options, but no claim/fence. Preserve the independent security-notice
token/generation claims and durable unknown-before-send semantics in
`server/services/security-notice-dispatch.ts`; they are not general R14 authority.

## Required admission and execution paths

Startup validates required jobs through app.ts -> validateEnvOrThrow ->
validateEnv.ts -> assertRequiredJobCapabilities. initializeServices separately
calls initScheduler, which checks before cron registration. Startup/readiness
health probes use the same guard; liveness remains independent.

The admitted Redis facade exposes cache/analytics/readiness/quota/rate-limit
operations, with no lock/job contract. Required validation therefore throws
REDIS_PROFILE_REQUIRED_JOB_CAPABILITY_MISSING. Scheduled callbacks instead call
runScheduledJob -> withRedisLock -> direct service; authenticated cron routes also
invoke workers/services directly, bypassing the generic core/jobs queue.

SnapshotWorker independently refuses admitted profiles with
REDIS_PROFILE_SNAPSHOT_LOCK_UNAVAILABLE at both processAll/processHousehold entry
points. Removing only the scheduler refusal would leave snapshots unavailable.
Eventual admission must validate genuine current registry/store/fence capabilities
actually consumed by all required trigger/worker paths. No environment flag,
Redis facade shape check or synthetic store test can substitute for this.

## Proposed next scope, pending Astra decision

Implement an isolated local PostgreSQL job-storage foundation: pure registry and
closed scope/due contracts; unique insert and payload-conflict semantics; atomic
claims/reclaims/generation/token/leases; heartbeat, retries and retained attempts;
transaction-aware fence primitive using TransactionType with a synthetic witness.
Keep scheduler/cron/financial producers and every existing admission gate unchanged.

Meaningful future checks: concurrent same-identity insertion, two claimers,
heartbeat/reclaim, stale renew/fail/complete, crash before/after witness commit,
rollback when result persistence fails, bounded attempts and backlog101 leaving
durable continuation. Registry tests must expose unsupported producers. Money
writer integration still requires R08 posting/locks/denomination/operation-identity
and atomic audit/outbox contracts. R14 closure additionally needs actual scheduled
triggers and all named producers, not only this foundation.

Candidate paths are new contracts/repository modules and focused tests under
server/core/jobs, plus a coordinator-allocated additive migration/schema change.
This is a proposed scope, not permission to overwrite existing rows with invented
due identities or to allocate a migration number without reconciliation.

## Migration ownership and protected targets

Canonical journal ends at index13/0013_r01_security_notices (14 migrations), but
isolated R05 personal-preferences author already owns
0014_r05_personal_account_filter.sql. R05's candidate record names its server
schema/migration owner and parent-owned migration/integration window. Do not
allocate a second0014 merely because canonical lacks that isolated candidate.
Reconcile its source/review/integration status before assigning the job migration.

Recorded R05 rehearsals used marked disposable r01int15a1 and r05p20261030a targets
and15 migrations. Recorded cluster is canonical .local/completion-pg on loopback
127.0.0.1:55432, PostgreSQL18.6 UTC. These are historical evidence references,
not verified current live targets. R00/TARGETS.md requires an explicit target
manifest/run identity, disposable name and persisted marker; ambient finance_app
and unmarked databases remain prohibited. No database was opened for this map.

R20's nine-file observer author/native window is separate ownership. Parent keeps
schema allocation, runtime scheduling, evidence and canonical integration. All101
closure groups and the campaign goal remain OPEN.
