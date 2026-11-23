# R20 application-root inventory architecture decision

30 October 2026. Reviewer: `r20_application_inventory_checkpoint`, Astra High.
Reviewed canonical HEAD: `545c3004f6729a3d3274e5a2b994a1a40636e770`.
Authority: master completion specification v2.6; the 29 October application
module identity contract remains governing. This document accepts bounded
implementation architecture, not nonexistent implementation or runtime results.

## Adjudication and next task

**Proceed with a separate, inert application-root inventory and literal-ESM
resolution observation slice. Do not implement a stage consumer in this slice.**
The accepted emitter can supply its declared graph; existing old-root and
component brands cannot supply application authority. This decision unblocks
local implementation and focused synthetic filesystem tests under the existing
campaign authorization. Independent source review and Astra final assessment
of the exact candidate remain required before integration acceptance.

Implement a pure application inventory reader first, then a no-evaluation
candidate collector/observer under the contract below. A successful observation
means only that declared roots resolved to measured files in that physical
layout during that observation. It does not establish the transitive package
closure, application staging, custody, module identity at load time, producer
admission, required job capability, or permission to evaluate the application.

Do not alter the ordinary build/start commands, the accepted emitter, or the
existing component readers/stagers to make this new inventory fit. In particular,
do not substitute the deferred entry into an old manifest's `index.js` role or
retag the historical package tree as an application tree.

## Evidence reviewed and current drift check

Read the master R20/governance contract, companion R20 work order, application
module identity plan, and latest application-package-preparation evidence. Source
review covered `runtime-resolution.mjs`, `runtime-package-tree.mjs`,
`installed-runtime-stage.mjs`, `layout.mjs`, relevant loading controls, primitives,
Windows metadata helper, emitter/constants, and required-job consumer call sites.
Paths without a prefix in this paragraph are under `server/testing/production/`.

The preparation file remains inert:

- `.local/r20-profile-build-oct29/application-package-preparation.json`, SHA-256
  `533689468b84603b1e5250134957a705f82557e2ff06e0a2bdcf7580d87cc67b`.
- Its graph file is `.local/r20-profile-build-oct29/emission-final/.runtime/production-profile.json`,
  raw-file SHA-256 `8b8ef7db0c834df797500d8ffa0e6645e0f42be49f60a2acb15a1f3bc5735265`;
  its distinct declared graph digest is
  `c6562d9ca21af13943ccb6d0236952f1227187b31b5aa13fe51853779f47910f`.
- It contains 41 distinct package rows: 35 from the emitted application and six
  from four trusted parents. Each is a parent/kind/specifier tuple, not merely a
  package name. Every resolution remains unobserved and every closure pending.
- Its historical package tree is bound to build
  `e47d53cdb18eaf29fc56a2ce117ea4fe07f31bde`, not this application inventory.

During this checkpoint, read-only SHA-256/size comparisons found **zero drift
across all 489 declared source rows** (467 application inputs and 22 trusted
sources), and **zero drift across all 23 emitted output rows**, against the
reviewed checkout/files. Preparation and graph raw hashes above were reread.
These checks do not add missing compiler-configuration provenance: tsconfig and
inherited configuration bytes are not fully captured. The graph also carries no
build commit identity. A new envelope must independently pin its source/review
revision and must not manufacture historical provenance from current HEAD.

No tests, resolver observations, selected module evaluation, services, package
installation, databases, native loads or provider calls were performed in this
checkpoint. Existing reported test results were read as historical evidence.
The only authored file is this decision. The coordinator's concurrent R00 audit
artifact was preserved.

## Why existing contracts cannot be substituted

