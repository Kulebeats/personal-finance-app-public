# R20 native root resolution: parent evidence

## Bounded claim and review

This milestone observes declared root ESM resolutions and selected file bytes.
It does not establish the transitive load graph, continuous custody, native DLL
identity or application execution authority. CJS and nonliteral gaps remain
explicit. No application or selected dependency module is evaluated by this work.

Author source candidate `e4287aee48d409b0994e218ab458edfc8d204a83` received
independent general/security and separate JavaScript/async/security acceptance.
Parent read the implementation, fixture lifecycle and evidence before integrating
as `f55ff1ac481c9db7323645ba8f26a539d8a60345`. Parent's separate reviewed tag-test
repair produced `ac915c5576b11b1e5309b7300828d1e265364146`.

Review found and repaired case-folded path equivalence, stdin timeout/decode
handling, descriptor-close iteration and an understated resolver-call bound.
The final bound is 128 distinct roots / 256 resolver calls including recheck.
Both reviewers accepted frozen source. Canonical checkout changes line endings
only: Git source and normalized text match the author. Independent review also
attested canonical byte pins and the first synthetic allocation.

Parent independently reran the canonical pure/fake suite: **77 passed, zero
skips, exit 0**. Log: `.local/r20-installed-resolution-oct28/pure-integrated.log`.
These tests do not establish actual file resolution or native metadata behavior.

## Native fixture attempt and physical runtime correction

First allocation SHA256:
`057098db4d350382813422e10b7d6c4bbf14701edf0544bb996ac9db70e13308`.
Parent verified its eleven harness files, Node size/hash, fixed synthetic class,
root absence and ancestry immediately before dispatch. Parent supplied only
SystemRoot/TZ/TEMP/TMP (the later diagnostic identified Windows' additional ARM64
key in the effective environment), the sole experimental import-meta-resolve flag, a bounded
stdin record and a two-minute owned-process deadline.

The first attempt exited 1 after 134 ms with static refusal and no fixture root
created. Preserve `native-fixture.stdout.log` and `native-fixture.stderr.log`
under `.local/r20-installed-resolution-oct28/`. Read-only diagnosis found the
configured Node path is redirected by the Windows application environment:

- Logical: `C:/Users/USER/AppData/Local/capital-r00-runtime/node-v24.22.0-win-arm64/node.exe`.
- Native physical: `C:/Users/USER/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/capital-r00-runtime/node-v24.22.0-win-arm64/node.exe`.

All other harness ancestor spellings and the three fixture digests matched.
That alias independently violates the exact native-path check. The static first
refusal does not identify which preflight condition failed; the later diagnostic
also found the earlier environment-shape check incompatible with Windows. A narrow
reviewed protocol correction pinned the physical executable; the no-alias rule
was not relaxed. Both paths identify the expected 82,123,080-byte Node 24.22.0 ARM64 image,
SHA256 `df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0`.
Physical correction `cd61d0` was independently reviewed and integrated as
`645dbb2`; canonical pure/fake checks passed 79/79. The second native attempt,
allocation `e75092cf1b88f013b7b683c6c797939c75e0b88128e49c7e02028dfde0d6d46c`,
refused after 232 ms with no fixture root. A separate closed-process diagnostic
showed Windows adds `PROCESSOR_ARCHITECTURE=ARM64` to the four supplied variables.
The reviewed correction `5d81cf7`, integrated as `c2223ee`, requires exactly that
five-key effective environment, including matching process architecture, while
rejecting missing/wrong/extra values. Canonical pure/fake checks passed 84/84.

Third allocation
`1ba358ee8595da55e9c93740d576d8b87c474f9a54000bf596d3bc4943971bc2` refused after
923 ms. The old root contained only an empty `temp` directory. Parent's first
interpretation of completed cleanup was incorrect and was corrected by explicit
directory readback. This layout plus the preflight sequence and the existing
`R19/NATIVE-PG-TLS.md` precedent supports an inference of preallocation TEMP
materialization; the static error does not uniquely attest its phase. Preserve
that root and all three failed logs; do not reuse or adopt it.

Reviewed author correction `a772e6b`, integrated as
`e7da0c4a4f591deb6c1534c558821739d1775be0`, fixes TEMP to the separately owned
existing `.local/r20-installed-resolution-oct28/native-temp` for the entire
process. Preflight checks its ancestry and both fresh-root absence boundaries.
No environment mutation, arbitrary path override, alias relaxation or old-root
deletion occurs. Canonical pure/fake suite: **90/90, zero skips, exit 0** in
`pure-external-temp.log`.

## Successful native fixture

Fresh run `r20res20261028b1`, root `.local/r20-runtime-resolution-oct28b`, passed
exit 0 in **5.376 seconds** on `e7da0c4`. Allocation SHA256:
`9a379defa82b7f0a5db510e3235ad789a4bc4b9abf4e623a5dd2593617ce7998`.
Logs: `native-b1.stdout.log` and empty `native-b1.stderr.log` under the same
parent evidence directory. Parent freshly checked runtime/source pins and root
absence before launch. The eleven-file allocation pins canonical CRLF bytes;
Git source and normalized text match the independently reviewed author.

