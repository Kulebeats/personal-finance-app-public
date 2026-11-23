# R20 PostHog dependency and ESM disposition

Status: bounded application-source repair and pure regression evidence. The old
installed-candidate refusal is retained in `RUNTIME-STAGED-ACCEPTANCE.md`; this
document does not relabel that build or establish actual-profile runtime closure.

## Authority and scope

Author baseline is canonical `6b50943d024b3c8acc721d8c30a6837043eda90b`.
The clean author checkout preserved `codex/capital-r20-package-inventory` at
`dea747b185ece217ca69cbf0e6c5d47f8c67b746`, then created
`codex/capital-r20-dependency-disposition` at the canonical baseline.

The governing master completion specification and R20 staged/resolution acceptance
records were read before implementation. Local source edits, isolated dependency
materialization, pure tests and local commits are within the existing authorized
campaign. Production/shared DB, provider calls, external provisioning/messages,
listeners, deployment and release remain gated. No runtime-stage, enforcement,
package-tree or native implementation was modified in this lane.

## Diagnosis and repair

`ai.tracking.ts` called `require('posthog-node').PostHog` from an ESM server bundle.
The dependency was absent from the manifest, lockfile and author's installed tree.
The broad catch mislabelled ESM/initialization errors as an absent package. Its
handwritten `capture(eventName, properties)` signature also disagreed with the
SDK's object capture API. These facts explain the two retained actual blockers:
`esm-require-bridge` and `missing-root` for PostHog.

The repair declares exact `posthog-node@5.57.2`, uses a static named ESM import,
and uses SDK-derived capture/shutdown types. Client construction remains
synchronous and configured-only; explicit tracking disablement prevents
construction even when a key exists. No key retains logger-only operation.
Initialization, capture and shutdown diagnostics contain static messages, rather
than raw SDK errors. The existing logger/redaction path is preserved.

The previously broken external path contained raw household/user IDs, error text,
query hashes, tool names and other free-form strings. Parent approved minimizing
external captures before enabling that path: fixed aggregate distinct ID
`capital-ai-tracking`, `$process_person_profile:false`, an exact nine-event
allowlist, generated timestamp, closed environment label, validated nonnegative
safe-integer counters, bounded finite latency and exact booleans. External
properties are constructed from the allowlist without spreading raw context.
No per-user telemetry, consent policy or keyed pseudonym scheme is asserted.

## Supported SDK transport hook

Static SDK inspection found that `@posthog/core`'s `logFlushError` prints raw
transport errors/response bodies outside the application logger, including
background flush and shutdown. `_logger` replacement does not cover those calls,
and the declared `flushBackground` method is private. A global console override
or private SDK patch was not used.

`ai.tracking-transport.ts` supplies the supported, SDK-typed `options.fetch` hook
for this private capture/shutdown-only client. It preserves request options and
the SDK AbortSignal. It returns a new plain write-response facade containing only
numeric HTTP status, empty text/JSON readers, and a narrow `retry-after` getter.
Positive numeric seconds normalize and cap at the SDK's 300-second bound; dates,
malformed/oversized values and all other headers are omitted. Successful response
bodies are intentionally unused by this v0 write-only integration. Static SDK
inspection also found that ambient `POSTHOG_CAPTURE_MODE=v1` selects a sender that
parses successful JSON. The initializer therefore refuses exactly that unsupported
mode before constructing the SDK, with a static logger-only diagnostic. Default
and explicit `v0` remain functional; no environment mutation or SDK override is
used. Original bodies
are cancelled without being read, and synchronous/asynchronous cancellation
failures are contained. Fetch/status/header-access failures yield a new static
error without the original error or cause. Numeric failure status/count remains
visible through the application logger. The facade retains no original response,
body, header object, URL, status text or exception.

Static source locations in the materialized package snapshot:

- `posthog-node/dist/client.mjs:61`: feature polling requires a personal key or
  cache provider; neither is supplied. Metrics/traces are lazy, unconfigured paths.
