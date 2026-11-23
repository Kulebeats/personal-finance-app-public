# R20 staged runtime boundary acceptance

Status: parent accepts the bounded local source and inert native checkpoint.
This is not a production-profile launch or runtime identity grant.
Plan: `docs/plans/2026-10-28-r20-staged-runtime-boundary.md`.

## Candidate and source review

Baseline was `6c70dda7084bf36576fbb758a259e7841deb7354`. Inventory author candidates
`b734e344fb4d1a3e5672afbdc95a6e3ebeeb1c00` and
`dea747b185ece217ca69cbf0e6c5d47f8c67b746` are integrated as `b8d1941` and
`b6dc664d9d482fbacbf1fecc76faa3b39580f2bf`. Both author snapshots passed the pinned
Node `npm run check`; final inventory pure/fake tests passed 47/47. Independent
JavaScript review reran those 47 and the enforcement lane's 33 stage/boundary
tests, all passing. Those were separate lane runs. Enforcement candidate
`406e1e62d4c415b8d23736b8b0f22043aa4d9459` was then integrated as
`4a0338b53deec8d3e23cd29a41c71c48ca87654a` after independent general, JavaScript
and C# source reviews. Canonical verification on that source passed **254/254**
focused tests, zero failures/skips, 741.4227 ms, and `npm run check` exited zero.
Logs are `.local/r20-staged-boundary-oct28/canonical-focused.log` and
`canonical-check.log`. No application source changed, so unchanged DB/browser
suites were not repeated or relabelled as newly verified.

Meaningful behavioral failures were preserved and repaired: raw BOM bytes could
match BOM-free inventory pins; unrelated directory activity invalidated capture;
and nested scoped enumeration could do excessive work before refusal. Initial
missing-API failures are interface reds, not behavioral proof. Review also found
and repaired scoped package path rejection, key-order-sensitive equality of
otherwise identical source pins and an incomplete fixed fixture lockfile. The
exact fixture now has a fake-I/O collector-to-independent-expected-tree-to-reader-
to-stage-to-protocol positive control.

Native supervisor source received independent C# review. A suspended-create then
later-assign interval was replaced with creation-time job assignment and a
membership check before resume. Current reviewed supervisor source SHA-256 is
`8dc6e651b2e26b0635f64b514f23768d16f660b2ae3e57cdca13f679d289f814`.
The reviewer independently reversed the three final pin changes and recovered
the prior accepted source hash, confirming no other native logic delta.
Source approval preceded the native run documented below. Canonical supervisor
bytes use CRLF and have raw SHA-256
`4f00f9fa1b43e6d27d2eee9c958503811b188090966ef02fcf44948347260645`;
independent review normalized them back to the accepted author hash and confirmed
the same Git source. The external dispatch pins the actual canonical bytes.

Two staged harness source files use explicitly scoped LF Git attributes so their
raw bytes survive checkout with `core.autocrlf=true`. Other source hashes must be
recorded from the actual canonical checkout; Git text parity is not raw-byte
identity. The parent-owned actual-negative helper and narrow attributes received
independent JavaScript review.

## Actual installed candidate early refusal

Parent ran the fixed read-only helper on canonical
`b6dc664d9d482fbacbf1fecc76faa3b39580f2bf`, using the physical Node 24.22.0 ARM64
executable. Exit code was zero and stderr empty. Evidence:

- `.local/r20-staged-boundary-oct28/actual-negative.mjs`, SHA-256
  `1512540ba87beb8062353cfaedfb8807c11d2479a0a47b5bcca90538b0e80983`.
- `.local/r20-staged-boundary-oct28/actual-negative.stdout.log` and
  `.local/r20-staged-boundary-oct28/actual-negative.stderr.log`.
- Canonical collector raw SHA-256
  `b2c0a275616bbd853240bf9135e3f8801f10ded2591b655cf763e1d83bc779d6`.
- Original reviewed installed allocation SHA-256
  `c4c9a51e1dfb1c2e2dd6f987aca664df48904bc7e16783a43002d3889628a23e`.

The real collection API returned `status:blocked` with exactly:

1. `esm-require-bridge`, `require-call:posthog-node`.
2. `missing-root`, `$root:posthog-node`.

`packageByteCaptureStarted` was false. The helper does not import a staging or
launch API, and this early path performs root existence checks without package
payload reads, metadata children or selected-module evaluation. This is early
negative evidence, not a complete installed inventory or proof about the later
native/data requirements. Closure, custody, runtime identity and execution
certifications all remain false.

## Native allocation and trust boundary

Run token is `r20stage20261028a1`. The root was verified absent before allocation:
`.local/r20-stage-native-oct28a`, with fixed source/build and five distinct case
stages: normal, timeout, supervisor-loss, preexisting-writer and unknown-member.
External TEMP is `.local/r20-staged-boundary-oct28/native-temp` and must exist
before fixture allocation/metadata. Root reuse after a failed allocation is not
permitted. A single reviewed suite may exercise its separately allocated cases.

