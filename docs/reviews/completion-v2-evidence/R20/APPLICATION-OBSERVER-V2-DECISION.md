# Accepted R20 inventory-v2 and observer implementation decision

30 October 2026. Coordinator accepts the following Astra High architecture
proposal as the next coherent implementation scope under master v2.6. This
supersedes the proposal's pending-adjudication wording only; it is not approval
of unwritten implementation or application execution. The fixed runner, complete
preflight gate, retained window, two actual native observations, exact references,
aggregate limits and private lineage requirements are mandatory as one joined
slice. No standalone helper counts as completion of this slice.

Proposal author: r20_graph_final_review, Astra High. Verified proposal SHA-256:
e1675068d85d63dfeb00f1665110657cb77b1e035fc61c79709f5adc319ffa02.
Authoritative source inspected at canonical8467ec4a27233d1c44103d52868a2aceeb7cd5f5.
The proposal below is retained verbatim. Parent retains canonical evidence,
serialized runtime windows, independent review and final integration. No production,
shared-database, provider, external-message or release authority is added.

---
# Proposal: connect application inventory and native resolution in one observer slice

30 October 2026. Proposed by `r20_graph_final_review` for parent adjudication.
Reviewed canonical HEAD: `8467ec4a27233d1c44103d52868a2aceeb7cd5f5`.
This is an architecture proposal, not implementation acceptance or authorization
to execute the application. Only this proposal was authored. No native process,
test, resolver, database, provider, browser or application was run for this review.

## Decision requested

Implement one coherent **version-2 application inventory assembly and observation
slice**, with a fixed two-command runner: `collect`, then independently pinned
`observe`. Its deliverable is the complete graph census joined to measured lookup
inputs and repeatable native outcomes under one retained before/after window.
Do not deliver another standalone helper as completion of this slice.

Proceed with the bounded supported topology already accepted. Preserve explicit
blockers for topology that cannot yet be completely enumerated. The final goal
remains observation of the actual entire emitted application, followed by the
separate stage/load/runtime work; this proposal neither removes troublesome roots
from that goal nor promises that all historical 41 package rows will pass now.

Use a new v2 reader and distinct lineage. Keep the accepted v1 reader, graph schema,
component contracts and native transport unchanged. Extend the existing collector
and file window only where composition actually needs it, with their existing
interfaces and focused regressions preserved.

## Reading order and current-source findings

Read APPLICATION-ROOT-INVENTORY-DECISION.md, APPLICATION-OBSERVATION-FOOTPRINT.md,
APPLICATION-LOOKUP-COLLECTOR.md and APPLICATION-NATIVE-TRANSPORT.md, then this
proposal. All are under `docs/reviews/completion-v2-evidence/R20/` except this file.

Current accepted component hashes, all under `server/testing/production/`:

| File | SHA-256 |
| --- | --- |
| application-root-graph.mjs | 9bd34bcce7aabf28ffa9e24d292493c24d0d004291ed61635ca8586e84c413ff |
| application-root-inventory.mjs | 0f035900a7b50568d4f1080fd76f6f5140d12fb3a1d7fb179af1e5be12355d18 |
| application-file-window.mjs | 441830858e59d2aa80cc677f2829bb28fd00825837b24c7584f311fee207cfc9 |
| application-lookup-footprint.mjs | 792b40556e8fcd30509dc3be05014ba1904a603d892398bb9af66326ccb3af25 |
| application-native-resolution.mjs | 1caf7fb1089ca1b1d7a28439b0a142d5279dc792a2233a444d7640833bcf8f89 |
| application-native-resolution-child.mjs | 8217df6a796599ba63d07e0b69b2e04bfb466a146c6adc546b9989346e8fe141 |

Concrete composition gaps:

1. The v1 reader's `files()` requires positive size and one role, while `edges()`
   references only one candidate target and rejects unused manifest rows. A parent
   scope or another conditional leaf's scope cannot be disguised as a project
   manifest. The collector can produce multiple leaves for one graph edge.
2. Collector diagnostics currently discard the gathered footprint on missing,
   directory and ambiguous-JavaScript paths. Those messages cannot authorize a
   resolver call. The collector also gives each call its own 60-second budget and
   performs a measurement window for each call; a loop over 41 independent calls
   is not a bounded 60-second application observation.
3. Native requests need device/inode pins for runtime, both fixed transport files
   and physical parents. The file window currently retains these identities
   privately and exposes only requested-directory identities at completion.
