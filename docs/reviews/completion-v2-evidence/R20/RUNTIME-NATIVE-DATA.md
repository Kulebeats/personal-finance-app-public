# R20 installed Sharp and computed GeoIP data candidate

Status: reviewed local source candidate with an independently rehashed actual
installed-package manifest. This adds a
read-only static collector and a finite input for subsequent installed staging.
It does not load Sharp, an addon, a DLL or fast-geoip, grant application execution,
or certify native closure, custody or bytes loaded by Windows.

Parent authorized this slice after read-only source tracing. Baseline is
`6b50943d024b3c8acc721d8c30a6837043eda90b`; author branch is
`codex/capital-r20-native-data`. Previous branch
`codex/capital-r20-preimport-enforcement` remains preserved. Only the new
`runtime-native-data.mjs`, its regression file, this note and the generated
`RUNTIME-NATIVE-DATA-CANDIDATE.jsonl` belong to this author. Existing root/package
inventory, stage, enforcement, startup, dependencies and lockfile are unchanged.

## Concrete package paths

Receipt processing imports `sharp` from `server/services/receipt/image.ts`.
Sharp 0.35.5 exports `dist/index.mjs` for imports and `dist/index.cjs` for require.
Its constructor loads the corresponding `sharp` loader, which first probes local
`src/build/Release` native and WASM filenames before choosing
`@img/sharp-win32-arm64/sharp.node` for Windows ARM64. The installed package maps
that subpath through `index.cjs` to `lib/sharp-win32-arm64-0.35.5.node`.

The collector requires the enclosing `sharp/src/build` namespace and the fallback
`@img/sharp-wasm32` package to be absent at both capture endpoints. Sharp's normal
published `src` directory is allowed. The selected native `lib` directory must
contain exactly these three names:

| File | Role |
| --- | --- |
| `sharp-win32-arm64-0.35.5.node` | ARM64 addon |
| `libvips-cpp-8.18.7.dll` | Package DLL |
| `libvips-42.dll` | Package DLL |

`server/modules/auth/strategies/geo-anomaly.ts` imports fast-geoip 1.1.88. Its
`build/index.js` computes `data/index.json`, `data/iN.json`, `data/N.json` and
`data/locations.json`. Whole files are read through `fs.readFile`; uncached
location records use `fs.open`/`fs.read` at byte offset `112 * index + 1`, length
111. `enableCache()` instead reads the whole locations file. The new collector
captures the complete finite data namespace, preserving the existing superset
approach rather than claiming that every file is reached by a lookup.

## Producer and next consumer

`readArm64PeImports(Buffer)` is a pure, bounded PE32+ ARM64 import-name reader. It
extracts ordinary and RVA-based delayed imports without resolving symbols or
loading code. Bounds, section overlap, unmapped RVAs, truncation, duplicate case
names and missing termination refuse. Legacy VA-based delayed imports, bound
imports, CLR images and forwarded exports are unsupported and refuse. This is
not a PE execution validator or proof that arbitrary dynamic DLL/plugin loading
cannot occur.

`collectInstalledNativeDataCandidate({sourceRoot, expectedFiles})` requires exactly
19 independently supplied expected file pins, sorted by relative path. Those pins
cover the three native files and 16 package manifests/selection sources. The
selected package names, versions, export paths and libvips version are fixed.
Control/native changes, extra native directory members, unsupported imports,
missing files and changed selection namespaces refuse. The actual observed data
pins are candidate outputs; the collector does not manufacture independent
expected data pins or a private acceptance brand.

The returned object is exactly `{kind,text,sha256,counts}`. `kind` is
`pfa-installed-native-data-candidate`; text is deterministic UTF-8/LF JSONL with
a final LF and a maximum of 2 MiB. It contains a header, `control-file`,
`native-file`, `native-import` and `data-file` rows. File rows use
`{record,relativePath,size,sha256}`; native files add `machine` and `format`.
Import rows use `{record,from,importKind,name,target}`. The generated manifest
uses relative package paths; the actual machine root and runtime are recorded
separately below.

`target` is either the relative sibling package DLL path,
`trusted-windows-base`, or `trusted-node-runtime`. These last two are explicit
import-name classifications. They do not attest a physical system DLL path,
Node mapping or the closure of the platform trusted base. Unknown names refuse.
The addon delay-imports `node.exe`; its two package DLL imports are ordinary.

Directory streaming stops on entry 4097. The flat data namespace permits only
`index.json`, `locations.json`, decimal `N.json` and `iN.json`; aliases and other
members refuse. Data files are at most 16 MiB, data total at most 192 MiB and
all captured bytes at most 224 MiB. Control files are at most 1 MiB and native
files at most 32 MiB. Per-file descriptor reads compare expected pins where
supplied and check descriptor/path identity before and after; every descriptor
closes. Exact native/data directory membership and captured identities are
rechecked at completion.

This Node descriptor snapshot rejects ordinary symlinks, hardlinked files and
case/path aliases. It does not independently inspect every Windows reparse type,
retain native sharing handles, freeze membership/attributes, or defeat a hostile
same-identity writer. Those established boundary limits remain unchanged.