Node is the physical ARM64 24.22.0 executable, 82,123,080 bytes, SHA-256
`df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0`.
Parent independently observed `C:/Program Files/PowerShell/7/pwsh.exe`, 278,824
bytes, SHA-256 `abb215e4d87889c85a18333a310b1dbdae33e78a25e13dc7cf129fbdaea848e0`,
PowerShell 7.6.6 / .NET 10.0.12 / ARM64. Windows/.NET/PowerShell platform assemblies
are an explicit trusted base, not independently completed package DLL closure.

The initial stage implementation is restricted to trusted owned fixture paths.
It is not a general safe-write boundary against hostile same-identity directory
replacement. Native sharing tests concern the later retained-handle boundary.
Attributes and directory membership are not frozen by share denial; the child
hook does not create a hostile-code sandbox. Real package addons/DLLs, opaque data,
arbitrary workers/children and the full application remain unsupported.

## Reviewed dispatch and native result

The parent independently constructed the dispatch after source review and ran
only pure preparation/manifest/tree/protocol validation before allocation. A
separate reviewer rehashed all 17 owned sources, Node, PowerShell, the outer
launcher and both declaration artifacts, then cleared only this inert suite.
The external TEMP was created before the driver; no fixed fixture root was reused.

| Artifact in `.local/r20-staged-boundary-oct28/` | SHA-256 |
| --- | --- |
| `prepare-native.mjs` | `a7ff8c2a4d1335ae4f22cf158b04bca3c7780b667d9c8ce28a46a9ed1da58dbc` |
| `run-native.mjs` | `d0fb23ef0200d9e3c2ccc2b1db6674871ccdfac789da7e708e4f9024192b12da` |
| `outer-launch.ps1` | `89af89258ec3490f0c3000dc465b7b7bac489ccf922cdd0ec826cee7d140e9cd` |
| `native-dispatch.json` | `3665e69a89678d8a01a7a5088e85d37f192262cd7b42c058d1e43cb91db7dfeb` |
| `native-expected-declaration.json` | `5c3f2a09bd8bd85c4f74ee6b76b98f3a0a9b714e0c37ee47accf946e68b70779` |
| `native-suite.stdout.log` | `3f564f73dc7447ae80a60fec869314aa4658361a97c5b37e3e937456dfcf6ab8` |

The independently reviewed outer controller completed with exit zero,
`Passed:true`, eight reported owned processes and **28.863 seconds** elapsed.
`native-parent-readback.json` explicitly records its origin as the parent's
capture of exec session 7005 output and subsequent process audit; it is not a
separately generated native attestation. `native-suite.stderr.log` is empty.
The first native attempt passed all five cases:

| Case | Observed result |
| --- | --- |
| Normal | Real ESM/CJS/createRequire/conditional/dynamic/JSON fixture completed. While it was running, byte-write, deletion, file rename and stage-directory rename attempts each returned Node's `EBUSY`. |
| Timeout | Entry-start event preceded the fixed timeout; child termination and released access were observed. |
| Supervisor loss | Parent killed the owned supervisor after entry start; child exit and released access were observed. |
| Pre-existing writer | Native sharing-violation check refused the held writer before child creation. |
| Unknown member | Exact stage membership check refused the extra inert file before child creation. |

Every case recorded drained output and zero cleanup issues. After child death
(or prelaunch refusal), owned same-byte writes and file rename/restore controls
succeeded. Parent and independent reviewer found all eight recorded processes
absent. The reviewer independently rehashed all 17 sources and runtime/controller
pins after execution, plus **71 retained pinned materialized/staged files**; all
matched. The sole additional staged member is the intentional unknown-member
control. The allocated root is preserved as evidence and is **not reusable**.

This was a real filesystem collector-to-expected-byte comparison-to-reader-to-
five-stages/protocols execution, without fake I/O. The synthetic package superset
contains one package, two root edges and five package files totalling 266 bytes;
it is not the estimated 245 MB installed application tree. Its synthetic metafile
declaration is not a new esbuild/provenance claim. The staged entry executes only
reviewed inert fixture code, never application or installed dependency modules.

The unknown-member case proves prelaunch membership refusal, not an attempted
unknown-module import. The native suite did not exercise late shadow insertion,
hook replacement, worker/child/addon/data capabilities, attribute mutation,
outer-watchdog failure paths, or independently timed continuous lock retention at
every instant of supervisor death. Node `EBUSY` controls expose libuv-translated
errors; the pre-existing-writer case separately checked native error 32. Source
review and pure/fake tests remain distinct from these native observations.

Independent final evidence review accepted this bounded result without a new
source finding or required rerun. Actual-profile closure, custody, runtime identity
and execution authority remain unearned. Next work is disposition of the actual
missing/require root, native Sharp/libvips and computed-data loading, then general
installed staging/custody and the remaining full-profile service/TLS/egress/secret
and mail/browser integration. None of those requirements is waived by this suite.

Broader R02/J01/G1, all 101 canonical groups, full-profile service/TLS/egress/mail
acceptance and release remain open. No push, main merge or deployment accompanies
this checkpoint.
