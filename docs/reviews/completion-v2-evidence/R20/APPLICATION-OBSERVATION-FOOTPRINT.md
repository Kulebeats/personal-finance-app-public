# Application observation footprint follow-up

30 October 2026. Read-only architecture follow-up by
`r20_application_inventory_checkpoint`, Astra High, against canonicalef99071b.
It inspected the integrated reader, historical41 package rows, installed manifests,
existing metadata/observation code and official pinned Node24.22.0 source. It
performed no resolver probes, selected evaluation, tests, services or source edits.
This clarifies the already accepted inventory/observer contract; it does not
accept an unimplemented collector or certify all41 package rows.

## Supported implementation sequence

1. Keep each exact emitted parent/kind/mode/specifier tuple. Measure shared files
   once where appropriate, but retain separate resolution results for each parent.
   Validate actual runtime, argv, clean environment and harness pins before native
   resolution. No caller resolver callback or selected-module import is permitted.
2. Capture the parent's nearest package scope and nearer manifest absences,
   stopping at Node's scope boundary. Each absence needs its real existing
   immediate parent and complete listing. Malformed, unreadable, linked or
   wrong-kind entries are not absence. Leaving approved roots before proving the
   footprint yields an explicit unsupported result.
3. Account for package self-reference before installed namesakes. Matching nearest
   scope name with non-null exports takes precedence; excluded exports must not
   fall through to `node_modules`. The historical project name is `rest-express`,
   absent from the41 rows, but that does not prove there are no nearer scopes.
4. Enumerate Node's nearest-package locations, handling scoped names and the first
   missing component. Stop at the first existing package directory even without
   `package.json`; such a directory is unsupported in the first implementation,
   never permission to continue to a farther package. A search that cannot finish
   inside approved roots is unsupported footprint, not global package absence.
5. Support exact exports subpaths/root strings and bounded nested conditional
   objects with safe package-relative/null leaves. Preserve raw manifest property
   order; native resolution chooses the condition, not a replacement algorithm.
   Initially reject relevant wildcard/array maps, unsafe main values and unbounded
   structures as explicit unsupported footprints. Legacy support starts with exact
   existing main files, no-main/index.js first fallback, and exact explicit subpaths.
   Broader fallback support requires every higher-priority absent probe.
6. Call native `import.meta.resolve` only after the admissible input footprint is
   known, using the actual parent URL. Validate the returned canonical file URL,
   package/root containment, physical file kind and descriptor-bound bytes. A URL
   alone is not proof that its target exists or is a regular file.
7. Capture the target's separate format scope, including nearer manifest absences.
   `.mjs`/`.cjs` are explicit; `.js` requires an established `module` or `commonjs`
   type for this conservative observer. Typeless `.js` remains ambiguous because
   Node can defer format determination until loading/source detection. Never
   evaluate the target to manufacture an answer.
8. Independently pin a collected candidate, then start a fresh acceptance window
   and reconstruct its complete footprint. Measure before resolution and verify
   bytes, identities, listings, absences, fresh native results and cleanup after.
   Reject missing/extra inputs, shadowing, replacement, timeout and failed cleanup.
   A repeated resolver result cannot substitute for filesystem checks.

Pinned primary sources supporting this interpretation:
[package lookup](https://raw.githubusercontent.com/nodejs/node/v24.22.0/lib/internal/modules/package_json_reader.js),
[default conditions](https://raw.githubusercontent.com/nodejs/node/v24.22.0/lib/internal/modules/esm/utils.js),
[legacy/ESM resolution](https://raw.githubusercontent.com/nodejs/node/v24.22.0/lib/internal/modules/esm/resolve.js),
[import-meta URL behavior](https://raw.githubusercontent.com/nodejs/node/v24.22.0/lib/internal/modules/esm/initialize_import_meta.js),
[format determination](https://raw.githubusercontent.com/nodejs/node/v24.22.0/lib/internal/modules/esm/get_format.js).

## Honest blocked dispositions

The41 historical rows include scoped/exact subpath/nested conditional cases and
multiple `ioredis` parents. The architecture review found11 legacy packages;
several target typeless JavaScript. Complete first-observer acceptance of all41
rows is not promised. `node-cron` and `yahoo-finance2` also exercise nested scopes.

The current closed reader lacks missing-target, directory-target and ambiguous
format diagnostics. Preserve these as unbranded explicit diagnostic results until
a reviewed schema extension exists; do not label them `PACKAGE_NOT_FOUND`, invent
CommonJS format, or disguise unused manifests as project manifests to evade file
reference checks. Native excluded-subpath errors may become the corresponding
blocked reason only with a stable complete footprint. Permission/invalid-manifest
errors must not become absence.

## Narrow OS metadata executable exception

The host's real metadata executable is exactly
`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`; it has two Windows
component hardlinks. The architecture checkpoint explicitly accepts this
separate OS-tool exception: independently pin exact canonical path, bytes/size,
device/inode and expected link count2, and verify identity before and after use.
Only SystemRoot lookup may tolerate case differences before requiring canonical
realpath. No arbitrary SystemRoot executable tree may inherit this exception.
Node, harness, application and selected files retain one-link/exact-path rules.

This is a trusted OS metadata prerequisite, not general hardlink tolerance,
continuous custody, native-addon acceptance or application execution authority.
`APPLICATION-FILE-WINDOW.md` records the concrete measurement implementation and
its own tests; the collector/native-resolution observer remains subsequent work.
