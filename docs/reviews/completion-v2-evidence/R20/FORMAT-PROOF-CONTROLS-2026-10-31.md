# R20 format proof: focused continuation evidence

31 October 2026. Local preparation only; independent review and canonical source
integration remain pending. The isolated author checkout is
`C:\Users\USER\.codex\worktrees\capital-r20-format-proof\personal-finance-app`,
branch `codex/r20-format-proof`, starting WIP revision
`b846ea83e32a29c10de4ca2a094ca759e1543d26`.

## Metadata timing and joined recovery

The earlier five-pass/two-fail format run and the corrected diagnostic's metadata
timeout are preserved. A further instrumented diagnostic, with the same 5000 ms
metadata timeout, completed both metadata children normally in1816.7529 and
856.0806 ms. Each emitted15557 bytes, exited0 and closed normally. This establishes
intermittent behavior, not its underlying cause. No timeout or production source
was changed. Diagnostic log at
`.local/r20-format-proof/collection-diagnostic-b846ea83/result-timing.log`:
SHA256 `7280e1ffa7f01debeee525aef2ec90ac59f6ecd0e0fee7b7402cb6fc9d66f804`.

With timely metadata completion observed, only the two failed joined checks were
retried uninstrumented. Both passed, exit0,47454.6234 ms, zero skipped; all seven
source pins unchanged. Session6709 was polled to terminal. The opt-in fixture made
two actual native passes, retained three tuples/six rows, proved three selected
CommonJS outcomes and kept all authority flags false. The old profile retained
three ambiguous-format blockers and its version1 payload. The other five passing
checks were not rerun.

Packet: `.local/r20-format-proof/joined-after-timing-b846ea83/` with pre.json,
test.log and result.json. Log SHA256:
`ca0a4cb9eed1519a658315f37dcd6ea75568902ada749d4230b99e256cd815e0`.
This is synthetic joined evidence, not a fresh installed41-tuple observation.

## Added source-integrity controls

Only regression tests were added; the four production implementation files remain
byte-identical to the preserved WIP revision. The first new focused run passed
three integrity tests and failed a fourth test because its hashbang expectation
was incorrect. Preserve that failure as test-author error, not a product fix:

- Selected source hash, size, dev/ino mismatch, oversized pin, same-size byte
  replacement and hardlink refuse instead of becoming syntax diagnostics.
- A selected target without an authorized syntax pin receives no proof; another
  tuple's pin cannot be substituted.
- After a real successful child response, corrupting method, source, hash,
  dev/ino, status/reason, extra fields or runtime invocation is refused. Each
  injected case asserts the successful child was reached and closed.

Packet `.local/r20-format-proof/integrity-controls-oct31a/`, exit1,3pass/1fail,
zero skipped, source pins unchanged. Log SHA256:
`4c67e182f3f2eb94f825c1c9c975a54ca727449004046ef32bb3e010b49a8132`.

Pinned Node accepts a hashbang at byte offset zero. The BOM-plus-hashbang case
remains unproven when its exact decoded text is preserved. The test was corrected
to assert those distinct outcomes, which also detects accidental BOM stripping.
Only that corrected test was rerun:1pass/0fail, exit0,2922.8693 ms, zero skipped,
source pins unchanged. No production change was necessary.

Packet `.local/r20-format-proof/hashbang-corrected-oct31a/`. Log SHA256:
`c9a2152bf762acb434b0cec1b917466de7d88957a94839e76da0866f8786e660`.

## Scope journey and preservation

The new joined scope journey passed1/1, exit0,19959.4104 ms, zero skipped,
source pins unchanged. It exercised two real native passes across explicit
module/commonjs types, an unknown string type, a nested typeless boundary and
unproven ESM syntax. Explicit types retained precedence, the unknown type stayed
blocked despite successful raw compilation, and the nested absent-type scope
could receive CommonJS proof. Side-effect canaries remained absent and all
authority flags remained false.

Packet `.local/r20-format-proof/scope-controls-oct31a/`. Log SHA256:
`b5ba6d1935e765d10a4dbacff41b6914a9cc0633fe3a0798ea8eb1e0ac4fbdc5`.

The two regression-file additions are preserved as local WIP commit
`65851509549891a9d9de3ad262f79e9c7548c5f6`; isolated checkout clean. Preservation
does not mean acceptance. Successful controls span separate focused runs; there
was no new complete-suite run. The failed runs remain in their original packets.

## Remaining gate

The full accepted decision's control catalogue remains the integration gate.
Additional opt-in lifetime, drift and boundary evidence is recorded below, but
the positive no-manifest branch is not reached by the current collector. Existing
old-profile controls cannot silently certify new-profile paths. Astra independent
review remains quota-held; no review
approval, canonical source integration, fresh installed observation, package
execution, database change or release is claimed.

## Further lifetime, drift and boundary controls

Five further controls now have passing focused evidence on production source
unchanged from b846ea83. The isolated regression additions are preserved in WIP
`b2ec05f8c20b87a6b2deb6982df969abcc520b3d`, clean after commit. No independent
review or full-suite claim follows.