| Existing mechanism | Source finding | Reuse decision |
| --- | --- | --- |
| `runtime-resolution.mjs` | Reader requires a production manifest; observer checks metafile entry `server/index-prod.ts`; edges have no parent and are keyed by kind/specifier. Require calls remain uncovered. | Reuse validation/observation patterns, not its input record, WeakMap lineage, old entry assumptions or observation claims. |
| `runtime-package-tree.mjs` | Re-reads that old inventory; root edges use `$root`; collector initially chooses top-level package names. Reachability and selected file checks are bound to the old roots. | Reuse bounded package/file census ideas later. Its brand and root rows cannot accept the application by renaming fields. |
| `installed-runtime-stage.mjs` | Requires the old tree brand; fixes `dist/index.js`, the Sharp/GeoIP native/data join and four component harness modules. | Preserve unchanged. Its `staged-installed-runtime` brand is component evidence only. |
| `layout.mjs` / production manifest | Server role explicitly requires `index.js`. | Do not weaken this role. New application observation uses an independent envelope, not a forged production manifest. |
| Emitter graph | Declares one application, 22 trusted members, mapped literal edges and compile byte pins; some target values are JSON null. | Parse as its own bounded graph schema and check the exact digest algorithm. It is declared compile evidence, never a runtime manifest or authority brand. |
| `primitives.mjs`, Windows metadata helper | Useful canonical scalar checks, Windows path constraints, stable identities and reparse checks. The generic canonical parser rejects null and imposes its own shape/size limits. | Reuse compatible exported helpers unchanged. Do not pass the whole emitter graph through the incompatible parser or relax shared parser limits globally. |

A small new application module is preferable to generalizing accepted component
code now: it keeps the admission boundary reviewable at the cost of some repeated
validation code. A later refactor can extract genuinely common pure helpers after
both contracts have independent regression coverage. No new global registry,
serialized acceptance flag, brand transfer or loader authority is justified.

## Inventory contract v1

Use distinct names such as `pfa-application-root-inventory` and
`validated-application-root-inventory`; version 1. Proposed API names are
`readApplicationRootInventory`, `collectApplicationRootCandidate`, and
`observeApplicationRootResolution`. Names may change without changing the
following semantics. Reader acceptance is structural/pin consistency only.
The collector returns untrusted candidate material; only the reader creates a
private application-specific declaration brand. The observer requires that
brand and may create a separate observation brand. Neither brand has a consumer
outside this slice. JSON copies, reconstructed objects and old brands must fail.

The reader accepts graph bytes, inventory bytes and independently supplied caller
pins, not mutable live objects with accessors/proxies. Parse, validate, normalize
and deep-freeze new data. Reject unknown fields/versions, duplicate JSON keys,
ambiguous encoding, aliases, conflicting duplicates, unsafe paths and exceeded
bounds. Do not mutate caller input. Hash raw graph bytes separately from the
emitter's stable-JSON digest with `graphSha256` omitted; verify both, including
the expected final newline when checking emitter canonical bytes.

The inventory must carry these closed-schema groups:

| Group | Required binding |
| --- | --- |
| Identity | Kind/version, unique observation/candidate ID, evidence class (`synthetic-fixture` or `declared-installed-candidate`), review reference, independently pinned source revision and observer/harness revision or exact source-file pin set. |
| Graph | Raw graph file size/hash, declared graph digest, exact graph schema version, immutable emission-root absolute path and graph relative path. Record compile-only provenance limits explicitly. Preparation hash may be a reference; its name-membership rows are never input authority. |
| Runtime | Exact Node executable canonical absolute path, size/hash, version `24.22.0`, `win32`, `arm64`, exact allowed argv/flags and clean environment policy. Bind the actual executable and observer code, not a caller-provided version label. |
| Resolution policy | Versioned native default ESM-resolution profile for that pinned runtime, additional conditions empty, no custom loaders/preloads/hooks, no preserve-symlinks override, no ambient `NODE_OPTIONS` or `NODE_PATH`. Import and require are separate modes. |
| Members | Application and every declared trusted member: exact stage-relative path, physical parent URL derived from emission root, source/output mapping, format, source/output size/hash and entry role. Application source must be `server/production-application.ts`, output `dist/production-application.js`. |
| External edges | Exact emitted parent, original graph kind, normalized resolution mode, literal specifier, occurrence count and expected target disposition. Preserve parent identity even when multiple parents resolve to the same package/file. |
| Files and lookup controls | Approved dependency-root boundaries; selected target file pins; selected package and scope-manifest pins; relevant lookup-directory identities/listings and absent probes; project package/lock pins when recording their relationship. These are resolution inputs, not package installation authority. |
| Coverage | Required blockers and explicit unobserved/unsupported cases; complete declared-root census versus successfully observed subset. All stage/custody/transitive-closure/runtime-module-identity/execution certifications remain false. |

