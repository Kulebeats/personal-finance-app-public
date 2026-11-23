# R20 native external-import resolution and entry-byte milestone

Design for independent/parent review, 28 October 2026. Baseline
`5db5f5a9e2be29fedcfefef85e868446f06b4270`, isolated branch
`codex/capital-r20-runtime-resolution` in `capital-r19-foundation`.
Governing plan: `docs/plans/2026-10-28-r02-csrf-and-runtime-resolution.md` in the
canonical worktree. Independent and parent accepted the initial design at SHA256
`D73F909C02789AA58D7F099CF03C7A868DE9AD57FA5C3CF603DB26D988498660`,
then separately released exactly the two source files and pure tests. The source
checkpoint below records that implementation. Native observations/fixture creation,
static/broad execution and runtime allocation are still unreleased. No listener,
network, database, installation or profile/permission change is included.

## Concrete milestone and two-file interface

Add only `server/testing/production/runtime-resolution.mjs` and
`server/testing/production/runtime-resolution.regression.mjs` after review and
parent allocation. Keep manifest v1, package/build scripts, ordinary guards,
recovery/native component sources and application source unchanged.

```text
readRuntimeResolutionInventory(profileRecord, canonicalInventoryText, callerPins)
  -> private-branded, copied/frozen inventory
observeRuntimeResolution(inventoryRecord, { systemRoot })
  -> private-branded, copied/frozen observation
```

The first function is pure and requires the existing original
`requireProductionManifest` brand. The second requires its own original inventory
brand, performs only bounded native resolution/file observations and the existing
fixed Windows metadata subprocess, and evaluates no application/dependency module.
Do not add injectable production resolver/fs/process callbacks; focused tests may
mock builtins using existing test techniques. Module import is inert.

Use actual Node ESM `import.meta.resolve(specifier, entryFileURL)` with only the
explicit `--experimental-import-meta-resolve` flag allowed for the observation
process. A native fixture must prove that Node24.22.0 honors the supplied parent
and selects import-mode conditional exports before installed observation can be
accepted. If this exact runtime does not honor it, refuse and return the concrete
finding; no require.resolve, TypeScript resolution, custom loader, source
evaluation, alternate CJS build or hand-written resolution fallback.

## Closed inventory and independent expectations

The inventory is canonical JSON using existing bounded descriptor/canonical/path
helpers. Its exact top-level keys are:

```text
{ kind: "pfa-runtime-root-resolution", version: 1,
  evidenceClass: "synthetic-fixture" | "declared-installed-candidate",
  manifestSha256, runId, buildCommitSha, harnessCommitSha, approvalRef,
  runtime: { executable: FilePin, version: "24.22.0", platform: "win32",
             arch: "arm64", flag: "--experimental-import-meta-resolve" },
  dependencyRoots: [AbsolutePath, ...],
  metafile: { file: FilePin, outputKey: RelativePath },
  packageMetadata: [FilePin, ...],
  edges: [{ specifier, kind: "import-statement" | "dynamic-import" | "require-call", occurrences,
            target: { kind: "builtin", name: "node:..." }
                  | { kind: "file", file: FilePin }
                  | { kind: "uncovered", reason: "require-conditions" } }, ...],
  uncoveredNonliteral: [{ sourceRef, reason: "computed-runtime-specifier" }, ...] }
FilePin = { path: AbsolutePath, size: PositiveInteger, sha256: Sha256 }
callerPins = { expectedInventorySha256, manifestSha256, runId, buildCommitSha,
               harnessCommitSha, evidenceClass, approvalRef }
```

Every caller pin must agree independently; never derive missing expectations from
the supplied inventory or stat the files to fill expected hashes/sizes. Entry is
the existing profile's one `server-entry` at `buildRoot/index.js`; its expected
size/hash comes from that original branded profile. Reject extra fields/defaults,
forged/cloned brands, getters/proxies/caller mutation, unsupported modes and flags.
Dependency roots are exact, sorted, disjoint absolute paths, disjoint from mutable
profile roots, and cannot equal/contain the build root. File targets must be strict
descendants of one listed dependency root. Node executable and controlling
package metadata are separately exact-file pins, never directory read grants.

