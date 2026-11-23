# Application lookup footprint collector

30 October 2026. Scope: bounded, untrusted package lookup collection over actual
Windows fixture files. This does not resolve modules, complete application
inventory acceptance, retain continuous custody, or authorize application execution.
Master specification v2.6 and APPLICATION-OBSERVATION-FOOTPRINT.md govern.

## Ownership and source freeze

Parent author worktree:
`C:\Users\USER\.codex\worktrees\capital-r20-lookup-footprint\personal-finance-app`,
branch `codex/r20-lookup-footprint`, base
`8d92ac9735e71474b53e089728da871c837d53db`.
Exactly seven source/test files are owned by this slice. Four are new; the file
window, inventory reader and inventory regression file are bounded amendments.

| File under server/testing/production | SHA-256 |
| --- | --- |
| application-lookup-footprint.mjs | 792b40556e8fcd30509dc3be05014ba1904a603d892398bb9af66326ccb3af25 |
| application-lookup-footprint.regression.mjs | bcd93806212d7ffd1e66aaead1edcbc99d2b97e80365a5bea2c7948baab02f18 |
| application-package-json.mjs | 548eef54a6ec0de62b5c4db8fad485c5fba6f2340e70ec29a426f40bd5bf3b59 |
| application-paths.mjs | ce39ec4772b894dfe5f66c3f4c3700b8aa3f48a7e12a9e4823b03bc3b46cf5e9 |
| application-file-window.mjs | 441830858e59d2aa80cc677f2829bb28fd00825837b24c7584f311fee207cfc9 |
| application-root-inventory.mjs | 0f035900a7b50568d4f1080fd76f6f5140d12fb3a1d7fb179af1e5be12355d18 |
| application-root-inventory.regression.mjs | 2d8a9c778e1edbb9e901e0cf2ddc0a831f5d7b930362749bced5c6fde903ddc9 |

Source-freeze JSON SHA-256:
`916903620f2c7517092ad0050c89ef686be9e1a451010d9927a0f2838e1d783c`.
Canonical copies match these raw byte hashes. Historical file-window and inventory
documents describe their earlier accepted revisions; this table supersedes only
the three amended files for this slice.

## Behavior and limits

`collectApplicationLookupFootprint(text, expectedHash)` binds a closed serialized
request to an independent expected hash. It preserves parent pin, specifier,
import kind, ESM mode and occurrence count on candidate and blocked outputs.
Collection follows nearest package scope, self-reference precedence and package
lookup from the actual physical parent. It measures raw manifest bytes, relevant
candidate files, complete supplied directory listings and immediate-parent
absence probes through the file window. Measured directory identities accompany
listings. All output is unbranded and every acceptance/custody/execution flag is false.

Exact exports and bounded nested condition objects enumerate possible leaves in
manifest order without choosing a condition. Duplicate decoded JSON keys refuse.
Relevant patterns/arrays, legacy fallback, missing or directory targets, typeless
JavaScript and scope/dependency boundary crossings produce explicit diagnostics.
Malformed input or changed physical state refuses. A nearer package directory
without a manifest never silently falls through to a farther install. A self-reference
must also fit the declared dependency boundary.

Physical lookup entries now permit scoped package names and interior spaces via
the application-specific path helper. Emitted graph paths retain their strict
existing validator. Alias, separator and reserved-name controls remain intact.
The file-window result exposes identities from matched before/after measurements;
this adds evidence fields without granting custody or runtime identity.

Limits include 128 KiB requests, 1 MiB manifests, 512 measured files, 128 MiB data,
128 targets, depth 16/1024 export visits, 4096 paths/entries, and a 60-second budget.
No native resolver or selected module is invoked. The nearest-package traversal
was checked against the pinned Node v24.22.0
[package JSON reader](https://github.com/nodejs/node/blob/v24.22.0/lib/internal/modules/package_json_reader.js)
and [ESM resolver](https://github.com/nodejs/node/blob/v24.22.0/lib/internal/modules/esm/resolve.js);
CommonJS-specific traversal shortcuts were not substituted.

## Tests and independent review

Evidence is retained in canonical `.local/r20-lookup-footprint-oct30/`.
The 20-file receipt SHA-256 is
`ea7784624f312be15884d87d213415ec646ee78f8ca2190a5ca35ee215ef7a45`.
The first run preserved a real scoped-package failure (6 passed, 1 failed): the
old emitted-graph path validator rejected physical `@scope` entries. The dedicated
physical-entry helper repaired it; the scoped rerun passed 7/7. Later affected
runs passed 41/41 then 42/42 after tuple/identity controls were added. These are
successive candidates, not repeated retries of an unchanged failure.

Final author run: 42 tests passed, zero failed/skipped, 25.391 seconds. The command
used the pinned Windows ARM64 Node v24.22.0 executable with `--test-concurrency=1`
over collector, inventory and file-window regression modules (10 + 18 + 14 tests).
The tests use owned synthetic Windows files and metadata subprocesses; poisoned
selected modules remain unevaluated. No database, browser, provider, application
launch, persistence or release evidence is claimed.

Independent Astra High reviewers `r20_graph_types_review` (JavaScript/TypeScript)
and `r20_graph_final_review` (general/final) approved the exact seven hashes with
no actionable static findings. Neither approval substitutes for full observer
acceptance. The general reviewer then independently passed collector 10/10 and
the scoped inventory control 1/1, both exit 0. Its post-run freeze confirms all
seven hashes and sizes. Raw reviewer logs and exit files are preserved.

Canonical integration initially passed the 32 inventory/window tests, but the
collector module failed before its tests because its owned fixture root had not
been created. This setup failure is preserved in canonical-setup-red.log/exit
(and the original canonical-integration.log/exit). After creating
`.local/r20-lookup-footprint`, only the previously unexecuted collector module was
run: 10/10 passed, exit 0, 10.292 seconds. No source changed and the already-green
32 tests were not rerun. Canonical-post-freeze confirms seven-file hash parity.
Thus all 42 affected tests passed in canonical across those two invocations;
the first combined command itself remains a recorded failed command.

## Remaining work

The native resolver transport is separately owned by Sol Extra High in
`capital-r20-native-probe`, branch `codex/r20-native-probe`, based on 8d92ac97.
Its three new native-resolution modules/tests are source preparation only until
the coordinator grants the native slot. It cannot grant footprint acceptance.

Later inventory assembly must bind genuine parent/intermediate scope manifests
explicitly; it must not relabel unused manifests to evade reference checks.
Reader support for zero-byte targets and the detailed missing/directory/ambiguous
format diagnostics remains unresolved. The complete observer, stage, custody,
application execution and required-job startup capability remain separate work.
All 101 canonical groups remain OPEN and the goal stays active. R18 review gates,
R09's terminal revoked-network-permission state and external/release gates remain.
