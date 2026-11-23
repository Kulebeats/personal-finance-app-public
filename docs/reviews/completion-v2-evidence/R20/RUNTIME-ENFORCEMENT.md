# R20 staged runtime enforcement — implementation evidence

Status: **PARTIAL — source and pure/fake checks; native custody unverified.**
The installed application candidate remains refused. No application/dependency
entry, service, listener, database, provider or native addon was executed by this
lane. No dependency or compiler was installed. All application certifications,
including `runtimeDependencyIdentity` and `executionAuthorized`, remain false.

## Reading order and authority

1. Parent plan `docs/plans/2026-10-28-r20-staged-runtime-boundary.md`, including
   its accepted implementation addendum.
2. Inventory contract and `RUNTIME-PACKAGE-TREE.md` from the separate author.
3. `runtime-stage.mjs`: real inventory brand, early refusal, exact create-only union.
4. `runtime-enforcement.mjs` and `runtime-bootstrap.mjs`: fixed inert fixture,
   runtime gate, descriptor-backed synchronous hooks, delayed entry import.
5. `scripts/runtime-custody-windows.ps1`: separately reviewed, unexecuted native
   source, then the regression files and parent-owned native evidence.

These are local implementation artifacts. They grant no production, provider,
database, merge, delivery, deployment or release authority. All 101 canonical
groups remain open. The v1 production manifest and existing observer are unchanged.

## Shared interface and private lineage

`stageRuntimePackageTree(acceptedTreeRecord, stageAllocation)` obtains the genuine
inventory record through `requireRuntimePackageTree`; clones and serialized
records fail before inspecting allocation properties or invoking filesystem/helper
operations. Required unresolved edges, native addons/DLLs, WASM and opaque package
data refuse before allocation. Absence of a blocker is not application execution
approval.

Allocation is exactly `{stageRoot, expectedTreeSha256, bootstrapFiles}`. The two
bootstrap entries are exactly `{source:{path,size,sha256}, relativePath}`, in order
`.runtime/runtime-bootstrap.mjs`, `.runtime/runtime-enforcement.mjs`. The union is
the indexed package tree, every profile build artifact under `dist/`, controlling
root/package metadata and lockfile, and those two bootstrap files. Destination
collisions compare exact path, size and hash; no overwrite, reuse or cleanup of
failed allocations is provided. Failed partial allocations stay available for
adjudication. The result has a private WeakSet brand and frozen all-false
certifications. `requireRuntimeStage` rejects lookalike objects.

This initial producer accepts only `synthetic-fixture` in the fixed parent-owned
`fixtureRoot/source`, `fixtureRoot/build`, and five closed case stages. Generic
installed staging is unsupported. Package path joining is local to this stage
implementation: scoped packages and the inventory's longer paths are supported
without widening the independent production-v1 helper. The existing absolute
Windows path ceiling still applies to the complete destination path.

`runtimeCustodyProtocol(realStagedRecord)` consumes that brand and selects only
the literal reviewed fixture files/root/token. JSON transport cannot carry a JS
WeakSet. The PowerShell supervisor independently accepts only the same fixed
fixture/runtime/bootstrap pins and acquires native handles; it does not recreate
the stage brand. Parent launch through the genuine producer establishes the
cross-process chain. The bootstrap protocol reader checks consistency and the
closed fixture declaration; it does not attest custody, approval or process
parentage. Caller-regenerated hashes cannot substitute arbitrary fixture source.

## Fixed inert fixture and loader boundary

The sole allocation is the parent's reserved root:
`C:\Users\USER\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\r20-stage-native-oct28a`.
The five preallocated stages are `cases/{normal,timeout,supervisor-loss,preexisting-writer,unknown-member}/stage`.
They share trusted `source/` and `build/` inputs and token `r20stage20261028a1`.
These are one reviewed suite allocation, not adoption/recycling of failed roots.
The external existing TEMP
must be the parent's `r20-staged-boundary-oct28/native-temp`; this lane has not
created either allocation.

The declaration contains inert client index/asset, package and lock metadata,
an ESM entry, conditional ESM and CJS exports, computed package import and JSON.
Its source is pinned literally in the loader and native supervisor. The entry
prints independent start/complete markers only after assertions succeed and holds
for five seconds between them. No
installed candidate can be relabeled as this fixture by changing evidence class.