Bound the canonical inventory to existing256KiB/depth10/12000-node limits;
at most8 dependency roots,128 unique kind/specifier edges,128 metadata files,
256 unique selected files and512 distinct ancestor paths. Specifiers are at most
256 characters, with no URL/query/fragment/encoded separator/relative/absolute/
backslash form; only supported bare package/subpath specifiers and real Node
builtins. Sort unique edges by kind/specifier and retain positive occurrence
counts; compare the complete declared literal-root multiset, not a regex-derived
sample. Bound uncoveredNonliteral to32 source references, each<=256 characters.
These parent-reviewed source references record gaps that the metafile does not
discover; an empty list is not proof that computed loading cannot exist.

Read the pinned actual esbuild metafile as bounded raw JSON, not as the custom
canonical inventory format. Existing build metadata is not canonical JSON.
Limit it to8MiB,8 outputs,8192 input entries and4096 selected-output import
records; refuse excess rather than truncate. The raw metafile uses its own
bounded JSON/projection validation, never the canonical helper's256KiB/node caps.
Select exactly its pinned outputKey, require its entryPoint to
identify `server/index-prod.ts`, output byte count to match the observed entry,
and validate/project its output imports using the installed esbuild Metafile
schema. Require every external `import-statement`/`dynamic-import`/`require-call`
record to have an inventory counterpart with its actual occurrence count; unknown
external kinds, nonexternal runtime output imports or unsupported output layout
refuse. Other input metadata
is never executable configuration. A metafile hash/output byte count does not
authenticate build provenance: that binding is the parent's reviewed build record.

Coverage is finite and explicit: static ESM and literal ESM dynamic imports use
native import-mode resolution and file readback; builtins are normalized known
identifier observations only, never standalone file hashes. Require the pinned
runtime's actual `isBuiltin` from node:module to recognize both the supplied
identifier and its canonical node: form; a node: prefix or import.meta.resolve
return value alone is insufficient. Reject an unknown builtin before recording
an observation. A literal require-call
of a package must have target=uncovered/reason=require-conditions and is never
passed to the ESM resolver. A require-call of a builtin may be classified as a
known identifier only, without claiming its CJS call executed. Return the observed
ESM static/dynamic sets, builtin-identifier set, unresolved require-call set and
declared nonliteral gap set separately. Completeness means matching this literal
metafile multiset, not resolving every runtime loading mode. Current canonical
dist visibly includes literal `import("file-type")` and
`__require("posthog-node")`; the former can receive this bounded ESM resolution
observation, while the latter remains an explicit CJS-conditions gap. Neither
may be omitted to produce an apparently complete root result.

Package metadata pins cover the declared root package scope, selected package
scope and ancestor package.json files that can control these root resolutions.
Their bytes are observed before and after resolution. The independent preparer
must explicitly inventory that footprint; do not claim Node exposes a complete
metadata-read trace. Native resolution may probe ancestor/package lookup
candidates not returned by that API; this is not exhaustive read allowlisting.
Unexpected nested shadowing must change the native result
and refuse. Transitive package imports and all dynamic nonliteral specifiers are
outside this root-only milestone and cannot be silently treated as absent.

## Candidate provenance versus synthetic fixtures

An installed-candidate allocation requires parent-held pins from a separate
reviewed record: exact application/harness commit; Node executable file bytes;
unchanged build options; actual entry and metafile from the same invocation;
root import multiset; expected native target paths and entry bytes; controlling
metadata bytes; permitted dependency roots; and exact inventory/manifest digests.
The author cannot supply a regenerated colocated pin set as independent evidence.
The pure reader compares expectations but cannot authenticate who supplied them.

The current package command uses packages=external and emits no metafile. Parent
alone owns capture of the actual matching build/metafile and may make one
separately scheduled same-options esbuild invocation with only a
`--metafile` observation output; no package.json edit or changed compilation is
needed. The observer neither builds nor fabricates metadata nor takes ownership
of build/package files. Bind both resulting files to that invocation and candidate; do not join
a new metafile to an old ignored dist file merely because sizes agree. No such
build or installed-candidate inventory is currently allocated by this document.

The regression entry's native CLI supports **synthetic-fixture only**, with fixed
reviewed fixture bytes, absent run root and class. Its report permanently records
that class and cannot accept an installed-class CLI/env override. Synthetic
manifest/caller hashes may be computed from known fixture declarations for tests;
that is labelled fixture consistency, never independent installed provenance.
The production observer can accept a separately pinned installed inventory only
through its exported API under a later parent allocation. Neither path returns
provenanceAuthenticated or executionAuthorized true.

