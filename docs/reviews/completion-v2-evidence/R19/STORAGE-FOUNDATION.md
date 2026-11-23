# R19 storage foundation execution map

Prepared against local 02ba119 on 15 October 2026. This is a proposed local implementation boundary, not storage implementation, provisioning, migration or deployment evidence. Master v2.2 authority, jobs/files contract, R19 and R15 govern; companion R19/R15 supplements them. The master's S3-compatible baseline wins over the companion's disk alternative and its proposed immediate untracking of uploads.

## Verified source and ownership

There is no server/core/storage.ts and no S3 SDK dependency in package.json. Thirty tracked files remain under uploads/. No file has been moved, removed or untracked.

| Boundary | Current source | Proposed ownership / sequencing |
| --- | --- | --- |
| Shared storage interface | New server/core/storage.ts | R19: opaque typed reference, byte metadata, bounded operations, typed failures; no DB/app import |
| Storage configuration | New server/core/storage/config.ts; later server/utils/validateEnv.ts | R19 after explicit lock; pure validation first, startup wiring after review |
| S3 adapter | New server/core/storage/s3.ts | R19 after dependency handoff; official SDK signing/transport, injected client for unit tests |
| Local fixture adapter | New server/core/storage/memory.ts and focused tests | R19; fixture-only, never a production durability substitute |
| SDK dependency / lock | package.json, package-lock.json | Parent exclusively; request SDK addition and lock update before importing it |
| Durable manifest | shared/schema.ts and additive versioned migration | R01 exclusive; obtain explicit allocation/handoff before authoring metadata or repository integration |
| Receipt writes/deletes | server/services/receipt/upload.service.ts; image.ts; repositories/ReceiptRepository.ts | Later coordinated R15 integration. Current optimized image/thumbnail writes precede DB insert; delete swallows file failure before deleting row |
| Receipt reads / DTO | server/modules/receipts/receipts.controller.ts; services/receipt query delegates; receipts.service.ts | Later R15: replace path-based sendFile and expose authenticated object IDs/status only |
| Transaction attachments | server/services/AttachmentService.ts; modules/transactions/transactions.attachments.controller.ts | Later coordinated consumer integration: current rename then insert, storagePath persisted |
| Goal/profile/banner files | modules/goals/goals.images.controller.ts; modules/settings/settings.picture.controller.ts and settings.banner.controller.ts | Later individual file locks; preserve existing image validation and mutation audit semantics |
| Merchant logos / account erasure | schema merchantLogoUploads; modules/settings/settings.account-deletion.files.ts and settings.account-deletion.service.ts | Later R07/R15 coordination; merchant upload writer not identified in current live module search, do not invent one |
| Legacy retrieval / app / readiness | middleware/uploadsAuth.ts; health controller; app.ts | Later separate file locks; do not change public health order or weaken current authorization |
| Deployment / live credentials | render.yaml, CI, provider account | Parent-owned files plus OI-01/OI-06; no provisioning or external writes authorized |

## First safe local slice

Add the interface, pure configuration parser, S3 adapter and owned fixtures only. Do not switch existing upload writers, delete tracked files, add manifest tables, or make an unconfigured provider look healthy. Keep module import free of network dispatch. This slice can prove transport/configuration behavior independently; application durability remains open until metadata and consumer integration are verified.

The interface should accept validated internal object references and AbortSignal, with put/head/get/delete and a bounded health probe. References contain a generated opaque UUID key and controlled purpose prefix; filenames and caller-supplied path strings never form a storage key. The backend does not decide user visibility: the application reauthorizes the parent entity through the canonical visibility predicate on every download/delete, then passes the stored internal reference. Household membership alone must not grant private-parent access. An invisible object is 404.

Put validates the actual bytes and maximum size, calculates SHA-256 of the bytes stored, and returns size/media type/hash plus opaque provider version if supported. Receipt duplicate hash of the original input must remain distinct from checksum of optimized stored bytes. ETag is not treated as a checksum. Generate thumbnails in memory before storage; do not introduce another durable disk path. Existing per-purpose MIME/content validation remains at the consumer boundary.

Use immutable unique keys and conditional create where the selected S3-compatible implementation supports it. Bound connect/request/overall time, pass abort to transport, and make retry ownership explicit; a timeout after dispatch is an unknown write outcome requiring reconciliation, not proof that nothing was written. Provider exceptions become reviewed typed failures without bucket credentials, object bodies or signed URLs in logs. Never make buckets public or return raw object/signed URLs as a substitute for authorized downloads.