Cold bootstrap accepts exactly Node 24.22.0 win32/arm64 at the independently pinned
physical executable, exactly `--permission` and its stage-root read grant, the
fixed bootstrap path/token, and exactly five effective environment keys:
`PROCESSOR_ARCHITECTURE=ARM64`, `SystemRoot=C:\WINDOWS`, `TZ=UTC`, and identical
external `TEMP`/`TMP`. Write, child, worker and addon permission are denied.

The trusted bootstrap closure loads first. It registers synchronous hooks before
dynamic import of the selected entry. Indexed source is opened and read/hashed
from bound descriptors, checked against its current named identity, and supplied
by `load`; unknown targets, parent URLs and formats refuse. Ordinary hook
registration through public `module.registerHooks`/`register` is replaced with a
refusal after registration. This has not yet been exercised in a native process.
Computed module requests can succeed only when their resolver target is indexed.
Unknown data reads, arbitrary hooks/internal mutations, cached application
modules, workers, children, native loading and unsupported data capabilities do
not become supported merely because the fixture declarations are accepted.

## Native source feasibility and trust boundary

Read-only inspection found ARM64 PowerShell 7.6.6, .NET 10.0.12, existing
`C:\Program Files\PowerShell\7\pwsh.exe`, and bundled
`Microsoft.CodeAnalysis.dll`/`Microsoft.CodeAnalysis.CSharp.dll`.
`System.Management.Automation.dll` is in that same installed directory. Existing
Framework and Framework64 `v4.0.30319/csc.exe` are present but unused.

The chosen bridge embeds C# in one reviewed `.ps1` and uses installed `Add-Type`
in memory. Parent accepted PowerShell/.NET/Windows as fixture TCB. This is **not**
complete native dependency closure and grants no full-profile runtime identity.
The complete local JS bootstrap closure consists of the two staged harness files;
their externally reviewed hashes are embedded in the supervisor, not self-pinned
by the bootstrap. Source changes require refreshed pins and review.

The source opens each exact file and ancestry with read-share-only `CreateFileW`,
checks same-handle final path, volume/file ID, attributes, reparse state, link count
and bytes, and retains those handles. It constructs a restricted inherited handle
list plus atomic `PROC_THREAD_ATTRIBUTE_JOB_LIST`, creates Node suspended already
assigned to its nonbreakaway kill-on-close job, verifies `IsProcessInJob` and held
members, then resumes. Atomic job assignment closes the earlier source's
created-but-unassigned suspended-child crash gap. The job handle is not inherited. Custody handles and
only required stdio pipe ends are inherited by the child. Timeout/failure kills
and waits for the child before normal parent handle cleanup; inherited custody
persists until child exit if supervisor death closes the parent handles. These
are source properties awaiting native proof, not verified lifetime guarantees.

Input/output are bounded at 64 KiB; child wait is 15 seconds for normal cases and
2 seconds only for the fixed timeout case. Termination/I/O drain waits are 5
seconds. The timeout case is accepted only after the reader has observed and
relayed the exact `ENTRY_STARTED` marker; slow startup without that marker is
unproven failure. The reader relays only the three known child lines in exact
order, plus a separate child PID lifecycle event. Pre-existing writer refusal
requires native sharing violation 32 specifically on the selected entry before
child creation; unknown membership requires its own exact phase before child
creation. Generic I/O failures do not satisfy these negative controls.

**A parent-owned absolute whole-supervisor watchdog and drained stdout/stderr are
mandatory.** PowerShell stdin/EOF and Add-Type occur before the C# child wait,
and owner output consumption is outside that wait. The standalone CLI does not
provide a bounded lifetime for a silent/open stdin or nonconsuming output owner.
The operational driver must terminate only its owned supervisor and verify its
job child exits and locks release. Host validation checks PS 7.6.6, .NET 10.0.12,
ARM64 and exact unmanaged layout sizes before dispatch.