## Native observation and custody limits

Verify process platform/version/arch/executable against the exact pins and reject
NODE_OPTIONS/NODE_PATH, loaders, conditions, symlink-preservation, evaluation,
certificate-ignore and other undeclared flags. Parent launches a fresh process
with exactly four supplied variables: SystemRoot/TZ/TEMP/TMP. The effective
Windows environment must contain exactly those plus the mandatory OS-injected
PROCESSOR_ARCHITECTURE=ARM64, consistent with process.arch=arm64; missing, wrong
or additional variables refuse. Reuse
`readWindowsMetadata` unchanged for its fixed JSON-stdin metadata bridge; no custom
PowerShell, shell interpolation, environment map or subprocess executable input.
Do not import recovery's producer/restore record machinery or the PG component's
fixed target/ACL/process launcher to attest unrelated runtime files.

Validate every selected file/ancestor with lstat/native realpath, regular-file or
directory type, stable identity and file link-count1; reject all reparse metadata
and aliases. Pin Node executable<=128MiB, entry<=100MiB, target<=32MiB,
metadata<=1MiB each and metafile<=8MiB, with256MiB total selected bytes. Open only
O_RDONLY descriptors; bind fstat identity to pre-open path identity, read/hash in
64KiB chunks and parse the same opened metadata/metafile bytes. Retain descriptors
through before/after metadata, path and fstat comparisons. Close every descriptor
on success/refusal. No file content or generic exception text enters evidence.

Run native resolution only between those observations. Require exact expected
builtin name or file URL, convert with Node's fileURLToPath and reject suffixes,
non-file protocols or noncanonical/out-of-root paths. Compare actual target bytes
through their opened descriptor, not a later unchecked content read. Recheck
declared package metadata and native results before close to expose changed
observations; do not claim this prevents every transient swap or Node cache race.

At most256 descriptors,512 ancestor metadata rows and two metadata children per
observation; each existing child is bounded at5s. At most128 distinct file edges
and256 total native resolve calls, including the useful second resolution pass,
60s operation deadline and2min parent process deadline; synchronous FS/resolver
operations are not a hard realtime guarantee. Parent may terminate only its
captured child on expiry. No resolver subprocess per edge and no new launcher.
The Node resolver may internally reopen metadata paths; this observer neither
controls those exact reads nor holds immutable custody through future loading.
Observed before/after agreement must not be described as continuous custody.

Result records contain evidenceClass, exact manifest/inventory/build/runtime
identities, classified coverage sets, relative/specifier resolution observations,
expected digest matches and counts only. Certifications are
esmRootResolutionsObserved=true and selectedEntryBytesObserved=true for a
successful observation of all declared ESM roots; unresolved CJS/nonliteral sets
remain visibly uncovered and cannot earn an all-runtime-roots assertion.
transitiveClosureComplete/custodyHeld/runtimeDependencyIdentity/
executionAuthorized remain false. Existing production-manifest certifications
are never changed. Emit static `RUNTIME_RESOLUTION_REFUSED` on failure, no supplied
paths/payloads, file contents or unfiltered native error messages.

## Required tests and proposed native allocation

Pure tests cover canonical bounds/unknown fields, copied/forged brands, wrong
profile/candidate/runtime/metafile/class pins, extra/missing/import-kind/occurrence
edges, CJS edges incorrectly given ESM file targets, omitted uncovered sets,
caller mutation and unsupported specifiers. File/native refusal controls
cover wrong size/byte, missing file, hardlink, real junction ancestry, metadata
changes, same-size mutation, identical-byte path replacement, escaped targets,
conditional-export mismatch, nested package shadowing and descriptor closure.
Use literal fixture expectations independent of the observed resolver result;
assert each mutation hook actually ran rather than interpreting silence as proof.

Native proposal, **not allocated**:

- Run ID `r20res20261028b1`; parent-proposed absent root
  `C:\Users\USER\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\r20-runtime-resolution-oct28b`.
  Parent rechecks all ancestors and absence immediately before create-only use;
  an existing root refuses. Fixture files live only beneath it. No dependency
  install, real-package evaluation or existing-profile mutation.
