# R20 bounded package-tree inventory candidate

Status: source candidate for independent review; pure/fake verification only.
Native fixture, installed preflight/capture, staging and loader execution are
pending separate parent dispatch. No application or selected dependency module
was evaluated. No profile certification or campaign group is closed here.

Authority is the parent-owned
`docs/plans/2026-10-28-r20-staged-runtime-boundary.md`, including its implementation
addendum, at canonical baseline `6c70dda7084bf36576fbb758a259e7841deb7354`.
Work is isolated on `codex/capital-r20-package-inventory` in
`C:/Users/USER/.codex/worktrees/capital-r19-foundation/personal-finance-app`.
Only this document, `server/testing/production/runtime-package-tree.mjs` and its
`.regression.mjs` file belong to this author. Existing profile/root observers,
startup, package manifests, lockfiles and metadata helpers are unchanged.

## Delivered contract

`collectRuntimePackageTreeCandidate(profileRecord, rootInput, options)` returns
either a closed blocker report or untrusted deterministic candidate bytes plus
their SHA256 and counts. Neither result has the private acceptance brand.

`readRuntimePackageTree(profileRecord, rootInput, text, parentPins)` is pure. It
revalidates the genuine profile and original root inventory, checks independently
supplied expectations and returns a deep-frozen privately branded record.
`requireRuntimePackageTree(record)` rejects copies, JSON round trips and forged
records. The enforcement lane's `stageRuntimePackageTree` consumes that same
record through the actual brand guard; brands do not cross process boundaries.

`rootInput` is exactly `{text,pins}` for the original root inventory, passed to
`readRuntimeResolutionInventory`. Safe data descriptors and a plain non-proxy
object are checked without wrapping the potentially long inventory text in the
existing helper's 2048-character string limit. This recreates a validated input,
not a native observation or observation-result brand.

The branded result has exactly `kind`, `treeSha256`, `header`, `packages`, `edges`,
`directories`, `files`, `unresolved`, `profile` and `rootInventory`. Its kind is
`validated-runtime-package-tree`; profile/root inventory retain their original
lineage. No execution/custody/closure approval boolean is introduced.

`parentPins` is exactly `{expectedTreeSha256,profileManifestSha256,
rootInventorySha256,runId,buildCommitSha,harnessCommitSha,evidenceClass,approvalRef}`.
The collector's digest is candidate information, never its own trusted expected
digest. Parent acceptance must independently establish the exact bytes and pins.

## Exact JSONL records

Header fields are `record:'header'`, `kind:'pfa-runtime-package-tree'`, `version:1`,
`evidenceClass`, `runId`, `profileManifestSha256`, `rootInventorySha256`,
`buildCommitSha`, `harnessCommitSha`, `approvalRef`, `metafileSha256`,
`packageJson:{size,sha256}`, `packageLock:{size,sha256}`, `sourceRoot`,
`runtime:{executable:{path,size,sha256},version,platform,arch}` and
`counts:{packages,edges,directories,files,bytes,unresolved}`.

| Record | Exact remaining fields after `record` |
| --- | --- |
| `package` | `packageId,name,version,manifestSize,manifestSha256,type` |
| `dependency-edge` | `from,name,range,edgeClass,target,status` |
| `directory` | `packageId,relativePath` |
| `file` | `packageId,relativePath,size,sha256,assetKind` |
| `unresolved` | `reason,sourceRef,required:true` |

Package IDs are exact source-relative installed paths, for example
`node_modules/alpha` or `node_modules/beta/node_modules/alpha`. Scoped names are
supported. Package roots are implicit directories. Other file parents must have
directory rows. File/dir paths retain canonical spelling and cannot escape,
contain ADS/traversal or collide by case. Package instances must be reachable
from the declared roots through the included graph; distinct nested versions are
distinct instances. Package manifest rows must match their file pins.

Edge classes are `root-import`, `root-dynamic`, `root-require`, `required`,
`optional`, `peer-required`, `peer-optional` and `bundled`. Root `from` is `$root`;
other requesters are package IDs. Root names retain the original subpath
specifier. Status is `resolved`, `absent-optional` or `missing-required`; absent
targets use the empty string. An optional absence describes installed topology,
not permission or proof that the branch is safe or unreachable.

Asset kinds are `module`, `commonjs`, `json`, `native-addon`, `native-dll`, `wasm`
and `opaque`. Collector `.js` classification uses the nearest included package
scope. The loader must independently check its actual format before evaluation.
Opaque file presence alone does not establish a required runtime data read.