- `posthog-node/dist/extensions/error-tracking/index.mjs:6`: exception autocapture
  defaults false. No SDK feature/survey/remote-config API is exposed by the client.
- `posthog-node/dist/client.mjs:1154`: event preparation can merge registered or
  request-context properties. This private fresh instance has neither. SDK-added
  common properties include library/version and server marker; UUID/time and
  default GeoIP-disable metadata are separate from application properties.
- `@posthog/core/dist/posthog-core-stateless.mjs:80`: raw flush diagnostics explain
  the per-client transport adapter. This inspection is source evidence, not an
  execution or egress attestation of the installed SDK.

## Exact dependency delta and isolated materialization

Fresh npm registry metadata and the installed package manifests identify:

| Package | Locked version | Files | Bytes | SHA-256 of sorted selected file-pin records |
| --- | --- | ---: | ---: | --- |
| `posthog-node` | `5.57.2` | 188 | 934,664 | `211b40af4de153bf5e2eeba382e41e0edbb90493f34903638609c381f8fd3d73` |
| `@posthog/core` | `1.61.1` | 452 | 2,365,586 | `4ee6c0bf50165a7be081240c5aeb192478c3366c4a8cacc538bbdc185549295b` |
| `@posthog/types` | `1.418.0` | 78 | 431,687 | `df27d4e5442825313fd46c489c669070952d714e95e7cebc2c2f361b1d567e5e` |

All three have MIT licenses and no `preinstall`/`install`/`postinstall` lifecycle
script. The selected trees contain no `.node`, `.dll`, `.exe` or `.wasm` file.
PostHog declares Node `^20.20.0 || >=22.22.0`; the pinned Node 24.22.0 satisfies it.
Optional OpenTelemetry/RxJS peer declarations do not add packages to this delta.

Create-only scratch root in the author checkout:
`.local/r20-posthog-dependency-oct28/`. `lock/` contains the raw npm generation
result from copied baseline inputs. `materialized/` is a physically
isolated three-package graph installed with `npm ci --ignore-scripts --no-audit
--no-fund`. No shared tree was installed or mutated.

The generator also added six unrelated metadata records for existing bundled
optional Tailwind WASM dependencies. The scoped final lock excludes only those
new unrelated records; every pre-existing non-root package record was compared
for exact structural equality. The final lock adds the root declaration and
exactly three package records, each retaining npm tarball integrity. A separate
private full-lock `npm ci --dry-run --ignore-scripts --no-audit --no-fund --offline`
passed exit zero; its 711 additions were hypothetical, not a full installation.

`materialized-pins.json` SHA-256 is
`d1ecc5a3eb3dba7db1a56d28eefa3dbb461902b2f4f243a24701c43a55c7851c`.
The read-only pin helper checked all 718 files/3,731,937 bytes, no symlink and
single-link files. After parent authorization, a create-only byte copy into the
author's verified ordinary, absent package directories rechecked every size/hash
and destination link count. `author-copy-receipt.json` retains that result. These
snapshots are local integrity observations, not authenticated package provenance
or continuous custody.

Fresh `npm audit --package-lock-only --omit=dev --ignore-scripts --json` ran in
separate baseline/full-candidate scratch directories with no `.env` or package
execution. Both audits exited 1 with identical vulnerability records: **six
affected packages, four high and two moderate, zero critical**. They are
`body-parser`, `multer`, `nodemailer`, `qs`, `zod` and `zod-validation-error`.
The scoped three-package graph audit reported zero vulnerabilities. The
comparison independently deep-compared complete vulnerability objects/counts;
`audit-comparison.json` SHA-256 is
`6e48d6913f29f0c61364296b367d09e3d4e8bcbefaf2e590c752a47dece54546`.
This shows no new finding from the dependency delta, not a clean application
audit. Existing findings remain unresolved; no unrelated audit fix was applied.

## Regression and review evidence

