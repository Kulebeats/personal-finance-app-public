# Proposed local production-profile manifest v1

Design only. Master v2.2 R20.1/R20.3, authority/test-target rules and J16 govern; companion v1.2 is subordinate. Read against canonical PRODUCTION-PROFILE.md, BROWSER-TRUST.md, browser-trust-proof.mjs (accepted primitive 4752e58), current app/build paths, R19 verified TLS resolver and ordinary target/network guards; source inventory completed at canonical 050cfda40bab518f3c3fe1882f3d80ea272621ef. No application/runtime/helper subprocess, network, DB, credential access, install or provisioning was performed for this design. This adds only this document. Full profile/Redis/native PG TLS/application HTTPS/egress acceptance remains OPEN.

Proposed implementation: server/testing/production/manifest.mjs, pure parsing/validation only, after parent assigns files. Preserve ordinary test manifests, environment setup and guards unchanged. Do not widen their HTTP/plaintext/TLS-denial policy or infer a production profile from NODE_ENV. This first profile is explicitly local synthetic production mode for HTTPS/security journeys; workers, providers, mail and push are disabled. Parent approved this bounded policy; later enabled sinks/workers require a separately reviewed contract/version.

## Exact shape

The following is **type notation**, not an allocated/runnable JSON manifest. Every key shown is required; there are no optional fields or free-form options. Port, runtime, path, revision and certificate values are unresolved exact caller inputs unless a literal is explicitly fixed below. No missing value receives a guessed default.

```text
ManifestV1 = {
  kind: "pfa-production-profile", version: 1, profile: "local-production-v1",
  runId: RunId, issuedAt: UtcInstant, approvalRef: ReviewRef,
  harnessCommitSha: Sha40,
  paths: {
    runRoot: AbsolutePath, buildRoot: AbsolutePath, browserRuntimeRoot: AbsolutePath,
    browserProfileRoot: AbsolutePath, pgdataRoot: AbsolutePath,
    publicTlsRoot: AbsolutePath, privateRoot: AbsolutePath
  },
  build: {
    commitSha: Sha40, nodeVersion: "24.22.0", nodePlatform: "win32", nodeArch: "arm64",
    artifacts: [ArtifactPin, ...]
  },
  endpoints: {
    browserOrigin: HttpsOrigin,
    terminator: Endpoint, backend: Endpoint, browserEgressProxy: Endpoint,
    postgres: Endpoint, redis: Endpoint
  },
  postgres: {
    clusterId: Uuid4, serverVersion: ExactPg18Version,
    target: { version: 1, disposable: true, synthetic: true,
      host: "127.0.0.1", port: Port, database: SyntheticDatabase, runId: RunId },
    expectedMarker: Marker, role: DatabaseRole,
    credentialRef: Uuid4, credentialGeneration: Uuid4,
    schema: { sourceSha256: Sha256, journalSha256: Sha256,
      migrations: [{ name: MigrationName, sha256: Sha256, journalWhenMs: Integer }, ...] }
  },
  redis: {
    instanceId: Uuid4, serverVersion: ExactVersion, transport: "tcp", database: 0,
    aclUser: RedisUser, credentialRef: Uuid4, credentialGeneration: Uuid4,
    keyPrefix: RedisRunPrefix
  },
  tls: {
    https: { identityHost: "127.0.0.1", rejectUnauthorized: true,
      ca: PublicCertificatePin, leaf: PublicCertificatePin },
    postgres: { identityHost: "127.0.0.1", rejectUnauthorized: true,
      ca: PublicCertificatePin, leaf: PublicCertificatePin }
  },
  chromium: {
    engine: "chromium", version: "145.0.7632.6", executable: FilePin,
    trust: { contract: "chromium145-servercertificate-v1",
      relativeDatabasePath: "Default/ServerCertificate", databaseVersion: 1,
      lastCompatibleVersion: 1, caDerSha256: Sha256, trustMetadataHex: "0a020803" },
    ignoreHTTPSErrors: false, proxyBypass: "<-loopback>", quic: false,
    launchPolicy: "pfa-chromium145-strict-v1"
  },
  policy: {
    nodeEnv: "production", serverTimezone: "UTC", actorTimezone: "Africa/Lusaka",
    appOrigin: HttpsOrigin, clientOrigin: HttpsOrigin,
    forwarding: "strip-and-set-single-hop-v1", egress: "exact-role-routing-v1",
    providers: "disabled", mail: "disabled", push: "disabled", workers: "disabled"
  },
  timeouts: { connectMs: Integer, dependencyProbeMs: Integer,
    navigationMs: Integer, runMs: Integer }
}
Endpoint = { host: "127.0.0.1", port: Port }
FilePin = { path: AbsolutePath, size: Integer, sha256: Sha256 }
PublicCertificatePin = { file: FilePin, derSha256: Sha256 }
ArtifactPin = { role: "server-entry" | "client-index" | "client-asset",
  relativePath: RelativePath, size: Integer, sha256: Sha256 }
```

