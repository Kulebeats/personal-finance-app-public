# R20 staged runtime boundary implementation plan

> **For implementers:** Use executing-plans for the assigned lane and preserve the
> four-agent ownership and verification order below.

**Goal:** Produce a finite staged dependency superset that an actual pre-import
boundary consumes, with native local proof for a deliberately inert JS/CJS fixture
and early refusal of the unresolved application candidate.

**Architecture:** One author owns package inventory/staging, one owns the
pre-import consumer and lifetime enforcement. An independent reviewer adjudicates
the shared contract and source; the parent integrates and accepts exact evidence.
No declaration, parser result or synthetic success grants application execution.

**Tech stack:** Existing Node 24.22.0 Windows ARM64, Node synchronous module hooks,
existing path/manifest/Windows identity primitives, and narrowly scoped Windows
handle support if the concrete design passes review. No dependency installation.

## Baseline, scope and authority

Canonical baseline is `6c70dda7084bf36576fbb758a259e7841deb7354` in
`C:/Users/USER/.codex/worktrees/capital-completion-v2/personal-finance-app`.
The owner requested continuation with four agents. Local source, inert synthetic
fixtures, read-only installed inventory, applicable tests and local commits are
authorized. Shared/production DB, external delivery, machine-wide configuration,
provider provisioning, main merge, push, deployment and release remain outside
this batch. Keep `C:/Dev/personal-finance-app` untouched.

The existing production manifest v1 remains unable to authorize a launcher.
No ordinary `npm start` or full production-profile launch is included. Actual
candidate blockers include absent `posthog-node`, its bundled ESM require site,
native Sharp/libvips loading, computed data reads and unproven full-profile
services/TLS/egress/secrets. Do not remove dependencies or advertised features to
obtain a green fixture. All 101 canonical groups remain open.

## Trust and claims

The pinned runtime, bootstrap, Windows platform and reviewed fixture code are
trusted computing components. Node hooks and permission flags do not isolate
malicious code. This milestone addresses unexpected loads and ordinary concurrent
filesystem interference within its tested scope; it does not promise resistance
to a hostile process with the same identity, an administrator, injected native
code or compromised OS. Native addons and dependent DLL loading remain refused.

A whole-package tree is a conservative superset, not proof of reachable import
closure. Inventory separately records required/optional/peer package edges,
missing roots, computed/data/native requirements, package metadata, exact paths
and bytes. Runtime observation is distinct from retention of identity throughout
loading. Windows share denial alone does not freeze attributes, directory entries
or DLL resolution. Loader hooks alone do not constrain data-file reads, arbitrary
new hooks, workers or child processes. Test these limits explicitly and preserve
refusals; do not describe them as supported coverage.

The actual profile's `runtimeDependencyIdentity` and `executionAuthorized` remain
false. Any narrower fixture results must identify the fixture, exact candidate,
trusted components, lifecycle and unsupported capabilities. Caller-supplied
booleans never become authority. Do not widen existing v1 parser limits.

## Ownership and workspaces

| Role | Ownership |
| --- | --- |
| Parent | This plan, campaign ledger, combined acceptance, integration, broad/native verification slots |
| Inventory author | `capital-r19-foundation/personal-finance-app`, branch `codex/capital-r20-package-inventory`; package inventory/staging implementation, focused regressions and its evidence |
| Enforcement author | `capital-r04-foundation/personal-finance-app`, branch `codex/capital-r20-preimport-enforcement`; pre-import consumer, bounded lifetime implementation, focused regressions and its evidence |
| Independent reviewer | Read-only contract, source, test and raw-evidence adjudication; separate language review reuses a freed slot |

Both author branches begin at the canonical baseline; previous branches remain
preserved. Authors are not alone in the repository: preserve others' work, do not
edit another lane's files, and coordinate shared interfaces before changing them.
Do not spawn more agents. Broad/static checks and native allocation run only in
the parent-assigned exclusive slot. Pure bounded tests may overlap read-only work.

## Task 1: Freeze the shared contract before implementation

1. Record exact new files, exported functions, private brand lineage, JSON record
   shape, aggregate/per-record limits, stage ownership and refusal conditions.
2. Define the staging producer-to-consumer interface once. Keep existing v1
   production manifest and root-resolution contracts unchanged.
3. Establish actual-candidate early refusal before expensive copying when known
   missing root/native requirements already preclude execution.