The existing phase/lifetime tests are registered for both profiles. The new
profile's open/native/postcheck failures released every retained descriptor;
native failures awaited actual child close. Injecting final-close failure after
two actual native children prevented observation lineage and left no descriptor
open. These two tests passed in `.local/r20-format-proof/lifetime-boundary-oct31a/`.
That run also had two failures, total2pass/2fail, exit1,65591.4803 ms, no skips:

- The no-manifest test incorrectly expected collection success. Source inspection
  confirmed existing collector behavior explicitly reports
  NEARER_PACKAGE_WITHOUT_MANIFEST. The positive no-manifest branch is not reached
  by this collector; its positive proof must not be claimed from this control.
- The drift test failed during collection, before both fault cases completed.
  The silent runner did not identify the internal cause. Do not label it as a
  proven metadata timeout merely because earlier diagnostics showed one.

Log SHA256 `13e7e495ec50d20150cbb82befebe850f0b4c33303da89488ab5107e74efe572`.

The drift test now collects in the same reflected-host realm already required for
fault interposition. It records child timing on failure without changing process
arguments, environment, timeouts or production source. It passed both source and
scope changes injected after the first actual native child closed: exactly one
native child, intended mutation reached, refusal and zero retained descriptors.
This is same-realm fault evidence; the earlier clean runner tests supply the
separate process/argv evidence.

Packet `.local/r20-format-proof/boundary-drift-diagnostic-oct31b/`:1pass/1fail,
exit1,43888.0179 ms. The remaining failure was another test-author error: an
assertion inspected the first unrelated graph blocker rather than the matching
manifest-free package blocker. Source pins stayed unchanged; log SHA256
`89b736528a41ac496d9d6bac32f3540a79f6e153eb6f78626cc19e7deb536d61`.

After correcting that assertion, the manifest-free control passed with an
incomplete footprint and zero native passes. A new non-string-type control also
passed: actual native processing must occur, and only a specific invalid-package
refusal or an ambiguous-format blocked outcome is allowed; it cannot become a
usable CommonJS result. Packet
`.local/r20-format-proof/boundary-nonstring-oct31c/`:2pass/0fail, exit0,
30430.7397 ms, zero skips, source pins unchanged. Log SHA256
`e6df39ab2427e000dba0b7fb0d403955a709dfffd0b8b04193a41d7743a9af82`.

Earlier failures remain intact. The full accepted decision still needs independent
adjudication, including the unreachable positive no-manifest path, remaining
protocol/physical-boundary controls and production metadata reliability. No
timeout cap was raised. No installed graph was reclassified or executed.

## Complete native transport regression file

At clean author HEADb2ec05f8, the coordinator ran the complete native transport
regression file to cover existing callers alongside the new version2 protocol:

`node --test --test-concurrency=1 server/testing/production/application-native-resolution.regression.mjs`

Pinned Node24.22.0:18pass/0fail, exit0,82210.0528 ms, zero skipped; all source
pins unchanged. Session83438 was polled to terminal. Packet
`.local/r20-format-proof/native-compatibility-b2ec05f8/` contains pre.json,
test.log and result.json. Log SHA256:
`af58690216a59cfa79601c4ad81b2d313437cdd78277b7c037642a7a22c7cfaf`.

This proves the full native transport file at that candidate. It does not certify
the complete observer suite, application runtime, installed dependency graph,
independent review or canonical integration.

## Five physical parents and current review, 31 October 2026

WIP `31220acd2020c6c98a668bbc45412e65bd752ac5` adds only 72 lines to the
observation regression file. Its first focused attempt passed both profiles,
2/2 tests, zero skips/retries, 19820.9376 ms Node duration. Each profile checks
five distinct physical parent identities, one package-import kind, a shared
selected file identity, five rows per actual native pass, complete census and
alternatives, false authority flags and an inert canary. New profile outcomes
are five usable; old profile outcomes remain five ambiguous without syntaxProof.
The existing unsupported-require blocker remains. Four production helpers are
unchanged from the prior reviewed design implementation.

Author packet: `.local/r20-format-proof/five-parent-oct31a/` in the isolated
format-proof checkout. Log SHA256:
`230a59d1e14b793920937fc687755f8155bbc100da5bb1bc3df08d985aacbf8f`.
Independent Sol JavaScript review verified the raw log/runtime/source pins,
physical-parent assertions and compatibility controls, finding no actionable
defect in the bounded delta. It performed no execution. Astra High final full
candidate and control-catalogue review is now active; its earlier quota hold
is superseded. Source integration and installed reuse remain pending.

Coordinator prepared a separate, unexecuted driver at canonical
`.local/r20-application-installed-oct31b/prepare-installed-collection.mjs`.
It copies the previously reviewed driver and changes exactly one profile literal
to `native-default-esm-cjs-proof-v2`; SHA256
`849ea8916a13f598f09443835d221e2f86a2dc6b9352f272d37541fb512dc341`.
Its own review is pending. No fresh request, collection or observation is issued.