Unresolved reasons are `missing-root`, `esm-require-bridge`, `missing-required`,
`native-addon`, `native-dll`, `opaque-data` and `unsupported-topology`. Missing
required edges and native members require matching blocker rows. Every root
require call retains a separate ESM bridge obligation. These records cannot be
discarded or turned into optional safety assertions to obtain admission.

Category order is header, package, dependency-edge, directory, file, unresolved.
Within a category ordering is ordinal by package/path; edges use
`from + NUL + edgeClass + NUL + name`, blockers use reason then source reference.
Existing canonical JSON applies separately to each line. UTF8, final LF and no
BOM/CR/empty lines are required. Buffers undergo fatal UTF8 decoding after raw
BOM refusal. Exact accepted bytes determine aggregate SHA256; no formatted or
fabricated replacement of the original esbuild metafile is produced.

| Bound | Maximum |
| --- | ---: |
| Serialized bytes / line bytes | 16 MiB / 16 KiB |
| Total records / blockers | 45,697 / 128 |
| Package instances / edges | 512 / 4,096 |
| Files / explicit directories | 32,768 / 8,192 |
| Aggregate package bytes / file bytes | 512 MiB / 32 MiB |
| Source-relative member path depth | 16 segments |

Group lengths are bounded before validation/reachability loops; count mismatches,
overflow, unknown records and unsupported omission refuse. Existing v1 parser
limits are unchanged. Zero-byte files are legitimate members.

## Collector and early refusal

Options are exactly `{sourceRoot,systemRoot,packageJson:{path,size,sha256},
packageLock:{path,size,sha256}}`. The dependency root must equal
`sourceRoot/node_modules`; controls must be its root package.json/lockfile.
There is no CLI, install mode, synthetic-class override or arbitrary app launcher.
Parent supplies independently pinned runtime/source/allocation before any real
invocation. The collector inherits source/runtime identity declarations but does
not claim to have natively observed the executable by reading these declarations.

First, literal roots receive metadata-only existence checks. Missing roots and
root ESM require obligations return `status:'blocked'`, bound profile/root-input
hashes, sorted blockers and `packageByteCaptureStarted:false` before any open,
package-byte read or metadata child. PostHog absence and its ESM require bridge
remain different obligations. There is no automatic install/global require shim.

If roots pass, bounded metadata reads establish the declared dependency graph
using dependencies, installed optionals/peers and bundled declarations, with npm
lock v3 instance versions checked. Aliases/protocol dependencies, link installs,
nonstandard nested node_modules and unknown package instances are unsupported.
Native member discovery returns a blocked report after small metadata reads and
directory enumeration, before module/data payload hashing; its
`packageByteCaptureStarted:true` accurately includes those metadata bytes.

The collector walks whole reached package trees rather than parsing imports.
It includes all immutable package data, both module branches and platform assets.
Directory enumeration is incremental and bounded. Reads bind exact native paths,
regular files, single links, descriptor identity, Windows generic metadata/ticks,
before/after snapshots and directory listings. Windows metadata batches obey both
1024-path and 128-KiB limits. Work checks a monotonic five-minute deadline;
individual existing metadata calls retain their own five-second timeout.
Every opened descriptor attempts closure, including failure cleanup.

These checks produce a candidate snapshot, not retained custody. The stage owner
must verify/copy under its own reviewed lifecycle, preserving the union with
existing profile artifacts, root/ancestor controls and independently pinned
bootstrap files. Stage rejects required blockers before mkdir/helpers/children.
Mutable uploads/outputs and TLS credentials/secrets are separate capabilities,
never dependency code or package-metadata roots.

## Evidence and remaining proof

Read-only preimplementation metadata estimate: 32 external package names,
31 present roots, 200 reachable installed instances, 14,758 files and
244,840,173 bytes; maximum relative directory depth seven. It observed no missing
required dependency/required-peer declarations and 50 absent optional edges.
This was not a byte capture or certified graph. `posthog-node` was absent.
Sharp's ARM64 package contains a native addon and two libvips DLLs. fast-geoip's
3,134 data files total 164,310,543 bytes and include computed filenames.

