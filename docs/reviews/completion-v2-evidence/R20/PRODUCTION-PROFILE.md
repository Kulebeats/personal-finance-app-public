# R20 local production profile boundary map

Historical boundary map, 15 October 2026; implementation checkpoint updated
28 October. Parent owns integration; independent reviewer `r00_final_review`
supplied the original map. Manifest/layout/services/security contracts, dependency
inventory and installed Sharp/GeoIP normal-component evidence now exist. They do
not establish an integrated production profile, live Redis or application-schema
acceptance over native PostgreSQL TLS. The separate native PG component at
`1dd9aed746ccf6e9823b640751787d63ddfdfbac` passed TLS/identity and rejection controls;
see [NATIVE-PG-TLS.md](../R19/NATIVE-PG-TLS.md). Its owned cluster was removed and
it did not run the application schema. The separate browser trust proof at `4752e58` remains
bounded to its component; see [BROWSER-TRUST.md](BROWSER-TRUST.md).

Current continuation is the [real Redis and application integration plan](../../../plans/2026-10-28-r20-real-redis-application.md).
The official Ubuntu ARM64 artifact has been downloaded and hash-verified; no
distro or Redis instance has yet been launched. Read
[INSTALLED-RUNTIME-ACCEPTANCE.md](INSTALLED-RUNTIME-ACCEPTANCE.md) for the exact
accepted component scope and pending failure controls. The prerequisites below
remain the full-profile target, not a claim that their source contracts are absent.

## Existing profile and required separation

The ordinary protected runner deliberately forces `NODE_ENV=test`, binds a plaintext synthetic PostgreSQL target and an HTTP loopback browser origin, and denies TLS sockets. Its browser request interception fetches and fulfils responses. These controls remain useful local regression protection but cannot prove browser TLS trust, production cookies, CSRF or redirect behavior. Preserve this profile unchanged while adding an explicit production profile initialized before any application import.

The new immutable manifest must bind run ID, profile, build SHA, HTTPS browser origin, fixed backend endpoint, PostgreSQL host/port/database and public CA identity, owned Redis endpoint and run credential, and worker/proxy endpoints. Keep secrets ephemeral and out of evidence. Provider, mail and push egress stays disabled. Missing, inconsistent or late-mutated settings fail closed.

## Prerequisites and transport boundaries

1. Create a dedicated disposable PostgreSQL cluster with separate PGDATA and port, real PostgreSQL SSL, and ephemeral CA/server certificates. Do not change the existing campaign cluster on 55432 or shared PostgreSQL configuration. Use versioned migrations and the same persisted run marker.
2. Run a real owned Redis instance on a run-bound endpoint. A fake cannot establish production quota/readiness behavior. The last host inventory found no Redis executable, Docker/Podman or configured WSL distribution; recheck before choosing an authorized local implementation path.
3. Establish isolated Chromium trust for the ephemeral CA with `ignoreHTTPSErrors:false`. Node extra CA configuration does not establish Chromium trust. Do not install a global trusted root or use certificate-ignore flags as acceptance evidence. Standalone proof `4752e58` now demonstrates native trusted navigation and CA/hostname rejection using fresh Chromium 145 profile-local certificate databases. Integrating that version-pinned primitive with this full guarded profile remains open.
4. Use an owned HTTPS terminator with a fixed upstream application listener. Strip incoming forwarded headers and set the trusted HTTPS/host values for the single proxy hop. The backend is never an alternate browser origin. Serve built client assets, not Vite.
5. Use an exact-origin CONNECT egress proxy for native browser HTTPS. Allow normal same-origin redirects; refuse foreign destinations, downgrade and unowned loopback before connecting. Explicitly test that Chromium loopback, new pages/contexts and API requests cannot bypass the boundary. Request interception alone cannot prove native certificate validation.

The production PostgreSQL adapter reuses R19's verified TLS resolver and configured-host identity checks. Before releasing application queries or callbacks, verify on the same client the expected database, run marker, server port and `pg_stat_ssl` state. A PostgreSQL TLS proxy would change backend SSL/port truth; do not weaken these checks to conceal that difference. Node TLS paths, including pg's preconnected socket, must remain bound to the precise endpoint, CA and host identity.

## Ownership and implementation order

Parent/R20 owns new production target/environment and network/PG guard adapters, their negative tests, production browser server, HTTPS terminator and egress proxy, dedicated Playwright config/fixtures, and fixture-context profile dispatch. Reuse R19 TLS source unchanged. Avoid R01 auth/session/schema files. If built static serving needs extraction from `index-prod.ts`, use a small pure helper under parent ownership and review its actual middleware order.

First implement and independently review immutable manifest parsing and rejection tests. Resolve the owned runtime/trust prerequisites before claiming a working profile. Then exercise transport-negative controls before starting the application security journey.

## First acceptance oracle

- Actual browser HTTPS login with Secure/HttpOnly/SameSite cookie assertions and host-only `__Host-csrf` attributes.
- A protected account POST with a real CSRF token succeeds; missing and wrong tokens return 403 with independent database proof of no write.
- Wrong CA and wrong hostname fail through actual browser and PostgreSQL transports.
- CSP produces a browser violation event and no request reaches an independent sink. Sink silence alone is insufficient because the network guard can also explain it.
- Golden A prefix remains 1074.50 through real UI submission, reload, authenticated API and independent SQL readback; the omitted-submit case still fails the positive oracle.

Record exact candidate, artifact/build identity, target, certificate identities without private keys, runtime commands, positive controls, negative outcomes and reviewer disposition. This establishes bounded local production-mode evidence only. Hosted Redis/storage, deployment, restoration, all journeys and release gates remain separate.