- Node executable
  `C:\Users\USER\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\capital-r00-runtime\node-v24.22.0-win-arm64\node.exe`;
  parent must supply its actual size/hash and reviewed harness/fixture pins.
  Pure parser tests use `--test --test-concurrency=1`. Native CLI is that pinned
  Node plus `--experimental-import-meta-resolve`, the exact regression file,
  `--run-owned-native-fixture r20res20261028b1`; no arbitrary paths or flags.
  Fixed parent-owned TEMP/TMP for the entire run is
  `C:\Users\USER\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\r20-installed-resolution-oct28\native-temp`.
  Parent creates that directory before launch; preflight validates it and every
  ancestor. The fixture neither creates nor deletes it and never creates root/temp.
- Fixture contains two inert parent entries in different trees, each resolving
  the same bare package name to distinct pinned files; one dual import/require
  export and one nearer nested shadow. Node must resolve using the supplied
  entry parent, select import rather than require, and observe the expected
  changed shadow target for its negative. Module files contain a marker-writing
  evaluation sentinel; marker absence before/after is mandatory. Never import
  the parent entries, package modules or .node addons.
- A separately labelled fixed synthetic metafile tests projection. It cannot be
  presented as actual esbuild-produced metadata or installed-candidate evidence.
  No actual candidate native allocation follows until the parent supplies the
  real same-build metafile, root list, byte/metadata pins and readback record.
- At most16 synthetic observations per fresh allocation, one Node process,
  at most32 fixed metadata children, no other subprocess/network/listener/DB.
  Cleanup checks root/ancestor/descendant identities and removes only exact owned
  fixture descendants; keep sanitized evidence/root as a nonreusable run marker.
  Unexpected identity/cleanup state stops and is reported, never force-removed.

## Finite follow-through to the actual dependency gate

This milestone supplies root resolution identities and actual entry-byte
observations; it does not close runtimeDependencyIdentity. Three remaining
deliverables should consume this same graph/policy rather than add unrelated
observation frameworks:

1. Complete the deployable runtime closure from these roots: all ESM/CJS,
   dynamic branches, data and native addons plus required DLLs. Unsupported
   computed resolution must be eliminated or explicitly governed; a finite
   reviewable inventory and unknown-load refusal oracle are the exit criteria.
2. Bind that inventory to one parent-owned staged candidate and enforce custody
   and exact allowed resolution/loading through its entire lifetime. Address
   Node metadata caches, path reopening and native DLL resolution explicitly;
   held read descriptors or owner-only ACL alone cannot assert no other writer.
   Mismatch/unknown-file/replacement must refuse before that code executes.
3. Integrate those accepted closure/custody controls into a separately reviewed
   production-profile contract version and its actual pre-import consumer.
   Only that integrated proof may earn runtimeDependencyIdentity=true; it still
   cannot authorize launch until Redis/native HTTPS/PG/egress/secret and parent
   allocation gates pass. Add SMTP/MIME directly to that shared profile later.

Parent/reviewer design acceptance and exact file/native-pin amendment precede
implementation. Nothing here allocates code execution or changes release status.

## Initial source checkpoint and pure red/green evidence

The two approved source files are implemented, with no changes to manifest v1,
existing helpers, build/package scripts, app or guards. `runtime-resolution.mjs`
is223 lines; its regression file is552 lines including the fixed native fixture.
The observer implements descriptor
hash/readback, the existing metadata bridge protocol, native-ESM resolution and
explicit coverage sets. It remains inert until its branded-record API is called.
The fixed fixture CLI is implemented after parent protocol acceptance, but native
execution/root creation remains unreleased pending exact source review and parent
pins. An ordinary import exposes only pure fixture declaration helpers and
registers no tests or native work; the explicit test entry runs the pure suite.

Executed only the pinned Node's bounded pure/fake suite:

```text
C:\Users\USER\AppData\Local\capital-r00-runtime\node-v24.22.0-win-arm64\node.exe --test --test-concurrency=1 server/testing/production/runtime-resolution.regression.mjs
```

Observed red before the reader existed: the positive assertion required the
missing reader; the expanded38-test contract set also failed. Reader green:38/38.
Observer red before implementation:10 selected fake-observer tests failed for
the missing function. Combined green:48/48. Final focused verification after
additional adversarial readback controls:59/59 passed. Independent review then
identified case-folded path equivalence: three fake controls reproduced incorrect
acceptance for root containment, resolver target and process executable spelling;
exact local spelling checks repaired them. The four stdin cleanup/UTF8 controls
and one close-all-descriptors control likewise failed before their corrections.
Eight protocol/blueprint tests failed before those declarations were implemented.
Final current focused verification: **77/77 passed,0 skips, exit0,319.3013ms**.
This is source/contract evidence, not native resolution evidence.