Initial 28 missing-API failures are interface/collection reds, not behavioral
regression evidence. Once implemented, independent review identified raw UTF8 BOM
stripping. A new behavioral test reproduced 35 pass / 1 fail: BOM-prefixed Buffer
bytes were accepted against the unchanged BOM-free pin. Raw-byte refusal fixed
that defect. Review's group-bound finding was also repaired before freeze.
Review additionally found ancestor directory timestamps were treated as immutable.
A second behavioral reproduction reported 45 pass / 1 fail on benign ancestor
sibling activity. Directory checks now retain stable identity, attributes and
creation only; files retain strict size/timestamps and package membership is
checked separately. The positive sibling control now passes while a new package
member with unchanged directory timestamps still refuses.

JS review identified an eager scoped-node_modules expansion after the initial
candidate. A third behavioral reproduction reported 46 pass / 1 fail: 1,200
scoped members were enumerated before refusal. Namespace reads now cap at 512,
nested instances at 512 and combined namespace/member work at 1,024; each member
is checked immediately and unknown topology stops the package walk. The same
fixture refuses within the first 513 member reads and never scans the later scope.

Current author run: **47/47 pure/fake tests pass**, 303.5434 ms reported test duration.
Positive cases use genuine private reader lineage, zero-byte data, graph cycles
and nested versions. Negatives cover independent pins, unsafe descriptors,
record/byte/line bounds, metadata/path identity, hardlinks/reparse points, changed
bytes and same-byte replacements. All filesystem/Windows bridge work in capture
tests is mocked; selected code exists only as inert strings. A fake PostHog case
confirms two blockers and zero reads/children; fake native discovery confirms no
payload hash. `npm run check` passed exit 0 at baseline HEAD
`6c70dda7084bf36576fbb758a259e7841deb7354`, using the physical Node 24.22.0
executable, its npm CLI and physical runtime directory first in PATH. Runtime
parity, TypeScript, storage/LOC, Node tool syntax and assessment/coverage guards
passed for initial candidate `b734e344fb4d1a3e5672afbdc95a6e3ebeeb1c00`.
The scoped-enumeration follow-up above has fresh 47/47 pure/fake verification and
an additional `npm run check` exit 0 using the same physical runtime at HEAD
`b734e344fb4d1a3e5672afbdc95a6e3ebeeb1c00` plus the scoped source/test changes.
Its raw log is `C:/Users/USER/AppData/Local/Temp/capital-r20-package-inventory-scoped-check-20261028.log`.
JS source readback resolved the reported enumeration finding; final exact
candidate/canonical acceptance remains pending.
The parent-assigned exclusive slot was released. Raw initial check log is
`C:/Users/USER/AppData/Local/Temp/capital-r20-package-inventory-check-20261028.log`.
Independent final source acceptance remains pending. Native, installed and
staging results are not earned here. Parent explicitly authorized a local source
candidate commit before final review to supply the consumer's genuine-brand tests;
that exception does not grant canonical acceptance or native dispatch.

Exported `packageTreeFixture()` and `packageTreeText(rows)` in the regression file
provide inert consistency declarations for the consumer's tests. Importing that
file registers no tests and executes no fixture/capture. Its computed fixture pins
are explicitly test consistency, never parent dispatch authority.

Finite follow-through: accept this input/consumer source; prove the reserved
JS/CJS/JSON fixture's real staging/hook/custody lifecycle; obtain an actual early
candidate refusal without full copying; then separately resolve PostHog
dependency/interop, computed data capabilities and native/OS-DLL custody before
attempting full installed capture and the production-profile proof. Native DLL
search, workers, child processes and arbitrary data reads are not solved by the
inventory. The trusted-code fixture does not isolate hostile same-identity code.
`transitiveClosureComplete`, `custodyHeld`, `runtimeDependencyIdentity` and
`executionAuthorized` are not promoted by these declarations or tests.

## Subsequent parent acceptance

The parent integrated the final collector and enforcement source through
`4a0338b53deec8d3e23cd29a41c71c48ca87654a`, passed 254 canonical focused tests and
the static check, and independently verified the real early installed-candidate
refusal. The reviewed inert native suite then passed all five cases, including
real collector-to-expected-tree-to-stage composition. Exact dispatch, raw evidence,
remaining unsupported boundaries and independent adjudication are in
[RUNTIME-STAGED-ACCEPTANCE.md](RUNTIME-STAGED-ACCEPTANCE.md). Earlier author-only
pending statements above describe their original checkpoints; actual application
closure/identity/execution certifications still remain false.
