# Application file measurement window

30 October 2026. Accepted scope: bounded before/after Windows file measurement
for the forthcoming application collector/observer. This is not a complete
resolver, continuous custody, application stage or execution acceptance.
Governing records remain the master specification v2.6 and application inventory
architecture decision. `APPLICATION-OBSERVATION-FOOTPRINT.md` records the Astra
follow-up, including the narrow OS metadata executable exception.

## Ownership and exact source

Parent authored only two new files under `server/testing/production/` in
`C:\Users\USER\.codex\worktrees\capital-r20-file-observation\personal-finance-app`,
branch `codex/r20-file-observation`, base
`ef99071b3b14dd4f0f8381fd773651248f6f7300`:

| File | SHA-256 |
| --- | --- |
| `application-file-window.mjs` | `b630efc32f54a19443de8727f758ae6a9540b6ec51c627e08079cd6742734f14` |
| `application-file-window.regression.mjs` | `c6681e9c5fda49145c4cb72464d727af09724fcb1ae4d2e6d0069da834cc91d5` |

The coordinator copied these exact reviewed bytes into canonical and verified
hash parity. Existing generic metadata helper, graph/inventory readers, emitter,
component brands, loaders and startup were not modified. Author files remain in
the isolated checkout. Final source-freeze SHA-256:
`9383c0f6db495a90c112223abf677ff2353dbc8e28a72acf3c958eea65fd175e`.

## Implementation

`openApplicationFileWindow` accepts canonical serialized requests and a separate
expected request hash. It checks approved roots, pinned files, complete supplied
directory listings and immediate-parent absence probes. It retains read-only
descriptors, checks their identity against the paths, hashes through those
descriptors, and measures Windows metadata. Selected files require exact realpath,
regular-file identity and one hardlink; ancestor identities and reparse controls
are checked. Requests are bounded by512 selected files,4096 lookup paths/probes,
256MiB measured bytes and a deadline up to60seconds.

The window record is private transient lineage. Clones cannot finish it.
`finishApplicationFileWindow` rechecks bytes, descriptor/path/ancestor identities,
metadata, listings and absences, including a path check after final descriptor
reads. It closes all retained descriptors before returning a result.
`closeApplicationFileWindow` abandons a genuine window and is idempotent after
successful consumption. Timer expiry automatically closes handles even when the
caller never finishes. Cleanup failures refuse success and all closes are attempted.

The application-local metadata script contains only literal `Get-Item` metadata
operations; paths arrive as bounded JSON on stdin, never shell interpolation.
The hidden subprocess receives only SystemRoot, a timeout capped by remaining
window budget and an AbortSignal. Deadline/explicit close aborts it, and its
pending operation waits for the child close event before settling. Stdin errors
remain errors even if a later callback otherwise reports success. The shared
metadata helper remains unchanged.

The OS-tool exception is fixed to
`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`. Caller pins include
canonical path, size, SHA-256, device and inode, with exactly two hardlinks required
by this host-specific reviewed exception. All other measured files retain the
one-link rule. SystemRoot must resolve to exact `C:\Windows`; arbitrary executable
trees cannot inherit the exception. Actual captured OS-tool evidence is
`os-metadata-tool-pin.json`: size582656, SHA-256
`6a5b945e4c27a4eb819988018d219a48ff9bb1bcbdadc56a45539ff26875c617`,
device2651408473, inode2814749771427265, link count2. These values are evidence for
this host/window, not permission to ignore a future changed tool.

The helper supports zero-byte measured data files, although the current inventory
reader still has a positive-size restriction. It does not enumerate or certify
the completeness of a package lookup footprint. That remains the collector and
observer's obligation. All result custody/runtime-module-identity/execution
certifications are false. No file is imported or executed by measurement.

## Native tests, failures and review

Canonical `.local/r20-file-observation-oct30/` contains17 evidence files. Receipt
SHA-256: `726624c1025d5926114c6c316ff809d85197215a7af4b1d74bdfd11dd239fe49`.

Initial8 then10 tests passed, but independent review exposed an actual opening
deadline defect: the timer originally started only after metadata completed.
The reviewer measured two descriptors still open at157.4ms under a50ms deadline,
with cleanup arriving at865.7ms. A preserved behavioral regression reproduced
zero early closes versus expected two. The corrected implementation arms expiry
before opening and cancels the metadata subprocess. This failed evidence remains
in `window-review-red.log` and the review record; it was not rerun unchanged.

A separate final-read ancestor replacement scenario already refused before the
extra final path check. It is a retained negative control and a strengthened
invariant, not a claimed reproduced prior acceptance bug. The later explicit
OS identity pin schema also has a preserved positive-contract RED before support
was added. Successful tests are not relabeled as failures.

Final author and canonical integration each pass14/14 tests, no skips, using the
explicit pinned Windows ARM64 Node24.22.0 executable:

`node --test server/testing/production/application-file-window.regression.mjs`

Canonical raw result is `canonical-integration.log` plus exit0. Tests exercise
poisoned selected source without evaluation, raw pin/byte drift, identical-byte
replacement, shadowing/absence changes, hardlinks, cloned/consumed records,
explicit cancellation, automatic expiry, incomplete opening expiry, failed close,
parent replacement during final reads, cancellation during completion and wrong
OS executable identity. These are actual Windows metadata/descriptor checks over
owned synthetic files; they are not full application, native-addon, database,
provider, persistence or production evidence.

Independent review provenance:

- `r20_graph_types_review`, Astra High JavaScript/TypeScript reviewer, static only:
  identified deadline and final-path concerns; final exact-hash review found no
  outstanding actionable issues, including the supplied OS device/inode pins.
- `r20_graph_final_review`, Astra High general/final reviewer: independently
  reproduced the deadline defect; verified13/13 before the final identity-schema
  addition, then independently verified the two changed positive/refusal controls
  at the exact final hashes on pinned24.22.0. Final verdict approves this helper
  only. Its native test slots were explicitly released before parent runs.

The foreign Smartcare Vitest process33812 was confirmed live before native work;
source preparation continued until it was observed absent. Native verification
was serialized. Canonical integration finished exit0; no owned metadata child or
fixture directory remains. R09 was freshly polled unchanged terminal on revoked
network permission. No shared target or external service was used.

## Next task and remaining gates

Implement the bounded package lookup-footprint collector, then the native
literal-ESM resolver transport/observer, using the accepted detailed follow-up.
Preserve self-reference, nearer manifest-less package directories, conditional
property ordering, nested scopes and higher-priority absence probes. Missing/
directory URLs and typeless JavaScript require explicit diagnostics; they must
not become successful observed files or invented CommonJS format.

Only after independent candidate pinning and complete-footprint preflight may
the observer combine native resolution with this measurement window. Its result
still cannot authorize stage, custody or selected execution. Full profile,
Redis/job capability, native PostgreSQL TLS, protected HTTPS/persistence journeys,
R18 reviews, release gates and all101 canonical groups remain OPEN.