4. Native output calls every `.js` target `unestablished-js`. Only the measured
   target scope can establish ESM/CommonJS for the observer. The native transport
   must remain independent of that interpretation.
5. The v1 `identity.harnessEntry` also determines native argv. The integrated
   observer runner and native resolver child are different entries and need
   separately named, exact invocation bindings.

## Public interfaces and execution host

Use these names unless implementation review identifies a clearer equivalent:

```text
collectApplicationRootCandidate(graphText, collectionRequestText, expectedRequestSha256)
  -> Promise<unbranded serialized v2 candidate | unbranded blocked collection report>

readApplicationRootInventoryV2(graphText, inventoryText, independentlySuppliedPinsText)
  -> private validated-application-root-inventory-v2 record

observeApplicationRootResolution(validatedV2Record)
  -> Promise<private application-root-observation-v1 record | unbranded blocked report>

requireApplicationRootObservation(observationRecord)
  -> deeply frozen observation payload
```

Collection never calls the native resolver and never manufactures an independent
approval pin. Its returned hash is informational. The coordinator freezes and
independently supplies the candidate hash and identity/runtime/harness/root pins
before `read` and `observe`. Do not make `collect -> read(using its own hash) ->
observe` a convenience path.

Add a fixed `application-root-observation-runner.mjs` with precisely the commands
`collect` and `observe`. It accepts bounded serialized input on stdin, emits one
bounded serialized report, and imports only the reviewed observer closure and
builtins. No arbitrary source path, callback, resolver, extra flag or environment
argument. It must run with the exact pinned Node 24.22.0 win32/arm64 executable,
empty execArgv, exact runner argv, and the same explicitly defined 16-key clean
environment used by the native transport. Validate the actual host values before
collection/observation, not only a serialized policy label. No ambient options,
preloads, loaders, coverage output or inherited identity variables.

The runner reads the v2 record and observes it in the same process/realm. Its JSON
report is evidence only: serialization does not export the private brand. A future
consumer cannot recreate lineage from that JSON. Tests may spawn this fixed runner
under the parent-owned native window; no selected application module is imported.

The complete source closure must be a reviewed fixed allowlist, not an arbitrary
caller-provided subset: runner, observer, v2 reader, graph/JSON/primitives, collector,
package parser, physical path helper, file window and both native transport files.
Pin every local member's canonical path and bytes. Child and runner entries must
be members of this closure and occupy their fixed paths. Byte checks do not prove
the identity of already-loaded modules; retain that limitation explicitly.

## Inventory v2: exact structural changes

Kind remains `pfa-application-root-inventory`, version becomes 2. Implement a new
reader module, without permitting v1 brands through an observer adapter. Continue
the same graph kind/schema/digest/canonical-newline checks and derive the member
census from the graph, not from a preparation package-name list.

Keep identity, graph, runtime, resolutionPolicy, dependencyRoots, scopeRoots,
members, edges, files, lookup, certifications and limitations as closed groups.
Add `fileIdentities`, `footprints` and `metadataTool`. Remove v1's ambiguous
single-target declaration for a package edge in favor of its footprint reference.

The independent pin document has exactly `inventorySha256`, `identity`, `graph`,
`runtime`, `resolutionPolicy`, `dependencyRoots`, `scopeRoots` and `metadataTool`.
Compare every named group exactly, in addition to hashing the entire inventory.
The remaining inventory groups, including all physical identities and traces, are
covered by that independently supplied inventory hash. Do not let either command
silently substitute freshly collected values for these pins.

### Execution and physical bindings

- `identity` contains candidateId, evidenceClass, reviewRef, sourceRevision,
  observerEntry, resolverEntry and harnessFiles. Both entries are exact fixed
  allowlisted files. Independently supplied pins bind the whole identity group.
- `runtime` binds executable byte pin, version/platform/arch, observerArgv,
  resolverArgv and the exact environment-policy version. Resolver argv remains
  `--experimental-import-meta-resolve <fixed-native-child>`; it is not the runner
  entry. The candidate's observerArgv binds the eventual `observe` command.
  The separate closed collection request binds the actual `collect` command and
  carries the expected observation invocation; collection must not rewrite that
  invocation into its own current argv. Both commands validate their actual host.
- `metadataTool` binds SystemRoot `C:\Windows` and the exact PowerShell
  path/size/hash/dev/ino with expected link count 2. Preserve this one OS exception;
  every other measured file requires link count 1.