The observer positives replace fs methods, metadata execFile, process executable,
flags and environment with in-memory fakes. Most use builtin-identifier and
unresolved-CJS edges. The two file-branch controls use a test-only builtin result
mapped to a fake file URL, with the builtin classifier mocked; they prove the
path-comparison branch, not real package resolution. No fixture
root, real selected-file descriptor, native metadata process, app/dependency
evaluation or installed dependency observation occurred. Real parent-sensitive
ESM/conditional resolution, actual Windows alias/metadata behavior, installed
candidate pins and all native claims remain for the later released run. Static
and broad checks await the parent-assigned slot; no unrun check is reported green.

## Proposed native CLI and parent-supplied stdin allocation

Parent/general reviewer accepted this protocol for source implementation; the
fixed fixture branch is now written within the existing regression file. Actual
native execution remains gated. No third module or launcher is proposed.
The only future native CLI is the pinned absolute Node executable, exactly
`--experimental-import-meta-resolve`, the exact reviewed regression file and
`--run-owned-native-fixture r20res20261028b1`. No path, mode, environment, command,
resolver flag or hash override is accepted through argv.

Read one canonical JSON record from stdin through EOF: at most64KiB and a5s
deadline; reject missing input, trailing bytes, duplicate/extra fields, malformed
data, accessors/prototypes after copying and any mismatch. Its closed shape is:

```text
{ kind: "pfa-runtime-resolution-fixture-allocation", version: 1,
  runId: "r20res20261028b1", evidenceClass: "synthetic-fixture",
  root: <the exact parent-proposed absent root above>,
  runtime: { executable: FilePin, version: "24.22.0", platform: "win32",
             arch: "arm64", flag: "--experimental-import-meta-resolve" },
  harnessCommitSha: Sha40, approvalRef: ReviewRef,
  harnessFiles: [FilePin, ...],
  expectedFixtureBlueprintSha256: Sha256,
  expectedFixtureManifestSha256: Sha256,
  expectedFixtureInventorySha256: Sha256 }
```

Parent supplies **all** file sizes/hashes and expected digests from its independently
reviewed dispatch record. The runner may hash observed bytes to compare with them;
it must never replace a missing/failed expectation with the observed value.
Require the exact finite harness file set, not an arbitrary list: the two new
files, production manifest/fixture/primitives/layout/services/security, and
recovery windows-metadata/common/paths (11 files). Bound each source pin to1MiB,
the runtime pin to128MiB and the list to exactly those paths. Parent readback must
also bind the introducing harness commit and fixed literal fixture blueprint.
These checks identify supplied/local bytes, not authenticated software provenance
or protection against every bootstrap/reopen race.

Before the first fixture write, compare runtime path/version/platform/arch/flag,
Node bytes, every harness byte and the fixed blueprint digest against the supplied
expectations; verify exact root ancestry and create-only absence. No fallback
pins are generated from the current workspace, installed packages or env. The
fixed fixture manifest/inventory must match the separately supplied expected
digests; generating their declarations for a synthetic test does not create
independent installed-candidate provenance. Record only synthetic-fixture class,
run/pin identities, expected-match booleans, coverage and sentinel/cleanup results.
The fixture CLI cannot switch evidence class or consume an installed inventory.

The parent-supplied launch environment remains exactly SystemRoot/TZ/TEMP/TMP;
Windows adds the mandatory fifth effective key PROCESSOR_ARCHITECTURE=ARM64.
Both observer and fixture bind that exact five-key shape and the pinned arm64
process. No arbitrary extra variable is admitted. TEMP/TMP are the fixed existing
external native-temp directory above throughout the process; there is no
environment phase mutation, PATH, HOME, NODE_OPTIONS,
NODE_PATH, provider variable or new environment-controlled allocation input.
The existing metadata child independently retains its SystemRoot-only environment.
No JSON path is interpolated into shell code. All remaining native bounds and
create-only cleanup rules above remain in force.

