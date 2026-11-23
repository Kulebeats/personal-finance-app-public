# R20 application module identity implementation contract

29 October 2026. Canonical base `e161afebf87856cd240ce050f1c3732ab0cc2a2b`.
Governing authority remains the master completion specification v2.6.

## Astra High architecture checkpoint

The `r20_astra_boundary_review` agent successfully ran using `gpt-6-astra`,
High, after the tool/model availability refresh. Its read-only review accepts
externalizing and staging one canonical trusted module graph as the
implementation direction. It does not accept the current bundle for profile
launch, approve unimplemented loading controls, or supply runtime evidence.
Previous model-unavailable results remain historical failures.

The application must import the public getter from a single staged trusted
tree. The installer and getter share one private cell; factory and cell share
the same admission WeakMap; manifest, credentials and service brands also
share one canonical module URL/realm. Equal bytes at different URLs do not
establish shared identity. Do not introduce globals, reset functions, public
registries or serialized admission flags.

## Chosen layout and order

Use `dist/production-application.js`, `.runtime/application-bootstrap.mjs`, and
`.runtime/trusted/` preserving repository-relative module paths. The fixed
getter boundary is
`../.runtime/trusted/server/config/redis/production-slot.mjs` from the emitted
application. Emit the exact transitive trusted closure once. This includes
TypeScript dependencies such as `server/modules/health/redis-readiness.ts`;
copying only MJS files is insufficient. Compile these modules individually,
record their source/output mapping, and rewrite their literal internal imports
to the exact emitted paths. Pin both source and emitted bytes.

1. Build a deterministic, compile-only application/trusted-graph emitter and
   tests that reject duplicated authority, invalid mappings and undeclared
   members. No existing build/start command is replaced in this increment.
2. Join the explicit graph with the runtime inventory/stage under a separately
   identified application contract. Preserve existing component acceptance.
3. Implement application-specific parent-edge controls and deferred bootstrap.
4. Review the exact candidate and run negative loader tests before a separately
   scheduled, protected application runtime window.

The graph record binds stage-relative paths, formats, SHA-256/size, source
mapping, entry roles, parent/specifier/target edges and build provenance. Its
digest is consistency evidence only: it grants neither producer nor launch
authority. Reject ambiguous/colliding mappings, nonliteral/unresolved internal
imports and a bundled copy of any trusted identity module. Builtin/package
edges remain explicit external dependencies requiring the existing package
closure checks later. Do not treat compilation as installed-stage validation.

## Effective loader contract

| Parent | Allowed trusted targets |
| --- | --- |
| Emitted application | Exact public getter only |
| Ordinary packages | No private cell, installer, factory or issuers |
| Public getter | Exact private cell |
| Installer | Same exact private cell |
| Private cell | Exact production admission module |
| Trusted bootstrap and trusted dependencies | Reviewed literal edges in the pinned graph |

Apply the rules to static/dynamic imports, CommonJS entry paths and cached
modules. Reject alternate query/hash/case/path URLs, copied graphs,
symlinks/junctions, undeclared members, format changes and digest drift. Stable
external modules are chosen over generated shared chunks for this increment.

Custody/loading controls, genuine producer/factory admission and one-shot
installation must precede **dynamic import** of the effectful application.
Check the live getter immediately before that import. Deferring only
`startApplication()` is insufficient. Failure/revocation must prevent
application evaluation and retain owned cleanup. Captured facades remain
lifetime-fenced and the revoked/failed slot cannot be reinstalled.

## Required later changes and acceptance

The current `runtime-resolution.mjs` assumes `server/index-prod.ts` and named
external imports; `layout.mjs` fixes server artifact `index.js`;
`installed-runtime-stage.mjs` fixes the Sharp/GeoIP component harness. Add
explicit application contracts to inventory/staging rather than interpreting
those accepted component contracts as application authority.

Add application loading/bootstrap modules and their regression tests. Prove
one module identity through emitted bootstrap and getter, refusal of private
imports before and after caching, no app evaluation on failed admission, live
admission reaching real cache/quota/limiter/readiness consumers, terminal
revocation and actual connection cleanup. Preserve existing producer, custody,
native, persistence and release gates. A8 factory/slot component evidence does
not replace a fresh owned Redis application run.

The consumer review raised a startup/readiness gap: the profile is accepted
while its scheduler lock is unavailable. Astra upheld this finding and approved
one shared side-effect-free required-job-capability assertion. For the current
admitted profile it checks lifetime and refuses with a stable missing-capability
code. Production environment validation must reject startup even when REDIS_URL
is also supplied; scheduler initialization must check before registering any
cron job; readiness/startup health must report required jobs unhealthy with503
despite successful DB/Redis probes. Keep liveness semantics and operation guards.
Do not invent a lock protocol or disable advertised jobs. Durable scheduling
authority remains under R14/R19; current full-application success is therefore
still held. Compile/stage work remains authorized.

Stateless facade adapters may remain bundled only when the full graph audit
proves they introduce no private brands or independent authority state. A
getter import-string check alone is insufficient; do not grant all Redis
facades unrestricted trusted-graph access.

All canonical completion groups remain OPEN. This is an implementation contract,
not closure, runtime acceptance or release approval.