- `fileIdentities` is a unique canonical-path table of dev/ino for exactly the
  regular files in the measured union: graph file, all emitted outputs, runtime,
  complete harness closure and footprint files. No missing, extra or conflicting
  rows. OS-tool identity stays in its separately checked group. Directory
  identities remain in lookup rows. The candidate's identities are independently
  hash-bound; observation rechecks them before native invocation, including
  identical-byte replacement between collection and observation.

### File rows and genuine manifest uses

Use one physical row per path: `{path, sizeBytes, sha256, kind}`, where kind is
`target` or `manifest`. Do not make role labels an escape hatch for unused files.
All manifest rows must be named `package.json`, contain valid bounded UTF-8 JSON
at collection/observation, and have at least one validated semantic use below.
All target rows must be referenced by a candidate leaf. A manifest selected as a
JSON target uses its single manifest row for both purposes. Enforce dependency
root containment for every selected target, including manifest-as-target.

No optional lock/project-provenance bypass is needed in this next version. Omit
unreferenced project/lock rows. A genuine project package.json is retained through
its parent-scope/package/target-scope use, not an exemption. Optional lock provenance
can be added later with an explicit reference contract.

Permit size 0 only for ordinary selected target data, with the exact empty-file
SHA-256. Manifest, graph, executable and harness pins remain positive-size; graph
member output rules remain unchanged. Empty JSON manifests are invalid JSON, not
an allowed empty data exception. Empty `.js` stays format-unestablished unless a
measured scope explicitly supplies a supported type.

### Scope and lookup references

Each package edge has exactly one footprint, keyed by the exact tuple
`[parent, originalKind, mode, literalSpecifier, typeOnly]` plus the graph occurrence
count. Type-only must be false for package resolution. No deduplication by package
name or resolved target may merge different parents, kinds or counts.

Keep each edge's graph-derived `parent`, `kind`, `specifier`, `typeOnly`, `mode`,
`occurrences` and `classification` unchanged. Its package target is exactly
`{kind: 'footprint', key}`. Define key as the stable JSON serialization of the
five-element tuple above; the footprint repeats that tuple and `occurrences` for
exact cross-checking. Count is a checked value, not a way to create another key.
No positional index or caller-chosen package label is an identity. Nonpackage
edge target forms remain those of the graph, with their existing validation.

Each footprint binds packageRoot, packageManifest, selfReference, a parent scope
trace, the ordered nearest-package lookup trace, and ordered candidate leaves.
Each regular candidate leaf binds path, file-row reference, format and its separate
target scope trace. Scope traces identify their subject (physical emitted parent
or exact candidate path) and every visited directory/probe until the first present
manifest or Node's node_modules boundary. A manifest probe refers to an exact file
row; an absent probe refers to an exact immediate-existing-parent absence/listing
row. A null scope needs its boundary trace, not merely a null value.

These traces explicitly justify parent/intermediate scope and selected-package
manifest uses. Repeated uses may reference one physical row. Check that each role
matches the actual subject, ancestor order, nearest declared manifest and boundary;
every measured manifest must be used by at least one such trace or be a selected
JSON target. No arbitrary `intermediate-scope` catch-all role. No skipped nearer
manifest, case alias, absent positive ancestor, conflicting listing/kind, duplicated
trace or unused manifest. Reconstruct the same trace from pinned bytes during
observation; the reader's structural checks alone do not establish completeness.

Candidate leaves represent all relevant safe exports alternatives without selecting
conditions. Retain source property order through the existing raw-byte pin and
ordered parser; do not canonicalize the original package manifest. Alternatives
must remain measured even when native defaults later choose only one.

### Missing, directory and typeless dispositions

Extend the collector's version-2 batch result to distinguish:

| Leaf or outcome | Required representation and treatment |
| --- | --- |
| Regular known-format file | Exact file pin/identity plus target scope; `.mjs`/`.cjs` explicit, `.js` requires measured module/commonjs type for usable-format status. |
| Typeless/unsupported-type `.js` | Regular pinned file plus scope trace, format `unestablished-js`; explicit `AMBIGUOUS_JAVASCRIPT_FORMAT` blocker. It may be resolved for diagnostic evidence after complete preflight; never relabel as CommonJS. |
| Missing exact exports/subpath target | Expected canonical target path plus first-missing-component probe and its real parent listing. Mark footprint complete only if every resolution/format-scope input for that target can also be bounded. Start by supporting missing targets whose immediate directory exists. A missing intermediate directory with unestablished scope remains incomplete; do not invent nested absence probes under nonexistent parents. |
| Existing directory target | Exact directory identity/listing and ancestor bindings; no file pin or size-zero fiction. Native directory outcome remains a blocker, never extension/index fallback. |
| JSON/native/other regular target | Preserve exact file pin and raw format with `UNSUPPORTED_SELECTED_FORMAT`; no evaluation or native-addon loading. |
| Excluded exports/self-reference | A complete manifest/lookup footprint may have no candidate leaves. Only actual matching native denial after the window becomes an observed blocked outcome. |
| Unknown/unbounded lookup topology | Preserve the diagnostic reason and the full graph row, with footprint incomplete and no native call for this run. Never turn boundary exhaustion into PACKAGE_NOT_FOUND. |

Do not treat a missing legacy main/index as complete: unresolved legacy fallback
still blocks until all higher-priority fallback probes are implemented and reviewed.
Patterns, arrays, unsafe targets, malformed permissions/metadata, reparse cases and
boundary crossings retain existing refusal/incomplete distinctions. A known
missing leaf in an unused condition does not by itself imply that native resolution
selected the missing leaf; selected outcome is determined only by native output.

Graph internal, normalized builtin and type-only rows retain their exact dispositions
and counts. Graph require/nonliteral/unsupported rows remain explicit blockers;
they are never sent to the ESM transport as successful package resolutions.

## Collector and window amendments required for coherence

Add a versioned **batch** collector entry in the existing collector module. Accept
all graph package tuples together, one monotonic remaining budget and shared caches
for identical physical manifests/listings/files. Bound the aggregate union, not
each edge independently. Preserve existing single-edge v1 behavior. Version 2
returns trace-rich complete footprints or explicit incomplete rows; it must not
discard a complete measurable footprint merely because a leaf is typeless, missing
or a directory. Byte/identity mismatch is refusal, not an ordinary unsupported row.

Add these narrowly scoped methods to the existing file-window module:

```text
inspectApplicationFileWindow(genuineOpenWindow)
  -> immutable measured file identities, requested directory identities,
     request hash and remaining monotonic budget; no descriptors or mutable state

checkApplicationFileWindow(genuineOpenWindow)
  -> Promise<void> after the existing descriptor/path/native-metadata/listing/
     absence checks, without consuming a still-valid window
```

`inspect` rejects closed/expired/forged windows. `check` closes and refuses on any
failure. Factor finish through the same check logic, then close successfully and
consume the window. Preserve its final post-read path/listing checks. Extend final
measurement output with the same file-identity data so collection can serialize
candidate identities after successful cleanup. Neither accessor nor JSON copies
create a new authority brand. Keep no public FD, custom callback or reset method.

## Exact observation sequence

1. The fixed clean runner starts one 60-second monotonic observation budget before
   reading bounded stdin, then reads graph/candidate/independent pins and creates the
   v2 reader's private record. Verify actual runtime/argv/environment and exact
   reviewed harness closure. Reject v1/component brands and JSON copies before
   any native launch. Collection has its own single bounded command budget;
   observation never inherits a fresh per-helper allowance.
2. Reconstruct the entire graph package census with the batch collector. Compare
   all tuples, trace references, candidate leaves, byte/identity pins, positive
   listings and absences against the independently pinned v2 candidate. A candidate
   is not accepted because its own hash agrees with its own contents.
3. **Global admission gate:** every literal ESM package row must have a complete
   bounded footprint before any package row is sent to native resolution. If any
   such row is incomplete, return an unbranded whole-census blocked report and make
   zero native calls. Do not silently resolve a convenient subset. Known graph
   require/nonliteral blockers remain in the census and in any later report.
4. Open one outer retained file window covering the graph file, every emitted
   output, runtime, full observer/transport closure, all alternative candidate
   files/manifests, all relevant directories/absences, and the separately pinned
   OS tool. Use the remaining aggregate budget. Compare its live measured file
   and directory identities with the candidate before proceeding.
5. Build the native request internally from the exact graph package tuples and
   the open window's runtime/harness/physical-parent pins. Invoke the unchanged
   fixed transport once for the batch. Pass only remaining time. Never accept
   caller-provided native results or resolver callbacks.
   With zero eligible package tuples, skip both native calls (the transport
   requires a nonempty batch), retain full measurement checks and report exactly
   zero required/measured native rows. Never fabricate a probe edge.