Read-only parity at 14:02:54 UTC matched all 488 prior unique source pins,
23 output pins, 12 build-tool/configuration pins and the graph raw hash. Receipt:
canonical `.local/r20-application-installed-oct31b/emission-parity.json`.
This supports retaining attribution to build revision `08b4eefe` if future
preparation/collection revalidation passes; it is not a new build, retained-window
identity proof or installed observation. Old candidates and their blockers remain.

## Astra final adjudication: source clear, required controls incomplete

Astra High reviewed clean `31220acd` against `aa62784c` and found no actionable
production implementation defect. Integration and fresh installed reuse remain
held for one HIGH acceptance-evidence finding, not a demonstrated product failure:

- Existing `timeout:1` marks its phase reached on launch. It proves launch,
  refusal, actual close and cleanup, but not timeout after child work begins.
  Add an explicitly labelled synthetic work-phase stall with a phase handshake;
  keep genuine compilation controls separate and do not interpose the compiler.
- Malformed v2 responses need joined-observer retained-window cleanup evidence;
  premature-pipe failure also needs the opt-in path. Assert no lineage, actual
  child termination and zero retained descriptors.
- Exercise missing/directory/unsupported selections and out-of-root, case-alias,
  symlink/reparse boundaries under the opt-in profile using existing bounded
  fixtures. Old-profile evidence does not automatically cover the new branch.

Astra accepts current conservative no-manifest refusal as the bounded behavior:
the collector stops at NEARER_PACKAGE_WITHOUT_MANIFEST, with incomplete footprint
and zero native passes. Positive no-manifest support remains explicitly deferred
and unverified; do not widen the collector or count the unused helper branch as
covered. Whole-campaign acceptance is unchanged.

The existing author lane owns only the two regression files and a fresh ignored
`lifetime-gaps-oct31a` packet for the missing controls. Native execution awaits
an exact focused selection from the author; no production-helper change, raised
limit, database/browser action or new source lane is granted.

Astra separately source-approved the one-literal installed-driver change, after
matching both hashes. Language review is pending. Driver execution, request freeze,
collection and observation remain unallocated until candidate acceptance.

Independent Sol JavaScript review subsequently cleared that exact driver delta,
matching both hashes and verifying the intended candidate reader accepts the new
profile. Canonical's current reader still accepts only the old profile, so running
the new driver now would correctly refuse. Required order is candidate acceptance,
canonical integration, check/pin refresh, then driver preparation. Do not repoint
imports to the author checkout or weaken validation to bypass that prerequisite.

## Missing controls passed and bounded source integrated

The existing author preserved the seven additional controls at clean WIP
`181a84f8afa4f4c699133a187cd84d10abd41e0b`: 124 lines in the observation regression
only, SHA256 `9c5d19a06027d1766d9e0eb645a481c49f3e0dede09978b2bc6188f6168e66f6`.
First attempt passed 7/7, no skips/failures, 90495.1422 ms. Raw packet is
`.local/r20-format-proof/lifetime-gaps-oct31a/` in the author checkout; log SHA256
`ad59e1357c1ea354573dd0ec196f8ecd63fe33fc075fabc4282c60edbf0143d8`.
All 33 traced children closed and were absent after the run.

The synthetic stall acknowledged complete request bytes/hash before blocking;
the unchanged remaining timeout of 57221 ms killed it. This proves synthetic
teardown, not interruption during actual compilation. The malformed-response
case preserved genuine fixed-child v2 output with three proofs before corrupting
transport. Joined malformed/pipe failures refused with actual close and no
retained descriptors. Missing/directory/unsupported selections stayed unproved;
out-of-root candidate admission, physical case alias and an actual junction
refused before native work. Junction cleanup unlinked the verified fixture link.

Sol JavaScript review cleared the exact frozen hash. Astra independently matched
the committed source and raw evidence, resolved its prior HIGH finding and
approved bounded local integration, retaining the no-manifest deferral and fresh
installed gates. No production helper or timeout changed during this repair.

Canonical merge `11401fc894296b928eda563c4dd0b72a31a2f068` integrated exactly the
seven reviewed source/test paths. All seven hashes match the author. Fresh pinned
Node 24.22.0 `npm run check` passed, exit zero, with unchanged pins; log SHA256
`7efbb93aba29f7bb9a9f923e49a8d1fb6f5e5bdbfb55c2f1d4727cc2aecd0667`.
Integration and check receipts are `.local/r20-format-proof-integration-oct31a/`.

The approved preparation driver then ran successfully against canonical source,
retaining emission attribution to `08b4eefe`. A coordinator argument-index error
before launch was diagnosed and preserved in prepare-prelaunch-error.json; no
Node ran for that failed preflight. The corrected launch locates unique flags.
Fresh request SHA256 `521e85a1d48dcf097160d7720beb4b419e4627e75204d1c78ef6a196e018def2`,
frame SHA256 `a3c1b93ce6ab6a16f5e768ddf7385485877d1849efa2700a5fdca91b1e1e2814`,
candidate ID `f2f5d9e3-2cba-496d-a711-ccfda430e2a4`; full census remains 23 members,
493 mappings, 106 edges, 395 occurrences, 41 package selections and 82 required
native rows. Independent request freeze is underway before collection. No fresh
installed outcome or application execution is claimed by this preparation.
