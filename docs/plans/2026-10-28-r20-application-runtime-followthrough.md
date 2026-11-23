# Application runtime follow-through toward R02

## Outcome and authority

The owner approved continuing the proposed implementation sequence: resolve actual
application dependency/native/data blockers, support the real installed application
in the protected production profile, then complete R02 mail/browser journeys.
Canonical starting commit: `6b50943d024b3c8acc721d8c30a6837043eda90b`.
The master completion specification remains the requirement/status authority.

This execution starts with the concrete dependency and native/data blockers.
Acceptance of one slice does not imply the complete profile or R02 is ready.
Local source, isolated synthetic tests, read-only installed dependency inspection
and local integration are authorized. Existing shared databases, real external
delivery, provider credentials, deployment and release gates remain unchanged.
Do not modify the primary checkout or mutate linked/shared node_modules.

## Four-agent ownership

| Role | Work and ownership |
| --- | --- |
| Parent coordinator/final assessment | Plan, shared-interface decisions, canonical integration, serialized broad checks, final evidence/ledger |
| Sol Extra High dependency author | Existing capital-r19-foundation checkout on a new branch; PostHog/ESM loading diagnosis and minimal source/dependency repair, focused tests and separate evidence |
| Sol Extra High native/data author | Existing capital-r04-foundation checkout on a new branch; exact Sharp/libvips and fast-geoip loading assessment, narrowly agreed support files/tests and separate evidence |
| Sol Extra High independent reviewer | Read-only scope/contract review followed by exact-candidate correctness, JavaScript/TypeScript, security and evidence review |

Authors preserve previous branches and verify clean worktrees before branching
from the canonical candidate. No additional agents; no overlapping file edits.
The two author agents are `dependency_implementation` and
`native_data_implementation`; reviewer is `runtime_independent_review`.
The requested coordinator/final-review role remains in this chat; tool-selected
child models/efforts are recorded above without inferring this chat's model.

## Implementation order

1. Trace actual production callers and installed files. Each author proposes exact
   owned paths, behavior, negative controls and smallest useful result before edits.
   Parent and independent reviewer adjudicate shared contract changes.
2. Repair the missing analytics dependency and ESM loading incompatibility while
   preserving optional configured analytics behavior. Do not remove functionality
   or silently declare an unresolved dependency safe. Dependency installation, if
   needed, must use an isolated location and reviewed package/lock changes.
3. Address actual native/data loading with explicit supported and unsupported
   boundaries. A package listing, import classification or mock is not proof of
   native DLL custody or data-read enforcement. Do not claim or enable application
   execution from a declaration or caller-controlled certification flag.
4. Run meaningful focused regressions, independent exact-diff review, required
   static checks and relevant build/runtime evidence. Fix review findings before
   canonical integration. Serialize broad checks and native dispatch; pure bounded
   tests may run in parallel. Use the pinned Node 24.22.0 Windows ARM64 runtime.
5. Reassess the actual candidate blockers after integration. Carry the exact
   remaining work into installed staging and full-profile service/TLS/egress/secret
   integration. Do not add generic framework work without an application need.
6. Once the profile prerequisites are actually satisfied, exercise R02 registration,
   verification, household/category setup, first transaction, reset and email-change
   journeys using synthetic identities and captured mail, with independent persisted
   read-back and failure/retry controls. The current v1 profile disables mail;
   captured-mail enablement needs an explicit reviewed local profile extension.

## Acceptance and reporting

Record exact commits, commands, runtime, source changes, target/mode, results and
remaining blockers. Preserve prior failures and distinguish build, mocked tests,
native component execution, full-app execution and browser/persistence evidence.
No production readiness, closed requirement group, main merge or deployment is
inferred from this batch. The next product work after the prerequisite account
journeys is the remaining R04 permissions and R03 household lifecycle scope.

## Concrete first-slice decisions

Independent scope review accepted this sequence. The dependency author traced an
undeclared `posthog-node` root, synchronous `require` in an ESM bundle and an SDK
capture signature mismatch. A named ESM import with an exact reviewed dependency
pin and SDK-correct capture is preferred over a global require shim.

Activating the previously broken transport would expose raw identifiers,
exception text and query hashes that the logger separately redacts. The bounded
repair therefore sends aggregate events only: fixed application distinct ID,
person-profile processing disabled, validated numeric counters/durations and
booleans, generated timestamp and a closed environment label. No raw IDs, query
hashes, exception/prompt text or free-text event properties leave through this
adapter. Existing logger behavior is retained. Individual analytics/consent policy
is not invented here. Disabled tracking must not construct an SDK client.

The native/data author's first files are `runtime-native-data.mjs`, its focused
regressions and `R20/RUNTIME-NATIVE-DATA.md`. They collect the actual ARM64 Sharp
addon and sibling libvips PE imports and complete finite fast-geoip data namespace.
This is a concrete read-only input for the subsequent installed consumer, not a
native execution/custody grant. No generic resolver, sandbox or new authorization
flag is part of this slice. Source review precedes its installed collection.

Dependency lock generation and materialization use new private scratch directories
with lifecycle scripts disabled. Package additions must be reviewed before any
copy into an independently verified private test dependency tree. External SDK
transport and native module execution remain outside the first focused tests.