Parent can independently prepare the three fixture digests without invoking the
native branch: import `nativeFixtureProtocol` and `nativeFixtureDeclarations`
from the exact frozen regression file as a module (not as its CLI/test entry).
The import performs no suite/native work. From the parent's separately observed
runtime FilePin, introducing harness commit and approvalRef, call
`nativeFixtureDeclarations({ runtime, harnessCommitSha, approvalRef })`. Hash its
literal `blueprint` canonical bytes and its first project's `manifest` and
`inventory` canonical bytes using the existing canonicalJson/digest helpers.
The returned blueprintSha256 equals the former; compare it independently. The
blueprint consists only of fixed literal fixture contents; this preparation
reads no fixture/installed files and consumes no observer result. Prepare the11
harness file pins separately and validate the completed canonical allocation
with exported `readFixtureAllocation`. Use the same frozen source location for
this preparation and the future CLI, because its exact source paths are pinned.

The branch makes three positive observations (distinct A/B parents and nearer
shadow), two mandatory wrong-target negatives (require target and outer-shadow
target), and an optional sixth negative when `wx` creation proves case-distinct
filenames are supported. No filesystem/system toggle is attempted. Unsupported
case distinction is reported as unexercised, not a passed native case control.
All fixture metadatas remain explicitly synthetic. At most17 fixed metadata
children are used by the complete prescribed success path, including source
preflight and owned-tree/cleanup checks, within the32-child allocation ceiling.
Source preflight ignores directory write timestamps while retaining directory
identity and strict selected-file identities/hashes. Cleanup removes only the
observed owned files/empty child directories and preserves the empty run root;
an unexpected child or changed identity blocks deletion for parent handling.

After exact source review, parent must supply the concrete approved runtime and
source pins, blueprint/manifest/inventory digests and allocation reference before
the specifically released native run. Actual installed-candidate
observation remains a separate parent API allocation using the real matching
build/metafile and independent installed-resolution/metadata/entry pins; the
synthetic CLI does not fabricate or earn that evidence.

## First parent native attempt and physical runtime correction

Parent integrated the source as `f55ff1a`, then used candidate
`ac915c5576b11b1e5309b7300828d1e265364146` for the first allocated fixture
attempt. Allocation file SHA256 was
`057098db4d350382813422e10b7d6c4bbf14701edf0544bb996ac9db70e13308`.
It exited1 in134ms, with empty stdout and static stderr
`RUNTIME_RESOLUTION_NATIVE_REFUSED`. Parent's failed logs and allocation remain
under canonical `.local/r20-installed-resolution-oct28/`; do not replace them.

The logical Node pin under `C:\Users\USER\AppData\Local\capital-r00-runtime`
resolved to the complete physical package path named above. That mismatch would
independently fail the exact native-path check. Parent final adjudication corrects
the earlier phase attribution: static refusal did not attest which condition ran,
and the later environment diagnostic also exposed an incompatible earlier
preflight condition. The absent root is established; execution of the path check
on that first attempt is not. Author read-only checks confirmed
the root absent, all11 supplied harness hashes/sizes matching, no trailing newline
or BOM in the allocation, and matching recorded blueprint/manifest identities.
Parent independently identified the native path mismatch and matching runtime
version/architecture/declaration digests. This failure establishes neither a
successful native resolver run nor any application/installed dependency evidence.

Parent authorized only the fixed synthetic protocol's Node path correction and
matching tests/docs. The physical file was read-only hashed as82,123,080 bytes,
SHA256 `df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0`,
the same bytes as the logical location. That size/hash is an observed parent
allocation input, not a fallback embedded in the runner. The observer module,
exact spelling/containment/realpath checks and no-alias policy are unchanged.
Two literal pure regressions first failed, requiring the physical protocol pin and
refusal of the old logical alias even with matching byte expectations. A fresh
reviewed allocation must carry the physical path and newly pinned source bytes
before any native retry; no retry was performed by this correction.

The final bounded pure/fake suite, invoked through the physical Node executable,
passed **79/79,0 skips, exit0,345.5771ms**. At that correction the line counts
were223 observer,561 regression and442 evidence lines. Static/broad checks and actual native
retry remain unrun by this author; the original77-test evidence above remains
the historical source checkpoint rather than the corrected candidate's total.

## Second parent prewrite refusal and effective Windows environment

The separately pinned physical-path allocation had SHA256
`e75092cf1b88f013b7b683c6c797939c75e0b88128e49c7e02028dfde0d6d46c`,
candidate `645dbb2ea1bb3a21cbf40d89dda5debec8b06ea8`. Parent observed exit1
in232ms, empty stdout and static refusal; `native-physical.*` and
`synthetic-allocation-physical.json` remain preserved beside the first attempt.
The fixture root remained absent. Runtime/harness physical paths, file/link
identities and all supplied hashes matched. Parent's separate read-only call to
the existing metadata helper succeeded across32 ancestor paths; it was not a
fixture or observer run.

