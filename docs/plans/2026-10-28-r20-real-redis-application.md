# R20 real Redis and application integration

This is the next local implementation slice under the master completion spec and
the owner's overnight authorization. It follows the installed Sharp/GeoIP normal
acceptance at `c8d25640`; its eight failure/lifetime controls are finishing in
parallel preparation. No additional permission is needed for isolated local
dependencies, source changes, synthetic tests, independent review or local commits.
Production/shared databases, real external messages, paid providers and deployment
retain their separate gates.

## Outcome and ownership

Join a real, owned Redis service to the same restricted adapter used by the
application's readiness check, rate-limit store and cache invalidation. A PONG or
mock-only adapter is not acceptance. Next integrate that adapter into the built
application with native PostgreSQL TLS, the HTTPS terminator and browser egress
boundary, then run the R02 account/session journey. Preserve the ordinary protected
runner and the established master requirements.

- Producer: owned WSL distro, signed-package installation, foreground Redis,
  private provisioning, process/listener ownership and cleanup receipts.
- Consumer: application-facing Redis adapter, narrow actual-consumer injection
  seams, key/script handling and behavioral regression tests.
- Coordinator: shared contract, manifest/bootstrap composition, integration,
  serialized actual dispatch, evidence and final disposition.
- Independent reviewer: source and runtime evidence; Astra High final review.

Maximum four active agents. Authors retain their R19/R04 worktrees and must not
revert each other's edits. Native dispatch and broad checks remain serialized.
Before editing shared application interfaces, record the concrete interface and
file ownership agreed by both authors and the coordinator. Keep runtime
provisioning independent of application wiring until their reviewed join.

## Owned runtime

Use the existing Store WSL2 runtime and a unique per-user Ubuntu ARM64 distro,
with a fresh owned directory. Recheck distro/default-state immediately before
import. Always select the exact distro; do not change Windows features, global
WSL settings, host trust, firewall rules or port proxies. Stop this lane on an
unexpected elevation, reboot or interactive setup requirement while continuing
independent source work.

The selected Ubuntu 24.04.5 ARM64 artifact is published in Microsoft's distribution
metadata with SHA-256
`74478b5024d9047397ba79d17c27f73caf85ada4988f88cffc2892d65e6a806b`.
The coordinator saved current metadata and selection under
`.local/r20-redis-oct28/`. Verify downloaded bytes before import. Use the documented
named tar import; record the new registration GUID, VHD/root identity and any
implicit default change. A prior default must be restored; an initially empty
registration set is restored by eventual teardown of this exact owned distro.

Read-only archive inspection found `systemd=true` and an OOBE script that installs
a Windows font and prompts for a user. Before import, prepare a separately pinned,
create-only derived archive changing only `etc/wsl.conf` and
`etc/wsl-distribution.conf`. Use documented distro-local configuration to disable
systemd, Windows interop/PATH integration, automatic drive/fstab mounting and
shortcut/terminal setup, with no OOBE command and provisioning UID0. Verify all
other contents and Linux metadata are preserved. Keep the official artifact
unchanged and retain both hashes plus the exact two-file diff. This reviewed
derivation prevents setup side effects rather than executing or bypassing an
unexpected interactive prompt. Redis itself still runs unprivileged.

Inspect image boot configuration. Establish distro-local package service-start
denial before installation and also prevent Redis autostart across restart;
`policy-rc.d` alone is not proof of all activation paths. Query signed Ubuntu
indexes, freeze exact Redis/dependency versions and package hashes, and retain
installation receipts. The manifest accepts an observed exact numeric version;
the fixture version is not an installation requirement.

Run Redis foreground as an unprivileged distro user with persistence disabled,
bounded memory, DB0 only, numeric loopback and a collision-checked nonreserved
port distinct from all other profile roles. Disable the default ACL user. The
application gets only its run user, exact command subset and key namespace;
provisioning/inspection authority stays private to the supervisor. No credentials,
credential hashes, credential-bearing URLs or secret paths in public logs/argv.

Join the actual Windows `127.0.0.1` endpoint to Linux listener/process identity and
authenticated Redis `run_id`, version, ACL user and a random run marker. The
manifest's UUID instanceId is an allocation identity, not Redis's server run_id;
record their association. WSL process exit alone does not prove Redis termination.
Use exact owned Linux identity and bounded shutdown, with exact-owned-distro
termination as fallback; never global `wsl --shutdown`. Verify listener closure.

## Application boundary

