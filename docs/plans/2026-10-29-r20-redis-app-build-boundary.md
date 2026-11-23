# R20 Redis/application build boundary follow-through

29 October 2026. This implements the already approved local production-profile
contract under the master completion spec. It does not authorize deployment,
external delivery, shared database writes or application launch from an inert
component declaration. The parent owns these build/entry/loader changes; the
R04 consumer owns the factory/slot and actual cache/rate-limit seams, and the
R19 producer owns the real Redis service issuer and supervisor.

## Current code and verified constraints

The ordinary package build bundles server/index-prod.ts into dist/index.js with
external packages. That entry statically imports app.ts, which imports DB,
session-store, routes and services and constructs Express during evaluation.
It is unsuitable as a pre-admission profile entry.

A read-only experiment using installed esbuild 0.25.12 and virtual source showed
that a dynamic application import inside one ESM bundle still hoists an external
ioredis import above bootstrap statements. The experiment wrote no artifacts and
imported no application or database code. Use separately emitted application and
bootstrap boundaries; do not assume a source dynamic import guarantees deferral
after bundling.

The accepted installed Sharp/GeoIP component loader permits broad indexed package
parent/target access and exposes node:module. Its fixed four-file closure,
entry-point checks, protocol and C# launch contract are component-specific.
The current child permission is false and launch flags do not permit child
processes. These are not a working full-profile boundary.

## Selected build shape

1. Add a separate profile build path and a small application entry exporting
   startup/static-serving functions without invoking them. Keep ordinary
   index-prod.ts startup separate.
2. Emit the application as its own bundle. Preserve the trusted bootstrap and
   the actual manifest/credential/service/factory/slot brand graph as distinct
   pinned ESM files in one output layout; do not duplicate modules across bundles.
3. Externalize the application's sole getter import to the one emitted getter.
   Keep state-cell and trusted installer separate. The bootstrap admits the real
   service and connection, probes readiness and installs the binding before
   importing the application artifact.
4. Verify the original resolved source graph and the actual emitted graph. The
   application bundle may not contain issuer/state/installer sources. Each
   preserved authority/brand module has exactly one emitted identity.
5. Freeze a bounded output manifest/metafile with hashes. Extend the full-profile
   protocol deliberately; preserve the current component protocol's explicit
   application denial and existing accepted results.

The minimum relevant existing surfaces are layout.mjs validateBuild,
runtime-resolution.mjs selectedFiles/verifyMetafile, installed-runtime-stage.mjs,
runtime-installed-loading.mjs target/resolve/load/builtin controls, and the
separate C# custody launch checks. Current layout validation permits only
index.js plus client files, and current stage code labels other build files
opaque; those assumptions cannot establish a server authority-module closure.

## Import authority and tests

Permit only the reviewed original and emitted edges: app to getter, getter to
the private state read path, installer to state/factory guard, and the trusted
bootstrap/factory/issuer graph's actual dependencies. Validate resolved targets,
not just specifier spelling. Reject aliases, duplicate URLs, query/hash suffixes,
unexpected exports redirects and forbidden static/dynamic/CommonJS edges.

An arbitrary createRequire base can fabricate a privileged parent URL. A pair
allowlist alone is insufficient. The concrete restricted Module facade and any
remaining Module constructor/_load/_compile, require cache or process builtin
access must be reviewed and tested through actual Node synchronous hook/CJS
execution. Do not treat a manually invoked hook callback as proof of this
boundary. Preserve sticky refusal if application code catches an import error.

Acceptance includes one actual built state cell/brand graph, terminal reinstall
and revocation behavior, package/app/DB/session/client/store side-effect sentinels
remaining untouched before successful installation, and denied authority imports
from real package and application parents. Missing/duplicate/changed/opaque
server modules must refuse without relaxing the existing component controls.

## Launch contract checkpoint still required

The real service capability and factory must coexist in the same genuine module
graph. Serializing an externally owned service receipt into the old restricted
component child cannot transfer a private capability. The profile's process,
network and child-process permissions therefore need an explicit Astra checkpoint
before actual application launch. Resolve this using the real producer behavior;
do not introduce a JSON adoption function, fake issuer or global verified setter.
The existing trusted Windows/Node/native base limitation remains; no hostile-native
OS sandbox is claimed.

The first Redis component allocation is separately labelled and has all manifest
certifications false. Its non-Redis declarations are inert. Source component
joins may establish Redis-specific behavior only; full-profile readiness requires
the later owned PostgreSQL/TLS/HTTPS/egress/build/browser evidence.

## Next implementation order

Finish real Redis service and source consumer joins first. Build the independent
application/authority outputs against their reviewed API, then implement the
versioned profile closure/import rules and their actual built regressions.
Adjudicate the process launch contract before dispatch. Continue to the existing
owned native PostgreSQL TLS, HTTPS/browser boundary and R02 journeys without
repeating unchanged Sharp/GeoIP component controls.

## Astra clarification and first implementation slice

Astra's follow-up distinguishes the required invariants from a preferred module
layout: one actual brand/slot identity, exclusion of ordinary application and
package callers from issuer/controller/installer authority, constrained dynamic
targets, and no pre-install client/store initialization. Separate preserved ESM
files are one implementation, not a requirement to replace every loader. A
correctly restricted trusted bootstrap bundle plus deferred application artifact
can satisfy these invariants. Change the existing loader only where a concrete
reachable authority path or premature evaluation requires it; prove the selected
layout using the actual emitted imports and cold-import tests.

The first source slice extracts `production-application.ts`, exporting
`startApplication` and the existing static-serving setup. Ordinary `index-prod.ts`
still imports dotenv and starts automatically. The extracted module still imports
the effectful application graph, including `db.ts` and its dotenv import; it must
be loaded after admission, and this extraction alone enforces no such boundary.
The profile build and bootstrap remain pending. Compile-only esbuild outputs and
synthetic-dependency entry tests are recorded under
`.local/r20-application-entry-oct29/`; neither evaluates the real application.