The concrete refusal was the effective Node environment: Windows supplied
PROCESSOR_ARCHITECTURE=ARM64 in addition to the four variables explicitly given
after Environment.Clear. The earlier exact-four-key check rejected this before
source-pin metadata inspection or fixture creation. Parent authorized binding the
actual **exact five-key** shape, with ARM64 mandatory and consistent with the
pinned process architecture. The parent still supplies only the original four;
the runner neither injects/falls back to a value nor accepts arbitrary extras.
The metadata helper, path/alias guards, fixture allocation shape and certificate
settings are unchanged.

Pure red controls reproduced rejection of the valid effective environment and
incorrect acceptance of the missing OS key before the correction. The fixed
fixture's pure environment predicate is its actual native-branch consumer.
Positive five-key, missing/wrong OS architecture, mismatched process architecture
and extra-variable controls now pass. Final focused pure/fake verification:
**84/84 passed,0 skips, exit0,282.6592ms** via the physical Node executable.
No fixture retry, native observer, installed observation, DB or static/build run
was performed by this correction. Fresh source review and newly supplied parent
pins remain required before the next native allocation.

## Third refusal and fixed external TEMP correction

Parent's third attempt used canonical `c2223ee602510c6bb4b28292bfb7ab48295366f3`
and allocation SHA256
`1ba358ee8595da55e9c93740d576d8b87c474f9a54000bf596d3bc4943971bc2`.
It exited1 in923ms with empty stdout and static refusal; `native-arm64.*` and
`synthetic-allocation-arm64.json` are preserved. The old a1 root now exists and
is nonreusable. The initial summary of an empty root/completed cleanup is not
supported by the later read-only snapshot: the root contains an empty `temp`
directory, no project directories. No deletion or reuse was performed.

Read-only pure replay of the actual four manifest/inventory pairs passed. Parent
separately found zero Node/Windows creation/write tick mismatches across32
existing runtime/harness ancestor paths. Neither diagnostic executed the observer
or fixture. Temp-only state and timing are consistent with a preflight Windows
child materializing the future TEMP directory before the second root-absence
check; without a phase report they do not uniquely prove which call created it.
The same materialization pattern and preallocation TEMP separation are already
documented in accepted `R19/NATIVE-PG-TLS.md:48-56`; this precedent was missed in
the initial wrapper design.

Parent approved the simpler fixed external TEMP policy for the whole new run:
run `r20res20261028b1`, new absent root `r20-runtime-resolution-oct28b`, and the
separately parent-created `r20-installed-resolution-oct28/native-temp`. The
exported protocol pins that exact temporary path; stdin gains no free-form field.
`verifyFixturePreallocation` is the actual native consumer and checks fresh-root
absence before/after source-pin metadata dispatch, which now also covers TEMP
and every ancestor including shared `.local`. TEMP/TMP are never mutated. The
unused fixture-root temp creation is removed; cleanup cannot delete external
TEMP or the preserved a1 root. Observer, metadata helper, certificate policies,
exact aliases/spelling and false certifications are unchanged.

Four pure controls failed before this correction: fresh literal protocol, old
run refusal, old root refusal and the missing preallocation boundary. The fake
child then simulates temp materialization while asserting root absence before
dispatch and after both metadata calls. Separate controls refuse an already
existing root before any child and refuse an unexpected child-created root
afterward without adopting/deleting it. Final focused verification:
**90/90 pure/fake tests passed,0 skips, exit0,368.237ms**. No native retry,
new fixture root/TEMP creation, old-root cleanup, DB or static/build execution
was performed by this author. Fresh exact review and parent pins still precede
the next native allocation.

## Later staged-runtime checkpoint

The root observation remains a separate bounded result. Its follow-on package
inventory, fixed trusted-fixture staging and five-case native boundary/lifecycle
proof are now accepted locally at source `4a0338b`; see
[RUNTIME-STAGED-ACCEPTANCE.md](RUNTIME-STAGED-ACCEPTANCE.md). Complete installed
dependency/native/data coverage, general staging/custody and production-profile
execution remain open; earlier observer certifications are not promoted.