4. Define one parent-owned absent synthetic root, external existing TEMP, exact
   physical Node/harness pins and child lifecycle before native dispatch. No
   application/dependency evaluation, installs, listener or DB in this fixture.
5. Independent reviewer and parent adjudicate the concrete design. Source work
   begins only after the following implementation addendum is complete.

## Task 2: Inventory and stage a finite superset

1. Write failing regressions for missing required roots, optional-edge handling,
   aliases/escapes/reparse/hardlink paths, changed metadata/bytes, duplicate paths,
   oversized input and forged consumer records. Retain behavioral red evidence.
2. Implement bounded package traversal and deterministic file/directory inventory
   with separate edge and unsupported-capability records. Proposed ceilings:
   16 MiB serialized inventory, 512 package instances, 4,096 edges, 32,768 files,
   8,192 directories, 512 MiB total bytes, 32 MiB/file, depth 16. Refuse before
   unbounded work and avoid enlarging unrelated validators.
3. Implement create-only owned staging from the same verified file descriptors,
   preserving supported Node layout and package metadata. No source mutation,
   overwrite, reuse, module evaluation or ambient package installation.
4. Exercise mutation, interrupted allocation and cleanup boundaries. Return a
   narrowly branded result consumed directly by the enforcement lane, never a
   caller-set approval flag.
5. Run focused tests and selected syntax checks; freeze source/evidence for review.

## Task 3: Enforce before imports and retain tested identity

1. Write failing tests proving the synthetic entry cannot run before inventory,
   stage identity, runtime and lifecycle checks. Use an independent entry sentinel.
2. Implement the concrete pre-import consumer. Dynamic import of the entry occurs
   only after its boundary is installed. Check ESM, CJS/createRequire, literal
   dynamic imports, JSON and import/require conditions in the approved fixture.
3. Reject unknown paths/formats, new shadow packages, out-of-root code, native
   addons/DLL requirements and unsupported execution capabilities before their
   evaluation. Recheck and supply verified source bytes at load time where the
   supported Node hook API permits it. Do not rely on a one-time directory scan.
4. Prove the selected Windows handle lifecycle against ordinary writes, delete,
   rename, pre-existing writer handles and failure/timeout. If process-held
   handles are used, document precisely what happens on supervisor and child
   termination; do not claim crash custody without an actual lifetime design.
5. Test and document metadata/new-entry behavior, hook replacement, worker argument
   overrides, child process/direct native loading and cached module cases. Keep
   unsupported cases blocked or explicitly outside the bounded fixture claim.
6. Freeze source/evidence, run focused checks, and request review before any native
   allocation. A later source change invalidates the affected frozen acceptance.

## Task 4: Integrate and accept the bounded result

1. Independent general/security and separate JS/native-language review must pass
   on exact source. Parent adjudicates findings and verifies branch/file parity.
2. Integrate only assigned files into canonical. Run focused native/pure regression
   suites and `npm run check` using pinned Node. Do not rerun unrelated DB/browser
   suites when application source is unchanged and no concern warrants them.
3. Independently pin the final native dispatch/allocation. Use the physical Node
   path, four supplied environment keys/five effective keys including Windows'
   ARM64 key, and an existing TEMP outside the absent create-only fixture root.
4. Run the approved inert fixture. Retain raw output, exact source/runtime hashes,
   positive controls, refusals, lifecycle outcomes and unsupported controls. Do
   not recycle failed fixture roots or infer a refusal phase from a generic error.
5. Run the actual candidate's read-only early assessment and demonstrate refusal
   before selected application/dependency evaluation. No large stage copy is
   needed merely to rediscover known blockers.
6. Commit exact acceptance and campaign status. Report only verified bounded
   progress, remaining native/data/profile work and preserved failures.

## Implementation addendum

Parent and independent reviewer accepted the two readbacks for implementation.
The independent reviewer accepted the finite superset, explicit unsupported
capabilities, early refusal and narrower trusted-code fixture boundary. Native
dispatch still requires exact frozen implementation/allocation review.

Inventory author owns exactly:

- `server/testing/production/runtime-package-tree.mjs`
- `server/testing/production/runtime-package-tree.regression.mjs`
- `docs/reviews/completion-v2-evidence/R20/RUNTIME-PACKAGE-TREE.md`