Three native positives verify different entry parents, ESM import condition and
nearer package shadow resolution with selected-byte readback. Two negatives reject
the wrong require target and wrong outer shadow target. Evaluation markers remain
untouched. The optional case-distinct filesystem control is **unsupported**, not
passed, on this directory; no system setting was toggled. Fake case-distinct
regressions remain a separate evidence class. Owned fixture cleanup succeeded;
parent confirmed the new root is empty and retained as nonreusable. The old root
still contains only its preserved empty `temp` directory. All four closure/
custody/runtime-identity/execution flags remain false.

## Actual build and installed observation preparation

Parent prepared two local operational helpers under
`.local/r20-installed-resolution-oct28/`, separately reviewed by both reviewers:

| Helper | Accepted SHA256 |
|---|---|
| `prepare-installed.mjs` | `8aaa7b9a5236609dc6853d99dab6c756d7069f5391bb67cb7efce3312cd0eda1` |
| `observe-installed.mjs` | `9866a447b1672b2931fef3b022518f5db519dc7317e8d05b3557e7193f0e9761` |

The preparer captures expectations before the separate observer call, using
bounded descriptor reads, incrementally bounded traversal, actual root import
resolution and controlling target/entry ancestor package metadata. It imports
only builtins and reviewed inert helpers. The caller reads a fixed SHA-bound
allocation. Both preserve create-only outputs and limited evidence claims.
Review's initial reopened/unbounded metafile and late traversal/import limits
were repaired before execution.

On source `ac915c5`, parent ran the ordinary production build, then the same
esbuild options with an additional metafile output. The two entry files have
identical SHA256 `9f5609c5ba2275a3ba9ecd731b97882a6285a2ad98ed5815488284d520efa262`.
Metafile SHA256 is
`862121a56c48b3adc3e40240620d50985d6e29e95ea722c6431a181e12bfdc7a`.
Compiler is esbuild 0.25.12. `build-provenance.json` records exact CWD, command,
source and lockfile identity; `dist/index.js` maps directly from that CWD to the
branded server-entry path. No production build semantics or package files change.

The reviewed preparer ran exit 0 in 2.616 seconds, separately before observation.
It declared 46 external-kind/specifier groups, 34 controlling package metadata
files and 171 build artifacts. Its source-bound allocation SHA256 is
`c4c9a51e1dfb1c2e2dd6f987aca664df48904bc7e16783a43002d3889628a23e`;
inventory SHA256 `48113ec05b38b6b3165ef18979d32beceb398905215130a19a1807e11309b626`.
Build commit stays `ac915c5`; harness commit is `e7da0c4`. The intervening changes
affect only the fixture/observer harness and its documentation, not the built app.

An independent read-only reviewer rehashed the concrete allocation, all 70 unique
selected files (85,311,213 bytes), all 171 artifact pins, and independently
enumerated the 34 existing entry/target ancestor package metadata scopes. All
331 metafile external-import records matched the 46 grouped edges and occurrence
counts. The same-build entry/output mapping and unchanged source identities were
accepted before the observer ran; this is snapshot adjudication, not authenticated
software provenance or continuous custody.

The actual observer then passed **exit 0 in 1.290 seconds** using the reviewed
caller and closed Windows environment. Logs: `observe-installed.stdout.log` and
empty `observe-installed.stderr.log` in `.local/r20-installed-resolution-oct28/`.
The result class is `declared-installed-candidate`. It observed **33 static ESM
file roots, one literal dynamic-import file root, 11 builtin groups and 70 unique
selected files**. The dynamic root is `file-type`, with two occurrences; its
static import is separately classified. Parent source/runtime pins were checked
again immediately before dispatch. No selected module was imported or evaluated.

The result earns only `esmRootResolutionsObserved=true` and
`selectedEntryBytesObserved=true`. The manifest explicitly separates actual
build/runtime pins from inert, unobserved service/browser/TLS declarations; the
latter cannot earn any live-service or full-profile acceptance. Native fixture
results and installed candidate observations are separate evidence classes. The
literal require-call `posthog-node` and transitive/computed runtime loads remain
uncovered. Package metadata completeness remains a preparer responsibility, not
a claim to trace every metadata read or Node cache behavior.

Parent accepts this bounded native-resolution milestone. It is independent of
the CSRF middleware/database/browser evidence in
`R02/VERIFICATION-CSRF-ACCEPTANCE.md`. Existing failures remain part of this record;
the successful fresh allocation does not relabel earlier attempts as passed.

## Remaining gate

Keep `transitiveClosureComplete`, `custodyHeld`, `runtimeDependencyIdentity` and
`executionAuthorized` false. Complete runtime closure, enforcement through
loading/lifetime, then reviewed profile integration are still required before
launch authorization. Redis, native HTTPS, PostgreSQL TLS, egress, secrets and
direct SMTP/MIME browser acceptance are separate unresolved dependencies.
No production profile, database, listener, delivery, main merge or deployment is
authorized by this observer's result.