## Canonical values and cross-field rules

- Accept exact canonical JSON bytes: compact sorted object keys, no duplicate/unknown keys, alternate whitespace/escapes, floating values, nulls, undefined, functions or arbitrary prototypes. Limit input to 256KiB, depth to 10, strings to 2048 characters, object keys to 32 and total nodes to 12000. Reject symbol/accessor/hidden-array fields, sparse arrays, cycles and bounds violations without invoking getters; use the same descriptor-based bounded copy for caller expectations. Deep-copy/freeze successful output; caller mutation cannot change it. No fs, environment, process, crypto-key/certificate parsing, clock read, module side effect or application import is needed. Hashing supplied bytes is pure. Reject unsupported version/profile; never coerce arrays/numbers into strings.
- RunId is 8–32 lowercase alphanumeric characters starting with a letter. All nested run IDs equal the top-level ID. Sha40/Sha256 are exact lowercase 40/64 hex and not all zero. UUIDs are lowercase UUIDv4; IDs/references are public opaque identifiers, never secret material. ReviewRef matches `[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}` and is not an executable path or inferred authorization. UtcInstant is a round-trippable UTC millisecond timestamp; parsing it does not prove freshness/owner approval. ExactVersion matches `[0-9]{1,3}(\.[0-9]{1,4}){1,3}`, with no wildcard/range; PG is exactly `18.<minor>` within that bound. Redis version remains unresolved until an owned runtime is approved; a fixture/stub cannot satisfy it.
- Every listener uses exact numeric IPv4 127.0.0.1 and an integer port 1–65535. For this initial version, reject ports 0,80,443,5000,5432,55432,6379 to avoid ordinary/default/campaign endpoints. The five listener ports must be pairwise distinct. browserOrigin is exactly `https://127.0.0.1:<terminator.port>` with no slash/path/userinfo/query/fragment/default-port normalization; appOrigin/clientOrigin equal it byte for byte. This repeated authority is intentional, not a sixth listener. No localhost, DNS, IPv6/mapped/alternate numeric spelling, wildcard bind, URL connection string, service alias, implicit port, socket/pipe/fd, caller lookup, extra proxy/endpoint list or redirect origin is admitted.
- PostgreSQL target matches the postgres endpoint and profile run, has database exactly `pfa_completion_r20_<runId>_test` (<=63 characters), and expectedMarker exactly `pfa-synthetic-test:v1:<runId>:<database>`. Reuse only the ordinary parser's pure target-name/run validation on this strict subset; do not call its environment/URL/plaintext setup. DatabaseRole is a plain lowercase identifier <=63 characters, excluding postgres/root. clusterId and pgdataRoot bind a future distinct owned cluster: neither declares that it exists, is owned, or has SSL enabled. No maintenance database exception is part of the profile's query target.
- Schema binds shared/schema.ts bytes and migration-journal file bytes separately from an ordered migration list (1–128). Each MigrationName matches `[0-9]{4}_[a-z0-9_]{1,80}` and is unique; each SQL-file hash and positive safe-integer journalWhenMs is explicit, names and timestamps are strictly increasing. journalWhenMs represents the source journal value carried into Drizzle's created_at, **not** actual execution time. The future guard must compare applied journal hashes/values on the same verified client; matching source hashes/journal alone does not certify all live constraints or absence of catalog drift. No current migration count/hash is fabricated here.
- RedisUser is exactly `pfa_<runId>`; keyPrefix exactly `pfa:production:<runId>:`. Redis credentialRef/generation differ from the PG credential pair. Instance/credential IDs are opaque declared identities, not ownership/authentication proofs or password hashes. A dedicated owned real Redis instance is required later; database 0/prefix does not isolate eviction or make Redis durable job/AI authority. tcp is only this owned numeric-loopback local profile's Redis transport; no claim about hosted TLS follows.
- AbsolutePath is the selected Windows host's canonical drive-absolute path, <=1024 characters; reject relative/device/UNC paths, traversal, ADS, short-name aliases, reserved names, encoded separators, mixed separators and trailing dot/space. The four mutable roots (browserProfileRoot/pgdataRoot/publicTlsRoot/privateRoot) are pairwise disjoint strict descendants of runRoot. buildRoot and browserRuntimeRoot are disjoint from each other and from **every** mutable root, using case-insensitive equality/ancestor checks; no shared-layout exception is supported. Each of those two immutable roots is either disjoint from runRoot or a declared strict child, never equal to or an ancestor of runRoot. Public files remain disjoint from privateRoot; certificate files are strict descendants of publicTlsRoot and Chromium executable is within browserRuntimeRoot. Thus buildRoot=pgdataRoot, browserRuntimeRoot=browserProfileRoot and cross-nested/case-alias layouts refuse before any future launch. These are lexical expectations; no path existence, links/reparse, custody or ACL result is inferred.
- artifacts contains 2–512 unique sorted relative paths, each 1 byte–100MiB and <=500MiB total. Exactly one server-entry is `index.js` under buildRoot (current dist); exactly one client-index is `public/index.html`; other roles are descendants of `public/`, excluding that index. RelativePath is 1–256 characters from `[A-Za-z0-9._/-]`, slash-separated with no empty/dot/dotdot segment, traversal, native alias, encoding or case collision. This is an intended **built-output inventory**, not proof it covers the actual served directory or the full executed candidate. The current esbuild command uses packages=external: loaded dependency JavaScript/native addons and their resolution are outside dist. Public certificate FilePins are 1–65536 bytes and declare one certificate per file; DER and file hashes are distinct domains. Chromium FilePin is positive and <=1GiB. None of these hashes is a trust signature or actual file readback.
- HTTPS/PG identityHost equals their configured numeric host. Each public CA/leaf pin is explicit, with distinct CA versus leaf paths/DER identities inside each TLS role; no system/default CA or validation-off fallback is accepted for this profile. “Public CA” means nonsecret certificate material for the owned ephemeral CA, **not** a globally trusted commercial issuer. Chromium trust.caDerSha256 equals tls.https.ca.derSha256. The exact version/database-format/metadata bytes bind the accepted Chromium primitive; they do not prove actual certificate content, trust installation, validity/SAN, private-key custody or native verification. A different browser/trust format requires source review and a new contract version, not ignored fields.
- Timeouts are explicit positive integers: connectMs<=5000, dependencyProbeMs<=2000, navigationMs<=30000, runMs<=3600000; each per-operation bound is <=runMs. They are declared limits, not a measured deadline/result. No launcher flags, free-form environment map, credentials, PEM/key text, password hash, signed URL or arbitrary context payload is part of the schema.

