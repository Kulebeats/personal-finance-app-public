# Business Continuity and Disaster Recovery

## Purpose

Ensure service recovery and data protection during outages or disasters.

This policy states required controls and targets, not a claim that backups or
recovery have been verified. The governing completion specification is
[master v2.2](../plans/2026-10-15-master-completion-spec.md). The current inventory,
missing dependencies and bounded rehearsal contract are recorded in
[R19 recovery plan](../reviews/completion-v2-evidence/R19/RECOVERY-PLAN.md).
Provider backup/PITR, encryption/key recovery, application-linked object coverage,
erasure replay and a timed restore remain unverified until recorded evidence exists.

## Scope

- Production application services
- Databases, caches, and file storage
- Third-party dependencies

## Recovery Targets

- RPO (Recovery Point Objective): at most 24 hours from the last complete recoverable
  joint database/object cut to the incident.
- RTO (Recovery Time Objective): at most 4 hours from declared recovery/incident to
  verified service readiness, including artifact/key retrieval, preparation,
  security replay and validation.

These targets supersede the previous reversed values. Record UTC times and
monotonic stage durations; do not equate backup completion time with its data cut
or pg_restore exit with readiness. Local fixture timing does not establish
production-volume recovery capacity.

## Critical Dependencies

- PostgreSQL database and the exact versioned migration/security state
- Redis, required for production rate limiting/cache behavior; a separate logical
  database is not proof of eviction isolation. Durable job/AI authority belongs in
  PostgreSQL under the governing implementation contracts.
- Durable S3-compatible object storage, ownership/version/hash manifests and
  retryable lifecycle state; the local adapter alone does not establish deployment
- Hosting/network/TLS, independently recoverable backup keys and current security/
  erasure authority
- Authenticated external scheduling and configured delivery/provider services for
  enabled features; optional features must report unavailable truthfully

## Backup Strategy

- Inventory the actual service, backup method, retention, location, access and last
  successfully verified joint cut. Do not assume provider automatic backups or PITR
  are enabled because the deployment blueprint names a PostgreSQL service.
- Select and verify a schedule whose spacing, capture duration and verification
  lag keep the recoverable cut within 24 hours. Daily/weekly policy language alone
  is not proof; failed/incomplete captures do not advance the recovery point.
- Include migration journal/schema hashes, durable database state and every
  required object version/byte hash at the same cut. Preserve pending/deletion
  states honestly; a database dump does not include object-storage files.
- Require encryption in transit/at rest and recoverable owner-controlled key
  custody. Record actual configuration and retrieval proof; keep keys separate
  from encrypted artifacts. These controls are requirements, not verified status.
- Preserve current post-cut erasure/revocation authority independently of old
  backups. OI-04 governs retention/legal holds and backup deletion; no retention
  duration or legal compliance is inferred here.

## Restoration Procedure

1. Declare incident, preserve evidence and record the exact code/config/schema,
   backup identities, operator and recovery start. Obtain the applicable execution
   authority; this policy does not authorize production writes or provisioning.
2. Select a trusted complete database/object bundle and fresh independent security/
   erasure overlay. Use immutable producer intent and a separate later restore
   authorization pinned to the produced manifest/archive digests. Missing or stale
   artifacts, keys or markers keep recovery quarantined.
3. Prepare the approved separate restore target. Local synthetic rehearsal requires
   guarded explicit manifests, a destination created from template0 with its own
   marker and pristine object baseline, and a reviewed native CLI launcher; Node
   test guards alone do not protect pg_restore. Never adopt an unmarked/live DB.
4. Restore database and exact object versions/bytes, verify journal/row/hash
   agreement, and replay erasure/security state before any authentication,
   downloads, workers or outbound effects resume. Restoring the old backup alone
   can resurrect erased identities, credentials, sessions and files.
5. Verify bounded dependency readiness, access/visibility, financial/audit
   preservation, object authorization and retry/reconciliation state. Measure
   RPO/RTO and report every exception. A liveness 200 is insufficient.
6. Present the verified result for the required operator/owner release decision.
   Production promotion, deployment and external communications remain separately
   gated by OI-01/OI-04/OI-06. There is no automatic promotion step.

## Rollback Compatibility

Prefer a tested compatible code rollback against the retained current schema, or
a reviewed forward fix. An older deploy is not safe merely because its build is
available. Prove the exact earlier binary's authorization, token, session/erased-user,
data and object contracts against the migrated state before directing traffic to it.
Do not automatically restore an older database or apply inverse SQL to undo a
deployment: that can discard committed writes, erasures and revocations. If no safe
rollback exists, retain quarantine and forward-fix under the reviewed recovery plan.

## Validation Checks

- Verify required DB/cache/storage readiness with bounded failure behavior
- Compare pinned migration hashes and independent expected rows, values, audit
  state, object counts/versions and checksums; table counts alone are insufficient
- Validate current authorization and erased/revoked subject denial before serving
  restored data; missing security replay is a failed release gate
- Verify file retrieval, cleanup retries and audit/export behavior for the enabled
  workflows, plus exact compatible rollback/forward-fix evidence

## Communication Plan

- Notify internal stakeholders within 1 hour
- Provide status updates every 4 hours during outage
- Publish post-incident report within 5 business days

## Testing

- Plan restore tests at least twice per year and after material recovery-contract
  changes; this is a schedule requirement, not evidence that a drill occurred
- Record test results, timing, and gaps
- Update runbooks after each test

## Review Cadence

- Annual review or after major infrastructure changes