6. Validate every returned row and canonical URL against its own footprint: exact
   parent tuple/count, selected package root, selected leaf or declared missing/
   directory outcome, approved dependency boundaries and byte/identity bindings.
   For `.js`, reconcile raw `unestablished-js` with the independently measured scope;
   do not overwrite the raw diagnostic. Only supported measured scope types permit
   the separate interpreted format to become ESM/CommonJS.
7. Run the non-consuming retained-window check. Invoke the fixed native transport
   a second time in another fresh child with the same tuple/pin request and reduced
   remaining budget. Match semantic rows and exact invocation, ignoring only the
   expected request hash difference caused by the smaller deadline field.
8. Finish the retained window with final descriptor, path, Windows metadata,
   listing and absence checks; close every handle and wait for every spawned child
   to close. Only then create a private observation record. A timeout, unexpected
   native error/URL, drift, cleanup failure or mismatch yields no observation brand.

An expected exports-denial or supported missing/directory/typeless result may be
recorded as an **observed blocked outcome**, with its stable footprint and two
matching native results. Unexpected native error codes remain raw diagnostics and
refuse observation acceptance; do not infer missing package or compatible fallback.

Use `try/finally` to abandon the outer window on every failure. Do not return from
a Promise.race while a child remains alive. Do not reset a 60-second budget for
each helper, native child or graph edge. Keep source/metadata pin verification
inside that budget; long host operations can refuse, never be reported as complete.

## Observation lineage and reporting

Use a new private WeakMap in the observer, separate from the v2 declaration reader,
v1 reader and every component/stage brand. Payload includes candidate hash, graph
raw/declared hashes, observation ID, exact invocation/runtime/harness identity,
per-edge raw and interpreted outcomes, and matched before/after measurement data.
The public record is frozen and minimal; clones, reconstructed objects and old
brands fail `requireApplicationRootObservation`.

Status is `observed` or `observed-with-blockers`, never `ready` or `launchable`.
Report complete graph/member/import counts, internal/builtin/type-only occurrences,
required graph blockers, package footprints required/complete, native rows measured,
usable-format rows and observed blocking outcomes. Preserve each occurrence count.
All existing generic certification flags remain false, including allRootsObserved;
explicit counts/outcomes carry the new narrowly defined observation evidence.
Stage, custody, transitive closure, runtime dependency/module identity, producer,
job capability and execution authority remain false. No consumer outside this slice.

## Aggregate limits and compatibility

Retain 1 MiB graph, 2 MiB inventory, 128 KiB independent pins, 256 emitted members,
8192 source mappings, 4096 import occurrences, 256 package tuples, 128 blocker rows,
1 MiB manifest/harness file, 32 MiB target, 128 MiB runtime and 256 MiB total measured
file bytes. Count at most 512 distinct regular measured files across all roles,
4096 distinct positive/probed paths, 4096 listing entries and 4096 total trace steps,
1024 paths per native metadata batch, 128 leaves per edge and the existing export
depth/visit bounds. Refuse overflow; never truncate. Share paths only when exact
canonical path, bytes and physical identity agree; same bytes at different paths
remain different module candidates.

Runner stdin may use a closed container up to 8 MiB to carry escaped graph,
inventory and pins strings; each inner document still enforces its own original
bound. This is transport framing, not a larger inventory allowance. Cap serialized
runner output at 8 MiB, refusing before emission if exceeded; pipe enforcement
must also terminate overflow. Do not serialize target contents, credentials or environment
values beyond the fixed synthetic invocation policy.

## Exact proposed ownership and delivery order

One implementation owner should own the integrated slice below in an isolated
worktree. Independent reviewers remain separate; parent owns evidence freeze,
native scheduling, adjudication and integration. No subagent/delegation authority
is granted by this proposal.

All proposed source paths are under `server/testing/production/`:

| Action | Files | Responsibility |
| --- | --- | --- |
| New | application-root-inventory-v2.mjs; application-root-inventory-v2.regression.mjs | Closed v2 schema, exact reference/census checks and separate declaration lineage. |
| New | application-root-observation.mjs; application-root-observation-runner.mjs; application-root-observation.regression.mjs | Candidate assembly, strict runner, complete preflight gate, retained-window/native orchestration, reconciliation and private observation lineage. |
| Modify | application-lookup-footprint.mjs; application-lookup-footprint.regression.mjs | Versioned aggregate collector, scope/lookup traces and complete negative leaf evidence. |
| Modify | application-file-window.mjs; application-file-window.regression.mjs | Safe measured-identity access and non-consuming window check. |