## Separate caller expectations and result

Proposed signature: `readProductionManifest(canonicalText, callerExpectations)`. callerExpectations has exactly these required fields:

```text
{ expectedManifestSha256: Sha256, runId: RunId, profile: "local-production-v1",
  buildCommitSha: Sha40, harnessCommitSha: Sha40, approvalRef: ReviewRef,
  expectedArtifactsSha256: Sha256, expectedServicesSha256: Sha256,
  expectedSecuritySha256: Sha256 }
```

Compare whole canonical bytes to expectedManifestSha256 and scalar identities directly. The three separately supplied projections are SHA-256 over canonical `build.artifacts`; `{endpoints, postgres, redis}`; and `{tls, chromium, policy}`, respectively. The whole manifest pin also binds paths/timeouts/issuedAt. The trusted caller must supply pins from the parent's independent reviewed dispatch/artifact record. A pure parser cannot identify that a caller copied/regenerated its pins from a colocated manifest. Replacing both manifest and supplied hashes can satisfy structural/hash comparisons without supplying independent provenance. This parser cannot authenticate pin origin, the caller, or approvalRef as owner permission.

Successful output is a branded deeply frozen record `{kind:"validated-production-profile", manifestSha256, document, certifications}` with all of filesystemIdentity/buildArtifactReadback/runtimeDependencyIdentity/liveDatabaseIdentity/liveSchemaIdentity/liveRedisIdentity/nativePgTls/chromiumTrust/egressEnforced/executionAuthorized **false**. Export no serialized secret slot, transport client, mutable builder or execution boolean override. The reader refuses missing/unknown expectations, unknown fields and changed input versus unchanged pins with a static non-payload error. Cloned/forged **result records** are rejected only by later consumers checking the private in-memory brand; the reader itself consumes JSON plus supplied expectations. Success means only that these supplied values agree, not that their origin was authenticated.