Use bounded data structures: at most 256 emitted members, 8,192 application
source mappings, 4,096 graph import occurrences, 256 distinct external edges,
128 blocker rows, 1 MiB graph text, 2 MiB inventory text, 1 MiB per package
manifest, 32 MiB per selected package target, 128 MiB runtime executable,
256 MiB total measured file bytes and a 60-second observation deadline.
Lookup/control lists also need explicit finite limits (maximum 4,096 unique
paths/probes and 1,024 paths per metadata batch). Refuse limit overflow; never
truncate. These maxima are validation bounds, not an instruction to scan a whole
installation. Implementer may choose stricter bounds if the reviewed real graph
and negative fixtures fit; increases require review.

Normalize `import` and `export` trusted edges, and application
`import-statement`, to ESM static resolution while retaining the original kind.
Literal `dynamic-import` is a separate edge class with the same pinned native ESM
resolution policy. Exclude type-only edges from runtime resolution, but retain
and validate their graph disposition. Builtins must be explicit normalized
`node:` targets, never package-file successes. All declared internal edges must
match their exact mapped targets; the application's sole trusted edge is the
fixed public getter. Include internal/builtin counts in coverage so the 41-package
preparation list cannot silently become the entire graph.

Do not guess that import resolution proves require resolution. Require edges,
computed specifiers, unsupported import attributes, package `#imports` or other
unsupported schemes/topologies remain explicit required blockers in v1. Unknown
syntax/kinds must refuse, not disappear during normalization. A declared graph
does not prove the absence of arbitrary computed code or semantically altered
authority copies in emitted JavaScript; this slice must not certify that wider
claim. Later loader/source review must cover it.

## Parent, conditions and physical identity observation

Resolve each package edge using native `import.meta.resolve` with the **actual
emitted parent file URL**, under the pinned runtime's explicit-parent support
flag. The parent is not the observer, repository root, old `index.js`, or a fake
future stage URL. The current emission lives beneath `.local`; observations there
cannot predict resolution after relocation into a stage.

The policy identifies the complete default behavior by executable hash/version
and an exact invocation. Do not claim an inferred list such as only `node` and
`import` exhausts Node's defaults. Pin any supplied conditions (none in v1),
reject other flags/environment influences, and demonstrate default conditional
export selection in synthetic fixtures under the actual selected Node binary.
Record failures for blocked subpath exports and missing targets rather than
falling back to package-name matching, `require.resolve`, or a guessed `main`.

Resolution must not evaluate selected packages or any application/trusted output.
The observer process loads only its reviewed harness closure and Node builtins;
it must not import application getters, installers, factories, package entries,
configuration/env initializers or native addons. No caller-supplied resolver
callback or preload can stand in for native observation. A narrowly pinned
Windows metadata subprocess is permitted as metadata collection, not a shell
for executing selected code. No network, service, credentials or DB are needed.

Bind all graph output files, graph bytes, runtime, selected package files and
resolution-sensitive metadata to exact canonical paths. Require exact realpath
and URL round trips; reject URL query/hash, case aliases, encoded separators,
symlinks, junctions/reparse points, multiple hardlinks and out-of-bound targets.
Do not deduplicate equal bytes at different paths into one module identity.
Format for `.js` must bind the actual applicable package scope; an ESM request
can resolve to a CommonJS file, which is not proof that its execution is safe.
JSON/native/unsupported selected formats remain blockers for this bounded slice.

Inventory lookup inputs must include ancestor package scopes, selected package
exports/type metadata and nearer lookup locations whose appearance could change
selection. Bind positive manifests and relevant negative probes/listings. If the
collector cannot enumerate that bounded lookup footprint, return an explicit
unsupported-footprint blocker; do not label partial metadata as complete.
Do not read arbitrary files outside approved dependency boundaries merely because
the resolver would search there. An unexpected external package/scope or escape
must refuse. Project lock/manifest version agreement is useful provenance, but
cannot replace actual target/path measurement.

Before and after resolution, verify file and ancestor identity, Windows metadata,
selected bytes, manifest bytes, directory memberships and absence probes. Bind
opened descriptors to pre-observation identities with `fstat`, hash from those
descriptors, and repeat native resolution. Refuse changed bytes, file replacement,
ancestor changes, newly shadowing packages, changed absences, timeout or failed
cleanup. Always close handles. A fresh subprocess avoids carrying a prior
resolution cache from a different observation. Even a successful before/after
check is an observation window, not continuous custody against concurrent
mutation; all custody and execution claims stay false.