Protocol, custody, membership, pipes, job, inheritance,
suspended creation, job verification, resume, wait/timeout, child result, postcheck and
termination failures have fixed phase diagnostics without payloads/raw exceptions.
The bridge deletes nothing and exposes no arbitrary executable, callback or path
dispatch option. Host/job/handle incompatibility refuses without unlocked fallback.

## Evidence recorded in this author lane

* Initial enforcement run: 13 failures because the intended API was absent.
  Initial stage run: 2 failures for absent producer/consumer APIs. These are
  collection/API reds, not behavioral enforcement evidence.
* A later closed-lifetime regression produced a genuine behavioral red: builtin
  loads were still returned after close (`Missing expected exception`). The fix
  checks lifetime before all loads, including builtins; the regression passes.
* The exact native-fixture composition regression produced another behavioral
  red: collection refused the original empty lock package set. The fixed inert
  root manifest and lock now include the root identity/dependency and installed
  `fixture-pkg` version. The regression compares collector JSONL byte-for-byte
  against separately constructed expected rows before the real reader consumes
  its expected digest, then stages and produces the closed custody protocol.
* Current enforcement pure/fake suite: 24/24. It covers immutable closed fixture
  declarations, self-consistent source substitutions, alternate roots/runtime,
  forged records, indexed ESM/CJS/JSON descriptor bytes, unknown targets/formats,
  changed bytes, exact parent/lifetime, and fake cold runtime/flags/environment/
  permission refusals. No fixture source is evaluated by those fake tests.
* Stage pure/fake tests: 9/9, consuming the actual integrated inventory reader and
  exported inert declaration from `f92d6e1` plus bounded scoped-walker followup
  `b23f162` (inventory source candidates `b734e344` and `dea747b1`). Covers exact create-only union,
  scoped packages, reordered overlapping metadata pins, descriptor cleanup,
  source drift and partial-root preservation, interrupted allocation/reuse
  refusal, genuine required blockers before allocation getters/IO/helpers, and
  the exact native-fixture collector-to-protocol composition described above.
* Final combined pure/fake run: 80/80 (47 inventory, 9 stage, 24 enforcement),
  no skipped tests. Final scoped-PATH `npm run check`: exit 0. Raw outputs below.
* PowerShell AST parse succeeds. **C# has not been compiled. The bridge has not
  run. No native fixture has been allocated.**

Focused tests use the parent's physical pinned Node executable. The first broad
`npm run check` failed its runtime guard because an npm script child selected
ambient Node 22.23.2; the parent-pinned Node path was then placed first in the
command-local PATH and restored afterwards for the authorized rerun, which passed
with exit 0. The final raw rerun is retained below. No browser or database suite
was run.

## Remaining adjudication and limits

Native acceptance still requires exact source/allocation review, separate JS/C#
review, compilation, positive entry sentinels, ordinary write/delete/rename and
pre-existing-writer tests, supervisor death and child failure/timeout cleanup,
lock release/no-orphan proof, metadata/new-entry behavior, and explicit unsupported
hook/worker/child/native/data controls. No claim should be inferred from this
source-only implementation for those cases.

Node staging checks source identities/metadata before and after copying, reads
from the verified source descriptors, creates fresh members and reads back their
bytes. It does not retain native destination-ancestry locks during copying.
Therefore materialization in a concurrently replaced/reparse-capable namespace
is not established as a safe-write boundary. The current intended fixture
namespace is parent-owned and trusted; lifecycle interference claims start only
after the supervisor has acquired custody. No failed fixture root may be reused.
Windows directory handles do not freeze directory membership or attributes.
Native pre/post membership checks are observations; hooks still reject unknown
module targets. TEMP ancestry needs the parent's independent preflight.

This is a trusted-code boundary for unexpected loads and the tested ordinary
filesystem lifecycle, never a malicious-code sandbox. Same-identity hostile code,
administrator/injected code, arbitrary internal loader mutation, compromised OS,
unproven native/DLL resolution and opaque package-data reads remain outside it.

## References