**Hard deferred execution gate:** this version cannot authorize a launcher or application execution. A later separately reviewed dependency contract/version must bind and attest the actual installed runtime dependency JavaScript/native-addon bytes, their resolved dependency roots/resolution, and custody before that scope can be allocated. Package/lock/commit hashes alone do not establish installed bytes or what Node will load. This design deliberately does not invent a solved dependency inventory; runtimeDependencyIdentity stays false even if all dist files match. Existing filesystem/transport gates remain necessary and cannot substitute for this missing dependency gate.

## Later transport and secret boundary — outside this implementation

After the hard dependency gate above is resolved in a separately reviewed version and parent grants scope, future launcher/guards must accept only the branded record before application import. Secret input is a separate nonserializable capability supplied by an explicitly authorized owner of the run, indexed by `{runId, service, credentialRef, credentialGeneration}`. It resolves PG/Redis authentication and server/private key material only at the corresponding transport/cluster boundary. No values, hashes of passwords, key filenames, secret object or function is attached to manifest/result/evidence/logs. The boundary checks the public role/ACL identity and generation, has no environment/profile/metadata-service fallback, and releases/clears material with the owned client lifecycle. A pure validator never resolves that capability. Wrong/missing/stale secret generations must refuse before application callbacks; actual AUTH/role/ownership verification remains a later live proof.

Fixed routing is browser -> CONNECT proxy -> exact HTTPS terminator; terminator -> exact HTTP backend; backend -> exact native TLS PG and owned Redis only. Node-side Playwright API requests need their own exact-origin HTTPS guard/explicit CA; they must not silently inherit the browser's profile-local trust or bypass the proxy policy. Native browser redirects may stay at the exact HTTPS origin only; foreign redirects, downgrade, implicit loopback bypass, fresh pages/contexts/API clients and unowned listeners must be refused by future adapters before a forbidden connection, with independent sinks. Backend is never an alternate browser origin. Terminator strips incoming forwarded headers and sets fixed HTTPS/host values for the one hop; no trust-proxy claim follows from a manifest field.