Candidate collection may discover paths and bytes under these same safeguards,
but produces no acceptance brand. Independently pin that serialized candidate
before reading/reobserving it; never promote a collector result solely because
its own digest agrees with itself. The coordinator records what was observed,
which source files were reviewed, and the exact independently supplied pins.

## Required acceptance and refusal cases

Focused tests must exercise behavior, not merely mirror schema implementation:

1. A poisoned application and package with observable top-level side effects
   resolve without those effects running. No DB/network/env initialization or
   native loading occurs. Testing this boundary must not import the poison to
   prove it exists.
2. Two physical emitted parents resolve the same package name to different
   nearest installations; the inventory preserves both results. Reject a
   swapped parent, missing edge, wrong occurrence count, collapsed tuple, old
   index root, absent trusted member and altered getter target.
3. Conditional exports choose the native default ESM branch; require-only,
   excluded subpath and custom-condition fixtures cannot become ESM successes.
   Reject runtime/argv/env mismatch and forged condition labels.
4. Reject raw graph pin drift, declared graph digest drift, selected output or
   source-map substitution, target bytes/size drift and differing package scopes.
   A caller-updated self-hash does not override the separately supplied pins.
5. Reject case/query/hash/path aliases, copied same-byte authority paths,
   symlink/junction/hardlink targets, escapes and duplicate/conflicting keys.
   Fixtures must report unsupported host capabilities as explicit limits, not
   passing tests of a capability that was never exercised.
6. Detect target or metadata replacement, new nearer `node_modules` selection,
   disappearing files and absence/listing changes during observation. Verify
   descriptor cleanup on refusal and deadline expiry.
7. Preserve require/nonliteral/unsupported cases as required blockers; incomplete
   candidates cannot claim all roots observed. Builtin/internal graph rows are
   counted but never masquerade as observed package roots.
8. Reject an old inventory/tree/stage brand, a JSON clone, and fabricated
   acceptance booleans. Observation output must have all wider certifications
   false even when every supported declared edge resolves.

Review the exact new source and focused raw results before acceptance. Keep
synthetic fixture evidence separate from any real installed-root observation.
The current checkpoint did not execute these tests. Broad suites remain under
coordinator scheduling and must not contend with another active host suite.

## Ownership, remaining decisions and stop conditions

Recommended implementation ownership: one implementer owns only new
`server/testing/production/application-root-inventory.mjs`,
`application-root-observation.mjs` and their focused regression modules; optional
new application-only parsing/helper modules require the same explicit path claim.
Parent owns campaign/evidence updates, source freeze, serial verification and
integration. A separate reviewer owns independent review, with Astra final
assessment. Preserve other agents' edits. No edits to package/lock files,
existing brands, emitter, loaders, Redis consumers, startup or health are needed.

The immediately implementable task is the closed-schema reader, normalization,
independent pin checks, disjoint private lineage and synthetic negative fixtures.
Collector/observer code may then implement the above contract in the same bounded
slice. If native metadata-footprint enumeration or default-condition behavior
cannot be established under the pinned runtime, stop that observer path with a
specific blocker while completing the reader. Do not weaken controls to obtain
an observation. This is no approval of any as-yet-unwritten code.

Remaining **later** architecture/acceptance work includes an application-rooted
transitive package census, application manifest and stage allocation, native/data
joins, continuous custody, loader enforcement before/after caching, bootstrap
issuer/module identity, deferred effectful app import, and protected negative
runtime windows. Existing Sharp/GeoIP evidence remains component-only. A future
stage must independently rebind its physical layout and parent edges; source
observation is not portable stage authority. These obligations are not settled
by giving a new inventory a brand.

Required-job startup refusal remains mandatory. Current source throws
`REDIS_PROFILE_REQUIRED_JOB_CAPABILITY_MISSING` for an admitted profile; scheduler
initialization checks it before cron registration, and readiness/startup include
required jobs. Do not bypass it using ordinary `REDIS_URL`, disabled jobs, mocks
in application execution, or an invented lock protocol. R14/R19 own the missing
durable job capability. Source refusal behavior is not a full application success.

Owned Redis application proof, native PostgreSQL TLS, full protected HTTPS
journeys, persistence/readback and all canonical completion groups remain open.
Production/shared DB, external provisioning, paid services, real messages,
deployment and release retain their existing gates. No renewed owner permission
is needed merely to implement this accepted inert local slice.