Consume the genuine production manifest, a private generation-bound credential
capability and the verified owned-service binding. Environment strings, serialized
objects and caller assertions do not establish service identity. Public evidence
contains only endpoint/version/run/instance/generation references and ownership
receipts. Install the application binding before imports that construct Redis
clients or rate-limit stores. Preserve the ordinary deployment/development path
behind its existing configuration, separate from explicit local-profile bootstrap.

Distinguish the run-wide credential generation from each connection's admission
generation. Independently verified clients may share a valid credential for the
shared-quota checks. A connection failure revokes that admission; credential
revocation invalidates all its admissions. Fence both dimensions before dispatch
and after asynchronous results.

Initially use one physical connection per admitted connection generation, with finite connect
and command deadlines, no offline queue, automatic resend or automatic reconnect.
Check identity on that same connection before releasing operations. Connection
loss, identity mismatch, timeout or credential/run revocation invalidates pending
and new operations; check generation both before dispatch and after awaits.
Reconnection requires a newly verified generation. Never replay an uncertain
mutation automatically or fall back to memory for production quota decisions.

Expose only operations used by actual consumers: cache get/set/delete, bounded
prefix invalidation, counter/TTL operations, fixed rate-limit scripts, readiness
read/write/delete and fixed lock operations when needed. The profile view must
not expose raw clients, arbitrary commands/scripts, duplicate/connect overrides,
pipeline/stream objects, sockets, mutable options or supervisor credentials.

Inventory exact installed rate-limit-redis script bodies/hashes and the fixed lock
script. Its internal command-array adapter validates each allowed SCRIPT LOAD,
EVALSHA, key count, argument range and logical key; arbitrary scripts refuse.
Derive the minimum ACL from those commands and test denial of admin operations.

Transform logical keys to the physical run namespace exactly once. The adapter
constructs SCAN patterns, validates returned keys, bounds/deduplicates work and
awaits every deletion batch, checking command-level errors. Do not double-prefix
returned physical keys. Caller glob syntax is rejected unless a concrete existing
application pattern has been reviewed. Fix the real unawaited invalidation bugs
in redisDeleteByPrefix and AnalyticsCache with delayed/failure regressions;
success must mean completed, confirmed deletes, not queued work.

Use narrow injection seams in actual readiness, RedisStore and cache consumers so
joined service tests do not import the DB or start the full application early.
Do not create a second demonstration-only implementation. Production quota errors
must remain distinct from optional cache misses/development fallback.

## Joined acceptance and follow-through

Run the actual readiness SET/GET/DEL, rate-limit store increment/get/decrement/reset
and cache invalidation against owned Redis. Show shared quota across independent
clients and threshold refusal. Exercise wrong credentials/generation/marker,
out-of-prefix keys, unknown scripts, nonzero DB, revoked connection and restart
during an in-flight command. No protected callback may run after refusal; no old
generation may release success. Exercise delayed/rejected invalidation batches
and stream failures, inspect actual deletes and retain failure packets. Prove
credential redaction, app-admin denial and final process/listener cleanup.

Then join PostgreSQL marker/schema/native TLS and Redis identity before importing
the pinned built application. Install exact role routing and disabled real
provider/mail/push/worker policies first. Readiness keeps routing closed until
required services pass; later revocation closes protected operations. Continue
directly to captured-mail synthetic account/session and household round trips
through the real HTTPS frontend, API and independent SQL readback.

Carry accepted unchanged Sharp/native/data evidence forward. The component
bootstrap is intentionally not an application launcher; use a separate reviewed
application bootstrap rather than a caller-controlled allow-app flag. Rebuild and
re-pin changed artifacts as necessary without requiring arbitrary execution of
every dependency. All unmet full-profile, master-group and release criteria stay
open until their own acceptance evidence exists.

## Basis

The independent source assessment is retained at
`.local/r20-installed-controls-oct28/redis-next-slice-review.md` (13,717 bytes,
SHA-256 `843fecc4ff63da7bc5e4423b25e52641eb6e7756f0036839c0319dfbf1489a2f`).
It traces current callers and exact source gaps; it is not a runtime result.
External runtime mechanics were checked against
[Microsoft's distribution metadata](https://raw.githubusercontent.com/microsoft/WSL/master/distributions/DistributionInfo.json),
[WSL commands](https://learn.microsoft.com/en-us/windows/wsl/basic-commands),
[WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking),
[ioredis key prefix documentation](https://github.com/redis/ioredis#transparent-key-prefixing)
and [Redis ACL documentation](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/).