PG adapter must reuse configured-host verified TLS (including pg's preconnected numeric socket), the explicit public CA, and same-client database/own marker/server port/pg_stat_ssl checks before queries/callbacks. Expected leaf DER must also be compared with the observed verified peer; R19's resolver does not itself implement that additional profile pin. A TLS proxy must not conceal different native backend truth. Chromium bootstrap must use a fresh owned profile, its pinned source-format checks and expected DER anchor, with separately verified owned terminator certificate identity; ignoreHTTPSErrors, certificate-ignore flags, intercepted/fabricated HTTPS responses or OS trust installation cannot satisfy it. Build/filesystem attestation, real owned Redis version/ACL/challenge/instance checks, provider/mail/push/worker denial and actual egress negatives remain separate gates. Existing ordinary unit/database/browser profiles remain unchanged and cannot certify these production-mode assertions.

## First implementation/refusal oracles after allocation

Pure tests should accept one exact synthetic contract with separately supplied expected values, deep-copy/freeze it and report only false certifications. Refuse missing/extra/accessor/symbol/cyclic/oversized/noncanonical data; field mutation versus unchanged pins; wrong candidate/built-output/schema/service/security projection; aliases/default/reused/colliding ports; origin/backend mismatch; URL/SSL/routing overrides; marker/run/role/schema-list ambiguity; private/public or immutable/mutable root overlap (including every cross-pair/equality/nesting/case alias); changed Redis generation versus unchanged pins; altered Chromium version/trust bytes; verification-off/policy widening; ambient fallback. Tests may reject changed colocated data while an independent unchanged expectation disagrees, but cannot prove where the supplied expectation came from. Later brand consumers separately test cloned/forged result refusal. No successful parse may import app modules, read files/credentials/environment or open a listener/connection. Later live positive/negative transport oracles require the unresolved dependency contract and separate parent assignment; this document authorizes none and invents no endpoint, certificate, Redis runtime or trust provenance.

## Authorized pure implementation checkpoint

The design above was independently accepted at 812cd23 + a4e3beb for pure parser scope only. Parent then explicitly assigned server/testing/production/*; this checkpoint supersedes the initial design-only status **only for that pure implementation**. New manifest.mjs implements the exact declarative input/expectation comparison, deep copy/freeze and private WeakSet result brand. Supporting primitives/layout/services/security modules perform bounded canonical copying, lexical paths, exact role/target/schema/TLS/Chromium/policy/timeouts and projection checks. They import only pure Node crypto/path/util helpers and local pure modules; no accepted recovery module, ordinary guard or application import is coupled or changed. Production's stricter target subset is checked locally without invoking the ordinary environment/URL/plaintext setup.

Selected runtime for focused tests: Windows ARM64 Node 24.22.0. Command: `node --test server/testing/production/manifest.test.mjs`. Result: **83 passed, zero failures/skips**. Positive fixture declarations are inert: no declared path, cluster, Redis instance, certificate, browser or credential exists by inference. Four fixture digest expectations were computed once for the unchanged declaration and stored separately as literal constants; tests never automatically regenerate those approved-fixture values from mutated input. Deliberately untrusted self-consistent pairs separately exercise structural rejection even after their own hashes/projections are updated, without claiming those pairs were approved. Another positive explicitly demonstrates that a structurally valid replacement with matching replacement pins can parse while every certification remains false: pin origin cannot be authenticated by this parser.

Coverage includes immutable nested output and later-consumer cloned/forged record refusal; changed identities/projections versus unchanged literal pins; unknown/missing/extra keys and secret options; accessors/symbols/hidden or sparse arrays/cycles/prototypes/bounds; all immutable/mutable root cross-pairs with equality/either nesting direction/case aliases; forbidden/default/reused/colliding ports, DNS/IPv6/alternate numeric hosts, origin downgrade/query/trailing slash, target/run/marker/role/schema ambiguities; Redis credential/profile/version/prefix changes; TLS verification/key/path/CA-leaf refusals; Chromium version/trust/anchor/bypass/QUIC/extra-argument changes; policy enablement and bounded deadlines. A behavioral red exposed Proxy expectations being accepted while executing an ownKeys trap; the pure util.types.isProxy check now refuses before any trap. Initial test collection also failed before manifest.mjs existed; that was missing-module red, not a behavioral defect.

Seven new module/fixture/test files passed selected Node --check. **Full npm run check is pending by parent instruction:** R04 holds the shared focused DB/TypeScript slot; this author requested the next slot and did not start a concurrent compiler/full suite. Source/evidence are frozen for independent review first; static evidence can follow without source changes. No filesystem observation, environment/clock read, private-key/certificate parsing, subprocess/network/DB/listener, secret resolution, runtime installation, launcher or application execution occurred. Hashing supplied synthetic bytes and native unit/syntax checks are the only executed module behavior. All ten certifications, especially runtimeDependencyIdentity and executionAuthorized, stay false; the reviewed dependency/launch/live transport gates remain OPEN. Commit identity is the commit introducing this checkpoint; parent owns canonical status/integration.

## Static checkpoint and reserved-device review correction

Parent released the check slot after the initial freeze. On exact 61f624d2b0d148eb8156bc128ccff7a44a32e00f, selected Windows ARM64 Node 24.22.0 npm run check exited 0: TypeScript, import guard, LOC ratchet (zero new/grown oversized files), 37 script syntax and metadata/status/W9/W10 guards passed. Worktree remained clean, no source change; parent/R04 received the immediate slot release. This clears that frozen snapshot's earlier static-pending note, not a claim about later source revisions.

Independent review then found the Windows device-name rule missed superscript COM/LPT digits. A new **pure** full-reader regression reproduced acceptance of `C:\Synthetic\COM¹\build` with self-consistent declaration/pins (missing expected exception). The lexical reserved-name regex now includes superscripts ¹/²/³ alongside ASCII 1–9 for both families. The regression covers both COM/LPT families, upper/lower/mixed case, all three superscripts and empty/.txt/.exe extensions: 54 declaration cases, with zero path/device access. This follows the reviewer's [Windows naming conventions reference](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file#naming-conventions). Only this regex, its pure test and appended evidence changed.

After correction, `node --test --test-reporter=dot server/testing/production/manifest.test.mjs` exited 0 with 84 passing test cases, no skips. Full npm run check for the correction remains pending by parent instruction while the integrated R04 full-server run owns the DB/TypeScript slot; no concurrent compiler or broad suite was started. Dependency identity, launcher, filesystem/live/transport/trust/egress execution gates remain false/open. Independent re-review of this follow-up is pending; it does not change the accepted design or grant execution permission.

## Integrated runner discovery correction

The parent full-server run at320a8fe passed all3099 Vitest tests but failed one
additional discovered file: manifest.test.mjs uses node:test, so Vitest reported
"No test suite found". Log: .local/r01-integrated/server-full-320a8fe.log,
230 passing files/one failed suite,363.68s, exit1. This run is not a full pass.

The native suite is renamed byte-for-byte to manifest.regression.mjs, matching
existing server/testing native regression naming. Vitest discovery/configuration
is unchanged, and no assertion is removed. Current native command:
`node --test server/testing/production/manifest.regression.mjs`.
Fresh native verification and a complete server retry are required; the earlier
83/84-test commands above retain their historical filename.

The independent reviewer accepted the byte-identical rename in `f9e7d7e`.
Fresh explicit native verification passed **84/84**, zero skips, 235.31ms,
exit 0 (`.local/r20-golden/manifest-discovery-native.log`). The complete
protected server retry at exact `f9e7d7ef6411fca6c9e0a6688b43ed3a31a5aae5`
passed **230 files / 3,099 tests**, zero failures/skips, 359.20s, exit 0
(`.local/r01-integrated/server-full-f9e7d7e.log`). No source changes occurred
during that run. Native assertions remain separately executed; all production
manifest certifications and dependency-custody/execution gates remain false.