* [Node 24.22.0 synchronous hooks](https://raw.githubusercontent.com/nodejs/node/v24.22.0/doc/api/module.md)
* [Node 24.22.0 permission model](https://raw.githubusercontent.com/nodejs/node/v24.22.0/doc/api/permissions.md)
* [Windows explicit inherited handle lists](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)
* [Windows job objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
* [Atomic process job assignment](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812)

## Raw focused regression output

```text
✔ only the exact reviewed inert file bytes can become a boundary protocol (2.448ms)
✔ caller-consistent hashes cannot authorize entry source substitution (1.3954ms)
✔ caller-consistent hashes cannot authorize alternate allocation (0.511ms)
✔ caller-consistent hashes cannot authorize alternate fixture (0.2187ms)
✔ caller-consistent hashes cannot authorize unindexed file (0.3161ms)
✔ caller-consistent hashes cannot authorize omitted package metadata (0.2825ms)
✔ caller-consistent hashes cannot authorize runtime substitution (0.2209ms)
✔ caller-consistent hashes cannot authorize caller launch boolean (0.2204ms)
✔ forged and serialized protocol records cannot open a boundary (0.6669ms)
✔ unknown module loads and unindexed resolver targets refuse before next loader or evaluation (6.3335ms)
✔ supported ESM/CJS/JSON loads supply freshly verified descriptor bytes without delegating (2.6452ms)
✔ changed bytes and unknown format refuse before source is returned; failure closes descriptors (0.7533ms)
✔ cached entries still require exact parent and supported format (1.8031ms)
✔ closed lifetime refuses builtin loads as well as indexed files (1.7513ms)
✔ fake cold runtime gate preserves all false certifications and never evaluates the entry (1.5276ms)
✔ fake pre-import process gate refuses alternate physical executable (2.1547ms)
✔ fake pre-import process gate refuses worker override flag (1.1774ms)
✔ fake pre-import process gate refuses child override flag (0.7711ms)
✔ fake pre-import process gate refuses native addon override flag (0.6606ms)
✔ fake pre-import process gate refuses preload/cached fixture path (0.6216ms)
✔ fake pre-import process gate refuses ambient injection variable (0.5834ms)
✔ fake pre-import process gate refuses ambient executable search path (0.5349ms)
✔ fake pre-import process gate refuses in-root temporary directory (0.4941ms)
✔ fake pre-import process gate refuses writable process permission (1.7155ms)
✔ accepts independently pinned finite package superset with zero-byte data and genuine private lineage (18.925ms)
✔ refuses extra authority field even under regenerated test consistency pins (6.048ms)
✔ refuses wrong schema even under regenerated test consistency pins (5.0457ms)
✔ refuses profile substitution even under regenerated test consistency pins (3.0721ms)
✔ refuses root inventory substitution even under regenerated test consistency pins (3.8946ms)
✔ refuses build substitution even under regenerated test consistency pins (3.0607ms)
✔ refuses runtime substitution even under regenerated test consistency pins (3.3433ms)
✔ refuses mutable source root even under regenerated test consistency pins (2.4146ms)
✔ refuses case aliased install root even under regenerated test consistency pins (2.4326ms)
✔ refuses count mismatch even under regenerated test consistency pins (3.1621ms)
✔ refuses file byte limit even under regenerated test consistency pins (3.0842ms)
✔ refuses negative bytes even under regenerated test consistency pins (2.7906ms)
✔ refuses path escape even under regenerated test consistency pins (2.6165ms)
✔ refuses ADS file even under regenerated test consistency pins (2.5875ms)
✔ refuses secret as module root even under regenerated test consistency pins (2.1892ms)
✔ refuses missing package manifest even under regenerated test consistency pins (2.2678ms)
✔ refuses manifest hash mismatch even under regenerated test consistency pins (3.5259ms)
✔ refuses orphan file even under regenerated test consistency pins (2.4485ms)
✔ refuses orphan edge even under regenerated test consistency pins (2.4107ms)
✔ refuses missing root edge even under regenerated test consistency pins (2.3437ms)
✔ refuses required absence disguised optional even under regenerated test consistency pins (2.7003ms)
✔ refuses unknown asset mode even under regenerated test consistency pins (2.3027ms)
✔ refuses unknown record even under regenerated test consistency pins (3.1283ms)
✔ rejects changed inventory against unchanged independent expectations (3.0173ms)
✔ rejects forged profile and serialized root result instead of rootInput text/pins (2.301ms)
✔ rejects byte and line ambiguity before creating a brand (6.4626ms)
✔ rejects getters without invoking them and foreign input bytes (5.1609ms)
✔ raw UTF8 BOM cannot disappear before independent byte digest verification (3.8924ms)
✔ original rootInput text larger than a single helper string retains original reader bounds (5.117ms)
✔ record group overflow and aggregate size refuse without a raised v1 helper ceiling (15.2298ms)
✔ destination aliases and file/directory collisions refuse with consistent aggregate counts (4.7509ms)
✔ missing required root preflight never reads package bytes or launches metadata children (4.3749ms)
✔ fake-only collector captures finite graph/data bytes without evaluating selected source (15.7283ms)
✔ fake-only collector refuses path alias and closes every opened descriptor (3.2399ms)
✔ fake-only collector refuses hardlinked metadata and closes every opened descriptor (1.9044ms)
✔ fake-only collector refuses generic reparse and closes every opened descriptor (3.254ms)
✔ fake-only collector refuses mutating bytes and closes every opened descriptor (4.8283ms)
✔ fake-only collector refuses same-byte path replacement and closes every opened descriptor (5.9298ms)
✔ fake-only native requirement is reported without payload hashing (4.4666ms)
✔ fake-only declared dependency cycle terminates and retains both packages (8.3211ms)
✔ fake-only nested version is a distinct installed instance and preserves topology (9.4507ms)
✔ fake-only missing required dependency reports before payload capture, unlike optional absence (4.1304ms)
✔ fake-only posthog absence and emitted ESM require bridge stay separate pre-byte blockers (2.0685ms)
✔ fake-only untracked nested package refuses before payload capture (4.8271ms)
✔ fake-only benign ancestor sibling timestamp movement preserves the package snapshot (6.5503ms)
✔ fake-only changed package directory membership refuses even with unchanged directory timestamps (5.8052ms)
✔ forged inventory refuses before allocation access, filesystem calls, helpers or children (5.0018ms)
✔ serialized stage results never recreate the private consumer brand (0.248ms)
✔ genuine private tree stages an exact create-only union and closes all descriptors (26.161ms)
✔ scoped package paths stage with the private reader without widening v1 paths (15.2802ms)
✔ overlapping package metadata pins compare fields despite canonical key reordering (12.8941ms)
✔ source byte drift aborts the copy and preserves only the owned partial allocation (10.8243ms)
✔ interrupted create-only allocation closes descriptors and never adopts the partial root (13.7506ms)
✔ genuine required blocker refuses before even reading allocation getters or filesystem/helper work (4.2781ms)
✔ exact inert native fixture composes collector -> real reader -> stage -> closed custody protocol (28.8768ms)
ℹ tests 79
ℹ suites 0
ℹ pass 79
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 624.2403
```
Exit code: 0

## Raw final focused regression output after inventory followup

```text
✔ only the exact reviewed inert file bytes can become a boundary protocol (5.7171ms)
✔ caller-consistent hashes cannot authorize entry source substitution (1.4332ms)
✔ caller-consistent hashes cannot authorize alternate allocation (0.4628ms)
✔ caller-consistent hashes cannot authorize alternate fixture (0.33ms)
✔ caller-consistent hashes cannot authorize unindexed file (0.4888ms)
✔ caller-consistent hashes cannot authorize omitted package metadata (5.3403ms)
✔ caller-consistent hashes cannot authorize runtime substitution (4.1495ms)
✔ caller-consistent hashes cannot authorize caller launch boolean (0.9746ms)
✔ forged and serialized protocol records cannot open a boundary (4.2164ms)
✔ unknown module loads and unindexed resolver targets refuse before next loader or evaluation (11.6007ms)
✔ supported ESM/CJS/JSON loads supply freshly verified descriptor bytes without delegating (3.581ms)
✔ changed bytes and unknown format refuse before source is returned; failure closes descriptors (1.5629ms)
✔ cached entries still require exact parent and supported format (4.0505ms)
✔ closed lifetime refuses builtin loads as well as indexed files (2.6842ms)
✔ fake cold runtime gate preserves all false certifications and never evaluates the entry (2.6508ms)
✔ fake pre-import process gate refuses alternate physical executable (14.8701ms)
✔ fake pre-import process gate refuses worker override flag (15.4651ms)
✔ fake pre-import process gate refuses child override flag (14.0855ms)
✔ fake pre-import process gate refuses native addon override flag (10.5508ms)
✔ fake pre-import process gate refuses preload/cached fixture path (30.1768ms)
✔ fake pre-import process gate refuses ambient injection variable (16.7639ms)
✔ fake pre-import process gate refuses ambient executable search path (32.1027ms)
✔ fake pre-import process gate refuses in-root temporary directory (8.8815ms)
✔ fake pre-import process gate refuses writable process permission (27.0874ms)
✔ accepts independently pinned finite package superset with zero-byte data and genuine private lineage (42.2498ms)
✔ refuses extra authority field even under regenerated test consistency pins (8.7733ms)
✔ refuses wrong schema even under regenerated test consistency pins (8.7648ms)
✔ refuses profile substitution even under regenerated test consistency pins (4.8958ms)
✔ refuses root inventory substitution even under regenerated test consistency pins (5.3364ms)
✔ refuses build substitution even under regenerated test consistency pins (5.0611ms)
✔ refuses runtime substitution even under regenerated test consistency pins (6.1076ms)
✔ refuses mutable source root even under regenerated test consistency pins (4.0312ms)
✔ refuses case aliased install root even under regenerated test consistency pins (3.9709ms)
✔ refuses count mismatch even under regenerated test consistency pins (4.8998ms)
✔ refuses file byte limit even under regenerated test consistency pins (6.4399ms)
✔ refuses negative bytes even under regenerated test consistency pins (4.3554ms)
✔ refuses path escape even under regenerated test consistency pins (4.127ms)
✔ refuses ADS file even under regenerated test consistency pins (4.3635ms)
✔ refuses secret as module root even under regenerated test consistency pins (3.6638ms)
✔ refuses missing package manifest even under regenerated test consistency pins (3.7984ms)
✔ refuses manifest hash mismatch even under regenerated test consistency pins (6.0692ms)
✔ refuses orphan file even under regenerated test consistency pins (6.6212ms)
✔ refuses orphan edge even under regenerated test consistency pins (4.0801ms)
✔ refuses missing root edge even under regenerated test consistency pins (4.4844ms)
✔ refuses required absence disguised optional even under regenerated test consistency pins (4.7955ms)
✔ refuses unknown asset mode even under regenerated test consistency pins (4.2922ms)
✔ refuses unknown record even under regenerated test consistency pins (4.8968ms)
✔ rejects changed inventory against unchanged independent expectations (8.0645ms)
✔ rejects forged profile and serialized root result instead of rootInput text/pins (4.3516ms)
✔ rejects byte and line ambiguity before creating a brand (9.0545ms)
✔ rejects getters without invoking them and foreign input bytes (6.2747ms)
✔ raw UTF8 BOM cannot disappear before independent byte digest verification (7.6818ms)
✔ original rootInput text larger than a single helper string retains original reader bounds (10.5909ms)
✔ record group overflow and aggregate size refuse without a raised v1 helper ceiling (28.2912ms)
✔ destination aliases and file/directory collisions refuse with consistent aggregate counts (14.132ms)
✔ missing required root preflight never reads package bytes or launches metadata children (5.782ms)
✔ fake-only collector captures finite graph/data bytes without evaluating selected source (27.2149ms)
✔ fake-only collector refuses path alias and closes every opened descriptor (5.2658ms)
✔ fake-only collector refuses hardlinked metadata and closes every opened descriptor (3.2882ms)
✔ fake-only collector refuses generic reparse and closes every opened descriptor (6.971ms)
✔ fake-only collector refuses mutating bytes and closes every opened descriptor (10.2697ms)
✔ fake-only collector refuses same-byte path replacement and closes every opened descriptor (12.8753ms)
✔ fake-only native requirement is reported without payload hashing (8.5692ms)
✔ fake-only declared dependency cycle terminates and retains both packages (17.9529ms)
✔ fake-only nested version is a distinct installed instance and preserves topology (18.4765ms)
✔ fake-only missing required dependency reports before payload capture, unlike optional absence (7.9066ms)
✔ fake-only posthog absence and emitted ESM require bridge stay separate pre-byte blockers (4.3163ms)
✔ fake-only untracked nested package refuses before payload capture (7.1642ms)
✔ fake-only benign ancestor sibling timestamp movement preserves the package snapshot (16.4727ms)
✔ fake-only changed package directory membership refuses even with unchanged directory timestamps (19.1389ms)
✔ fake-only scoped nested namespace expansion refuses before scanning later scopes (41.0902ms)
✔ forged inventory refuses before allocation access, filesystem calls, helpers or children (5.1587ms)
✔ serialized stage results never recreate the private consumer brand (0.5902ms)
✔ genuine private tree stages an exact create-only union and closes all descriptors (51.776ms)
✔ scoped package paths stage with the private reader without widening v1 paths (23.7742ms)
✔ overlapping package metadata pins compare fields despite canonical key reordering (20.333ms)
✔ source byte drift aborts the copy and preserves only the owned partial allocation (17.8855ms)
✔ interrupted create-only allocation closes descriptors and never adopts the partial root (21.5938ms)
✔ genuine required blocker refuses before even reading allocation getters or filesystem/helper work (7.8167ms)
✔ exact inert native fixture composes collector -> real reader -> stage -> closed custody protocol (48.275ms)
ℹ tests 80
ℹ suites 0
ℹ pass 80
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1620.7278
```
Exit code: 0

## Raw final npm run check output

```text

> rest-express@1.0.0 check
> node scripts/check-runtime.mjs && tsc && node scripts/check-no-storage-imports.mjs && node scripts/check-loc-limits.mjs && node scripts/check-node-tool-syntax.mjs && node scripts/tools/check-module-assessment-metadata.mjs && node scripts/tools/generate-module-assessment-status-report.mjs --check && node scripts/tools/check-w9-template-coverage.mjs && node scripts/tools/check-w10-worksheet-coverage.mjs

Runtime parity verified: Node 24.22.0, PostgreSQL 18 declarations.
LOC guard: 11 baselined file(s) shrank — nice.
  client/src/pages/Reports.tsx — 410 -> 404
  client/src/pages/settings/sections/ProfileSection/components/ProfilePictureUpload.tsx — 419 -> 407
  server/modules/accounts/accounts.routes.ts — 150 -> 142
  server/modules/goals/goals.routes.ts — 147 -> 146
  server/modules/investments/investments.routes.ts — 112 -> 111
  server/modules/recurring/recurring.routes.ts — 106 -> 104
  server/modules/settings/settings.account-deletion.service.ts — 616 -> 531
  server/modules/transactions/transactions.routes.ts — 333 -> 330
  server/routes/admin.ts — 508 -> 506
  server/routes/grz-securities.ts — 573 -> 571
  server/seed.ts — 1218 -> 751
Run `node scripts/check-loc-limits.mjs --update` to lock in the gains.
LOC limit check passed: 60 known oversized file(s), 0 new, 0 grown.
Node tool syntax check passed for 44 .mjs files.
Module assessment metadata check passed: 22 canonical module(s), 44 release-gate item(s), 0 security gate item(s).
Module assessment status report check passed: 22/22 assessed modules, 0/22 final-ready modules, and 0 security gate entries.
W9 template coverage check passed: 22 staging release-gate item(s) mapped to existing smoke rows.
W10 worksheet coverage check passed: 22 module row(s) match canonical assessment paths, scores, and W10 gate IDs.
```
Exit code: 0

## Subsequent parent acceptance

Parent integrated source candidate `406e1e6` as
`4a0338b53deec8d3e23cd29a41c71c48ca87654a`. Canonical focused verification passed
254/254 with no skips and `npm run check` passed. After independent operational
helper/allocation review, native suite `r20stage20261028a1` passed all five cases
in 28.863 seconds, with independently verified process exit and retained file
hashes. [RUNTIME-STAGED-ACCEPTANCE.md](RUNTIME-STAGED-ACCEPTANCE.md) records exact
pins, positive/refusal observations and unexercised boundaries. This later parent
acceptance supersedes the author checkpoint's native-pending status without
changing its historical test claims or granting application execution.