Runtime: physical Node ARM64 24.22.0,
`C:/Users/USER/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/capital-r00-runtime/node-v24.22.0-win-arm64/node.exe`,
82,123,080 bytes, SHA-256
`df4b0e71e4e4d022bf8582fbe75f6061feb9c4a111a86f3fec6300d24b6fe5e0`.
The matching distribution's npm CLI was selected explicitly; ambient Node was
not used for verification.

The regression transpiles actual production tracking/transport/logger/redaction
sources into isolated VM ESM, with a synthetic SDK and transport. It evaluates no
installed SDK module, application bootstrap, database or real provider. All nine
event methods, allowlist/type bounds, optional/disabled operation, constructor/
capture/shutdown failures and transport/status/header/cancellation failure paths
are exercised. The VM feature warning is expected and retained.

Logs in the scratch root preserve:

- `red.log`: five baseline failures, including configured ESM falling back from
  `require` and disabled tracking emitting a false absent-package warning.
- `green.log`: four passes and one test-harness cross-realm object-prototype
  assertion failure. The helper copied constructor option values into its own
  realm; `green-final.log` then passed all five. This was a harness correction.
- `transport-red.log`: five passes/three failures exposing unfiltered response
  metadata/headers and raw transport rejection before the supported hook existed.
- `transport-green.log`: all eight pure tests passed, zero skips/failures.
- `runtime-combined.log`: the actual `npm run test:runtime` command passed 10/10,
  zero skips/failures. The script includes this regression alongside existing
  runtime declaration tests; existing CI already invokes that script.
- `capture-mode-red.log`: the added mode boundary test failed because configured
  `v1` still constructed a client before the guard. `runtime-final.log` passed
  11/11 after the guard, including explicit `v0` capture and preconstruction `v1`
  refusal; zero skips/failures.
- `check.log` and `check-final.log`: `npm run check` passed exit zero before and
  after the v1 guard, including TypeScript and all repository source/tool/
  metadata/coverage guards. The final run is the current-source result.
- `existing-analytics-unit.log`: the unchanged analytics Vitest suite passed
  12/12 through the protected unit runner. The PostHog API key was explicitly
  empty, before-import network/Postgres guards were active, and the installed
  SDK module was evaluated without constructing a client. This is guarded unit
  import evidence; it is separate from the synthetic SDK used by the pure suite.
- `scoped-lock-dryrun.log`, `lock-delta.log`, `materialized-pins.log` and
  `author-copy-receipt.json`: dependency preparation/copy evidence.
- `audit-baseline.json`, `audit-candidate.json`, `scoped-audit.json` and
  `audit-comparison.json`: current full-lock findings and exact unchanged delta.

Independent Sol Extra High review accepted the production source, regression and
scoped dependency delta, rehashed the five candidate files and reran the pure
suite. The final manifest-only CI-coverage amendment was separately re-reviewed;
the reviewer independently reran 10/10 combined tests, zero skips/failures.
The later exact-v1 guard received a separate final language-review disposition
and parent acceptance after rehashing final tracking source
`6b29e3ceaf9668fc583b793640b6d758ea999cc015dfd8b254120c7fa8c33600`
and regression
`540a0d8b9c18f7a576fb1450dae949d2018b0d8a91ae9f7fe849e322abd14f35`.
That final disposition is static source/diff review, not a claim that the reviewer
reran the eleven-test command. The 11/11 result above belongs to the author run;
parent canonical verification remains a separate evidence step.
Parent candidate integration and actual-build verification remain separate.

## Remaining acceptance

The parent must build the final integrated source and freshly observe the actual
installed candidate; source disposition does not clear the historical root/bridge
refusal for the old build. Actual SDK construction/capture/egress behavior has
not been run.
Broad DB/browser tests were not repeated for this source-only analytics change.
Sharp/libvips, computed-data loading, general installed staging/custody and
full-profile TLS/service/secret/mail/browser requirements remain open. Keep
`transitiveClosureComplete`, `custodyHeld`, `runtimeDependencyIdentity` and
`executionAuthorized` false. No launch, push, main merge, deployment or release
is authorized by this author evidence.