Nine files total. Preserve existing graph, v1 reader, native transport, shared
primitives, package parser, component brands, build/start commands and application
consumers. If implementing the agreed behavior requires another ownership path,
the parent should adjudicate that concrete change before integration; no need to
request renewed owner permission for already authorized inert local work.

Build meaningful failing controls first; implement v2 reader plus batch collection,
then the retained-window amendments and the integrated runner/observer. Acceptance
is of the entire joined synthetic journey, not separate helper GREEN counts alone.

## Required meaningful controls and acceptance boundary

1. Poisoned emitted application, trusted members, packages and preloads: full
   collect/freeze/read/observe succeeds for supported fixtures, two real native
   children run, no selected side-effect marker exists, all authority flags false.
2. Full graph census with two physical parents selecting different installations,
   conditional alternatives, scoped names, shared manifest/target bytes and a
   self-reference. Swapped/collapsed tuple, count, member/getter or omitted row
   refuses. Native defaults choose the result, not branch order guessed by us.
3. Parent scope and nested target scopes differ. Each intermediate/alternative
   manifest has a genuine use; missing nearer manifest proof, unrelated extra
   manifest, forged project role, conflicting listing and incorrect nearest scope
   all refuse. Incomplete preflight demonstrably launches zero native children.
4. An empty `.mjs` data target is measured and resolved. Empty manifest/code/runtime
   pins fail. Manifest-as-JSON target remains one physical row with two uses and
   an unsupported-format blocker; moving it outside dependency roots refuses.
5. Stable excluded exports, directory target, supported missing target and typeless
   `.js` retain distinct observed blocked outcomes. Nested missing scope or legacy
   fallback beyond supported enumeration yields no native call. An unused missing
   condition leaf cannot be reported as the selected result.
6. Change source/output/manifest/target bytes, physical inode, directory identity,
   absences or nearer package between collection and observation: refuse before
   native where detectable. Change any of these during native/check/post-check:
   refuse without a brand. Restore byte-identical content at a new physical identity
   and prove refusal. Failed cleanup also prevents the brand.
7. Actual argv/environment/runtime/harness/OS-tool mismatch; case/query/hash aliases,
   symlink/junction/hardlink, unapproved result URL and extra source closure member
   all refuse. Capabilities unavailable on a host must be explicit unsupported test
   limits, never passing refusal tests that did not create the condition.
8. Compare two actual fresh native children; a test-only interposition may mutate
   owned fixture inputs between phases, but production accepts no injected resolver
   or phase callback. Preserve raw RED and exit evidence. Test deadline during
   preflight, open window, native operation and postcheck, with child/FD cleanup.
9. A genuine v2 record works; v1/component/JSON-cloned declaration and observation
   records fail. Independently pinned stale inventory refuses even if the collector
   recomputes a new self-hash. Serialization never transports observation authority.

After independent exact-source review and these serialized synthetic controls,
parent may schedule a separate installed-emission **collection** over the reviewed
graph. Independently freeze that candidate. Run installed native observation only
if the complete preflight for all literal package rows fits the reviewed policy
and bounds. Otherwise retain the whole-census blocker report and implement the
specific missing topology next. Do not raise limits, disable features, reinterpret
old component acceptance, guess typeless formats or claim full-root success to
force progress.

Transitive package closure, relocation/staging, custody/loading controls, canonical
authority-cell identity, required Redis job capability, protected HTTPS/PostgreSQL
journeys and persistence are still mandatory subsequent work. This integrated
observer is necessary progress toward the full application; it is not a reduced
product or an application readiness verdict.

## Accepted collection-surface clarification,30 October2026

The coordinator accepts Astra High's exact clarification in
APPLICATION-OBSERVER-V2-INCOMPLETE.md, SHA256
57a2000b7dfcce9ec616331626d5c8d0b92c539af77c0ec968ba68e91a6aaf9b.
It supersedes only the ambiguous candidate-or-report return surface above. One
closed unbranded envelope carries a sole candidateText string or null. A valid
incomplete candidate retains the whole census and may receive structural
reader lineage from external pins; matching reconstruction still blocks globally
with zero native calls and no observation brand. Drift/unsafe evidence remains
refusal. Aggregate exhaustion may yield blocked-with-null, never a truncated or
accepted candidate. The four additional controls are required for this slice.