## Proposed configuration contract

Names below are proposed, not existing environment support: STORAGE_DRIVER=s3, S3_ENDPOINT (operator-controlled HTTPS URL with no userinfo/query/fragment), S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, optional S3_SESSION_TOKEN and explicit S3_FORCE_PATH_STYLE. Reject partial credentials, unknown driver/options, invalid buckets and insecure production endpoints. Keep certificate verification enabled. Do not silently consume an ambient AWS credential chain for this explicit owner-configured service. A local HTTP fixture must be constructor-injected in a protected test and pinned to that process-owned numeric loopback endpoint; it is not a production environment bypass. A required, enabled store failing its real probe makes readiness 503 within the existing overall two-second budget. Missing optional configuration remains truthfully unconfigured until the feature is enabled; enabling durable-file workflows without a required store must fail closed.

Dependency handoff requested: parent to select/add the supported official AWS S3 client SDK under its package/lock ownership, or explicitly authorize the minimal dependency diff. Do not implement SigV4 by hand. No package change is part of this map.

## Durable metadata and failure ordering

Proposed manifest fields: opaque ID/key, household/requester, parent kind and ID, purpose, backend/bucket identity, SHA-256, byte size, media type, lifecycle state, optional version, timestamps and bounded cleanup error/attempt state. Database authority governs pending -> ready -> delete_pending -> deleted (and explicit failed/unknown outcomes). The metadata migration needs R01 allocation plus protected DB evidence; this document is not that allocation.

Create a pending manifest transaction first, commit, write/verify the object, then atomically mark ready and associate it with the authorized entity. Never hold a DB lock while waiting on S3, mark ready before verification, or return success for a pending upload. A crash after object write leaves a durable reconciliation identity. Deletion first revokes visibility and records retryable cleanup; confirmed object deletion advances state. Missing objects are idempotent delete success, while outages retain delete_pending. Concurrent retries use a stable operation identity/fingerprint; changed content conflicts. No financial conversion semantics change before R08/R15 prerequisites.

Legacy migration requires a reviewed inventory of source revision, canonical source path, parent ownership, byte count/hash, target key/version and verified target hash, plus rollback mapping. Copy and verify before changing references; preserve old bytes until review authorizes removal. Include originals, thumbnails, attachments, goal/profile/banner/merchant files and erasure markers in restore scope. The current thirty tracked files are not cleanup permission.

## Local acceptance oracles

1. Pure unit contracts: reject malformed/foreign keys, changed payload, partial credentials, insecure production URL; no import-time send; size/MIME/hash mismatch refusal; standard outcomes for missing, denied, unavailable, aborted and unknown writes.
2. Injected SDK fake: exact Bucket/Key/body/checksum and abort/retry options; private operation only; no body/secret logging. A deliberately stalled operation returns within its deadline and late completion cannot mark metadata ready.
3. Actual SDK plus owned loopback fake S3 after explicit test fixture authorization: assert signed request/header shape without recording credentials, create/read/head/delete, wrong checksum, 404, 403, 500, timeout and aborted stream. The existing ordinary unit TLS guard remains enabled; HTTP fixture traffic may go only to that process-owned server. This proves SDK serialization and adapter behavior, not a real provider.
4. After manifest allocation: one uniquely named protected synthetic DB target, owned fake store, crash before/after object write, DB commit failure, retry/restart, concurrent request and deletion retry. Assert manifest/object agreement and zero unexplained orphan or false ready rows.
5. After coordinated consumer integration: authorized download and changed-access denial, no absolute/server/bucket paths in DTO, same hash after simulated process restart, safe rollback and intact legacy mapping. Real receipt conversion and OCR/CSP acceptance remain R15.

## External gates and limits

OI-01 supplies the real S3-compatible account/origin/bucket/credentials, CA/TLS and operator identity. Owner-authorized staging must prove actual provider checksums/version/conditional-write behavior, redeploy survival, required storage outage readiness, authenticated access and alert delivery. Combined object plus PostgreSQL restore must meet RPO 24h / RTO 4h, including erasure markers, and rollback must preserve migrated data. OI-06 governs deployment/production enablement. Local fixtures, SDK calls or a Redis logical database do not close these gates. Durable job and AI authority stays in PostgreSQL.