The parent can use the JSONL file's exact independently rehashed bytes as a
concrete input to future staging, requiring each file row to match the accepted
package tree. That consumer must bind it to the exact profile/tree/build,
revalidate the absence probes and selection inputs, and retain appropriate
native/data custody. Existing stage/enforcement continues to refuse this
installed native/data candidate. No new reader or launcher authority is added.

## Verification checkpoint

Pinned physical Node is
`C:/Users/USER/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/capital-r00-runtime/node-v24.22.0-win-arm64/node.exe`,
82,123,080 bytes, SHA-256
`df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0`.
The author independently rehashed it in this turn; the read-only helper checks
its physical path, hash, version, platform, architecture and arguments again.

Author focused pure/fake tests pass 29/29, no failures/skips, 114.7708 ms.
The first run failed all 26 then-existing cases because the implementation API
was absent; those are interface reds. Later behavioral reds are distinct: a
published Sharp `src` directory incorrectly refused, then passed after the probe
was narrowed to `src/build`; and enumeration did not use the bounded stream,
then passed after it stopped on entry 4097. These tests do not evaluate package
code or use native loading, DB, providers, listeners or external messages.

Independent reviewer inspected and rehashed the final source and tests without
an actionable finding, independently reran all 29 tests with no failures/skips
in 439.7459 ms, and checked the portable `sourceLayout: node_modules` header:

- Collector SHA-256:
  `af3522ca7c679fc33fa0f7682c70befe34ccabe30c99bfaafaab07b1bb3e63b2`.
- Regression SHA-256:
  `24ea69f41203584f3053201959b20eaabe8e2c0be965cae98b877ccfce797e68`.
- Read-only helper `.local/r20-native-data-oct28/collect-installed.mjs` SHA-256:
  `22d066db2ac00f9cb4a76dbdbe91a8aaf913fb4de87592de3ea2f55bc8580d50`.

The helper's 19 literal control/native pins were obtained with PowerShell
`Get-FileHash` before execution. The independent reviewer then matched all 19
sizes/hashes to canonical files and cleared the exact helper, source and literal
inputs. Parent authorized that bounded read-only dispatch before it ran. It
checks only the physical runtime and trusted collector import closure, reads
selected package bytes as data, and writes one create-only output in the author
worktree. It does not read environment variables or import application/selected
dependency code. Source/test hash checks remained matched after collection.

Actual installed source root was
`C:/Users/USER/.codex/worktrees/capital-completion-v2/personal-finance-app`.
The dispatch used the author collector/primitives in
`C:/Users/USER/.codex/worktrees/capital-r04-foundation/personal-finance-app`.
Collection completed on 28 October 2026 with exit zero and empty stderr in
**33.843 seconds**. The generated artifact is
[RUNTIME-NATIVE-DATA-CANDIDATE.jsonl](RUNTIME-NATIVE-DATA-CANDIDATE.jsonl),
**535,303 bytes**, raw SHA-256
`eeee58625ff01e128ec068f6295a0600fb009871bdc25cb50ba6ac3587205088`.
Its exact UTF-8/LF bytes need to be preserved during integration/checkout.

| Captured item | Count | Bytes |
| --- | ---: | ---: |
| Package controls/selection sources | 16 | 81,870 |
| Native addon and sibling DLLs | 3 | 17,005,056 |
| Computed GeoIP data namespace | 3,134 | 164,310,543 |
| All captured files | 3,153 | 181,397,469 |

The independent reviewer rehashed the output and **every one of the 3,153 file
sizes/hashes** against current canonical bytes. All matched. The 33 static
import rows contain three sibling-package edges, one trusted-Node name and 29
trusted-Windows names. The latter count describes rows across binaries, not 29
distinct system DLLs. No selected code or native library was evaluated by this
collection or output verification.

| Native file | SHA-256 |
| --- | --- |
| `sharp-win32-arm64-0.35.5.node` | `a08a7d8162cc041c67dc8fa2a1f6122fc412dd3d3d0a90ec2efed1ebfb7a071b` |
| `libvips-cpp-8.18.7.dll` | `966d3df5a7c8ab55d44d32f4bd7ed64d27b1a3a39fac5ccaf6a78c28e769e676` |
| `libvips-42.dll` | `c3ff47e1546127d60ca0964dcbe27541c0bf35517b97aca10dc6a82fb9c540b7` |

`npm run check` passed, exit zero, with pinned Node 24.22.0 ARM64 selected in
PATH: runtime guard, TypeScript, storage-import/LOC/tool-syntax guards and all
assessment metadata/coverage guards passed. No new/grown LOC exception occurred.
No DB/browser suite was repeated for these read-only MJS additions.
Raw local output is retained in `.local/r20-native-data-oct28/` as
`collection.stdout.log`, empty `collection.stderr.log`, `check.stdout.log` and
empty `check.stderr.log`. The portable complete file-pin proof is committed in
the JSONL artifact rather than being retained only under the ignored local path.

Later native Sharp transform/GeoIP lookup and actual DLL path observations remain
future coordinated steps. Full-profile services/TLS/egress/secrets/mail/browser,
R02/J01/G1 and all 101 canonical groups remain open.

## Primary format references

Microsoft's [PE format](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format)
defines the ordinary and delayed import structures used by the static reader.
Microsoft's [DLL search order](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-search-order)
describes why a package DLL import name does not establish the path Windows
actually loaded. Source review and this static manifest do not replace that
later runtime observation.