Public interface:

```js
collectRuntimePackageTreeCandidate(profileRecord, rootInput, options)
// Returns blocked report OR untrusted candidate text plus summary.
readRuntimePackageTree(profileRecord, rootInput, text, parentPins)
// Returns privately branded, deeply frozen accepted tree record.
requireRuntimePackageTree(record)
// Rejects clones, serialized results and forged records.
```

`rootInput` is exactly `{text,pins}` for the original independently pinned root
inventory. Reuse `readRuntimeResolutionInventory` internally; accepting this
input does not establish a native observation. JSONL uses existing canonical
serialization per record (maximum 16 KiB), UTF-8/LF with a final LF and no
BOM/CR/empty lines. Maximum 45,697 records includes 128 unresolved records.
Aggregate hashing covers exact bytes. Header binds kind/version/evidence class,
run/profile/root-inventory/build/harness/approval, metafile, root-package/lock,
source root, runtime and counts. Package records bind installed path/name/version/
manifest pin; edges bind requesting instance/key/range/class/target or absence;
directory/file records bind package/path/bytes/asset kind. Unresolved records use
closed reasons. Required blockers remain in validated inventories and cause
the consumer to refuse before stage creation, helpers, children or imports.

Enforcement author owns exactly:

- `server/testing/production/runtime-stage.mjs`
- `server/testing/production/runtime-stage.regression.mjs`
- `server/testing/production/runtime-enforcement.mjs`
- `server/testing/production/runtime-enforcement.regression.mjs`
- `server/testing/production/runtime-bootstrap.mjs`
- `scripts/runtime-custody-windows.ps1`
- `docs/reviews/completion-v2-evidence/R20/RUNTIME-ENFORCEMENT.md`

`stageRuntimePackageTree(acceptedTreeRecord, stageAllocation)` consumes the real
private inventory brand. Exact stage union is package-tree members, profile build
artifacts, controlling root/ancestor metadata and independently pinned bootstrap
files. Keep `stageRoot/{package.json,dist/index.js,node_modules/...}` topology.
Any proposed extra implementation file needs parent coordination to keep
ownership concrete; no edits to old observers, ordinary app startup or guards.

Synthetic pre-import capability is ESM/CJS/JSON and computed module requests
resolving to indexed members. Reject unsupported native addon/DLL, opaque data,
worker and child-process requirements before import. The bootstrap uses dynamic
entry import after synchronous hooks register, with exact runtime/argument/env
checks and cold-process startup. Direct module source is read/hashed from bound
descriptors and supplied to supported hooks. Do not expose a switch that converts
installed candidates into synthetic fixtures or a boolean that grants launch.

The Windows design retains read-share-only handles for files and checked ancestry.
If the supervisor launches the fixture child, explicitly inherited custody handles
must survive supervisor death until child exit. Use a restricted inherited handle
list and `PROC_THREAD_ATTRIBUTE_JOB_LIST` so the kill-on-close job is assigned
during creation; verify job membership while suspended before resume. Refuse
unsupported host/job/handle compatibility without unlocked fallback. Retain and
verify physical Node/bootstrap identities. Native source compilation must use
existing platform tooling only; return feasibility blockers rather than install
anything. Pin the owned Node/PowerShell executable, supervisor script and complete
owned bootstrap import closure before dispatch; installed platform assemblies are
the separately declared trust base described below.

Read-only host feasibility found existing ARM64 PowerShell 7.6.6 with .NET
10.0.12 and Roslyn assemblies. The selected implementation uses in-memory
`Add-Type` in the fixed reviewed supervisor, without an installer, emitted native
assembly or separate compiler child. PowerShell's executable/source are pinned;
the installed .NET/Windows platform is explicitly trusted for this fixture. This
is not a claim that every platform DLL was independently inventoried or that the
application's native dependency requirement is solved. Native bridge compilation
and execution wait for exact source review; pure JS work can proceed independently.

Do not confuse retained names with frozen directory membership/attributes.
Real fixture tests must independently prove byte-write/delete/rename refusal and
lifetime behavior; negative tests identify the exact guarantee they exercise.
If native lifecycle complexity exposes a design flaw, pause that dependent native
dispatch, repair locally and obtain independent re-review. Continue other
authorized source work. Actual application import remains refused throughout.

