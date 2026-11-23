# R20 application inventory declaration reader

30 October 2026. This record accepts the structural reader and its private
declaration lineage only. Governing requirements remain the master specification
v2.6, `APPLICATION-ROOT-INVENTORY-DECISION.md`, and the application module identity
plan. No observation, stage, custody, application execution or release is accepted.

## Ownership and exact source

Parent authored only these new files under `server/testing/production/` in
`C:\Users\USER\.codex\worktrees\capital-r20-inventory-envelope\personal-finance-app`,
branch `codex/r20-inventory-envelope`, base
`376a5e93d10d25d2b5a5a1863f2c023232a5bbeb`:

| File | SHA-256 |
| --- | --- |
| `application-root-inventory.mjs` | `040a840bf0aba03f6dde7165f615b4359e07d74aede216e970f30b2ab993a5a9` |
| `application-root-inventory.regression.mjs` | `cd61c9714199b6f026ac93f3fdb393df9fe474402a8b536e4cdeb8c1a5a967a4` |

The integrated graph helpers remain unchanged. The coordinator copied the two
reviewed files into the canonical campaign checkout with exact hash parity.
The isolated author files remain present. Source-freeze SHA-256 is
`c4245a4c2ce3b0fb111223571bab31381bc49ddda0bfe941c91f631919a1a813`.

## Implemented contract

`readApplicationRootInventory(graphText, inventoryText, pinText)` accepts canonical
serialized data only. Independently supplied pins bind the complete inventory
hash plus identity, graph, runtime, resolution policy and approved roots. This
compares pins; it does not authenticate their origin. The graph helper separately
checks the graph's raw hash and internal digest. The reader deep-freezes new data
and creates an application-specific private WeakMap record. Its companion
`requireApplicationRootInventory` rejects cloned/reconstructed/old records.

Closed-schema groups bind candidate UUID, evidence class, review reference,
source revision and exact harness file pins; graph/emission root; Node executable
pin and version24.22.0/win32/arm64; exact explicit-parent argv; policy; full emitted
member mappings and physical parent URLs; full normalized edge census; selected
file/manifest pins; directory identities/listings and absent probes. The source
revision is review provenance, not a manufactured historical build identity.
Compiler-configuration limitations remain explicit.

The exact invocation declaration is `--experimental-import-meta-resolve` followed
by the pinned harness entry. Additional conditions are empty. The named
`clean-windows-arm64-utc-v1` policy is an obligation for the forthcoming observer,
not an assertion that this reader inspected process environment. It must enforce
the clean Windows ARM64/UTC environment and reject ambient options, loaders and
preloads under the accepted decision before any resolution. The reader performs
no filesystem observation and cannot certify executable or harness bytes merely
from their labels or declared hashes.

Each graph row retains its parent, original kind, mode, specifier, type-only flag
and occurrence count. Internal/builtin/type-only/unsupported dispositions must
match the graph. Package dispositions may be unobserved, a pinned candidate file,
or a closed blocked reason. Candidate JSON/native/other formats retain explicit
`UNSUPPORTED_SELECTED_FORMAT` blockers; missing packages, excluded subpaths and
unsupported lookup footprints remain explicit. Every package row still carries
`RESOLUTION_UNOBSERVED`, and the footprint remains unobserved. No candidate is a
successful observation.

Selected target files remain within exact dependency boundaries. Manifest and
scope references must agree with the nearest already-declared ancestor manifest.
A package's own manifest may be one JSON file with both target and metadata uses;
the same dependency boundary and unsupported-format blocker still apply. This
does not certify the actual nearest scope on disk: the observer must collect and
verify the entire bounded lookup footprint, including omitted nearer locations.

Known present files/directories, supplied listings and absent probes are reconciled
before issuing lineage. Contradictory absences, absent ancestors, missing children,
wrong kinds and case aliases refuse. Harness/runtime files cannot be placed inside
the emission/dependency roots through case differences. Directory declarations
must have directory attributes without reparse flags. Actual Windows identity,
hardlink/reparse/realpath checks remain future observation obligations.

Bounds include2MiB inventory,128KiB caller pins,64 harness files,512 selected
file records,16 roots per root class,4096 lookup paths/probes and128 blocker rows.
The blocker limit includes unobserved package rows and the footprint blocker, so
it is stricter than256 external graph rows. File sizes and aggregate256MiB,
metadata batches up to1024 and deadline up to60seconds are checked. Current pin
schema requires positive file sizes; a zero-byte selected target cannot be
accepted as a measured candidate in this version. No package files have yet been
measured by this reader slice. All wider certifications are always false.

## Evidence and review

Canonical `.local/r20-inventory-envelope-oct30/` contains15 evidence files;
receipt SHA-256:
`9c103aad6c103e87935336be80e61963565e15ad829e52476d93ae58c3f5e7a3`.
The initial missing-module scaffold failure is preserved and is not described as
a behavioral assertion failure. Later behavior REDs are retained for lookup
contradictions, scope substitution, harness case-alias placement, unsupported
dispositions and manifest-as-JSON selection. All were diagnosed before rerunning.

Final author and canonical integration commands passed33/33 focused tests:
17 inventory and16 graph, zero skips, under the explicit pinned Windows ARM64
Node24.22.0 executable:

`node --test server/testing/production/application-root-inventory.regression.mjs server/testing/production/application-root-graph.regression.mjs`

Raw canonical result is `canonical-integration-green.log` and exit0 is recorded
in `canonical-integration.exit`. These are synthetic declaration fixtures. No
actual selected package or application output was imported, no resolver was
called, and no browser/database/service/provider was used. The prior actual graph
compatibility evidence belongs to the graph helper; this reader has no new real
installed inventory/observation acceptance.

Independent reviews were read-only and separate from the author:

- `r20_graph_types_review`, Astra High, JavaScript/TypeScript reviewer: identified
  lookup/scope contradictions and the manifest dual-use case, then approved the
  exact final hashes after17/17 pinned24.22.0 inventory tests.
- `r20_graph_final_review`, Astra High, general code reviewer/final assessment:
  also identified the case-alias exclusion and reviewed all corrections. Final
  exact-hash approval followed33/33 pinned24.22.0 tests. An older final citing
  superseded hashes was explicitly superseded by the matching final review; it
  was not used for acceptance.

Sol's earlier usage-limit failures remain recorded; these reviews are not labeled
Sol reviews. No integration approval extends to the unreviewed R18 chain.

## Next bounded implementation

Implement the inert candidate collector and native literal-ESM resolution
observer in separate new application modules, with exact harness/runtime pins
and the accepted clean environment. Start with poisoned-output fixtures proving
resolution without evaluation and distinct physical parents selecting different
installations. Then add default conditions, exports failures, full lookup
footprint, descriptor/metadata before-after checks, replacement/shadowing failures,
deadline and cleanup evidence. The observer must reject incomplete footprints
and must not turn a candidate's self-hash into independent acceptance.

The reader's positive-size bound may need reviewed extension if actual package
targets are empty. Preserve unsupported results as explicit blockers instead of
silently dropping them. Do not add stage consumers, transfer old brands, weaken
required-job refusal or evaluate the application in this work. Native PostgreSQL
TLS, application Redis/job capability, full protected HTTPS/persistence journeys
and all101 canonical groups remain OPEN. No owned runtime remains.