Parent reserved run `r20stage20261028a1` and verified the absent fixture root
`C:/Users/USER/.codex/worktrees/capital-completion-v2/personal-finance-app/.local/r20-stage-native-oct28a`.
One suite owns separate create-only `cases/<scenario>/stage` children. The closed
scenarios are `normal`, `timeout`, `supervisor-loss`, `preexisting-writer` and
`unknown-member`; source/build are fixed siblings under the fixture root. External TEMP is
`C:/Users/USER/.codex/worktrees/capital-completion-v2/personal-finance-app/.local/r20-staged-boundary-oct28/native-temp`;
parent will create it before native metadata/dispatch. These are reservations,
not allocated fixtures or permission to run unfinished native source.

Proposed closed staging allocation is
`{stageRoot,bootstrapFiles:[{source:{path,size,sha256},relativePath}],expectedTreeSha256}`.
Author/reviewer must freeze the stage-result and child IPC exact shapes before
native compilation or dispatch. Partial stages remain preserved on interruption;
never overwrite/adopt/recycle an old root to obtain a passing run.

The cross-process lineage is deliberately narrow. The Node enforcement consumer
checks the genuine private stage brand. The PowerShell supervisor independently
revalidates the closed fixed inert fixture and owns the handles/job. The child
bootstrap pins literal fixture file names/source hashes, fixed root/token and
Node, and emits hook events only. Private JS brands do not cross JSON IPC; child
self-consistency or direct CLI success cannot attest custody. Direct CLI input
must never select installed/arbitrary code. Parent independently pins the owned
harness/import closure; embedded fixture pins do not create circular self-trust.

Source review identified that path-based copying alone cannot promise safe writes
against replacement of destination directories with reparse points. The initial
stage producer is therefore restricted to the fixed trusted fixture namespace
(`source`, `build`, and the closed case stages under the reserved root). Generic installed
staging remains unsupported; this is an explicit bounded implementation limit,
not fulfillment of the application's staging/custody requirement. Native
write/rename tests exercise the later held-handle boundary. Scoped package names
and matching pins with different JSON key order must still compose correctly.

Parent permits a local frozen inventory candidate commit after `npm run check`
and interim finding repairs so the enforcement author can test genuine private
brand composition by cherry-picking that exact dependency. This is a candidate
snapshot, not final acceptance; independent general/language review still gates
canonical acceptance and native dispatch.

The process design was strengthened after parent review found the interval
between suspended creation and later job assignment could leave an orphan.
Creation-time job assignment removes that userland interval; tests must still
record the observed lifecycle rather than claiming arbitrary kernel-interruption
proof. The inert entry has a fixed five-second hold; the supervisor relays only
known entry/hook events with an owned child PID. A fixed timeout case counts only
when entry start was actually observed. An outer parent watchdog covers protocol
input, compilation, process lifetime and output, including failures before the
native child deadline. Exact-owned teardown must be independently verified.

## Primary technical references

- [Pinned Node 24.22.0 module hooks](https://raw.githubusercontent.com/nodejs/node/v24.22.0/doc/api/module.md): synchronous hooks, chaining and worker inheritance.
- [Pinned Node permission model](https://raw.githubusercontent.com/nodejs/node/v24.22.0/doc/api/permissions.md): trusted-code scope; no malicious-code security guarantee.
- [Windows CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew): sharing lifetime, write/delete compatibility and attribute exceptions.
- [Microsoft creation-time job assignment](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812): the suspended-create/assign orphan interval and `PROC_THREAD_ATTRIBUTE_JOB_LIST`.

## Bounded completion

Inventory source is integrated through `b6dc664`; enforcement source is integrated
as `4a0338b53deec8d3e23cd29a41c71c48ca87654a`. General, JavaScript and C# reviews,
canonical 254-case focused verification and `npm run check` passed. After separate
operational helper and allocation review, the first real owned native suite passed
all five cases in 28.863 seconds. The actual installed candidate independently
refused its missing PostHog/ESM require roots before package-byte capture.

Parent accepts this bounded implementation with the explicit trusted-fixture
staging restriction above. General installed staging, actual native/data closure,
full-profile execution and all campaign group closures remain open. Exact source,
dispatch, results, review findings and unexercised boundaries are recorded in
`docs/reviews/completion-v2-evidence/R20/RUNTIME-STAGED-ACCEPTANCE.md`.
