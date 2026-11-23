# Real Redis and application integration checkpoint

29 October 2026. Work follows
`docs/plans/2026-10-28-r20-real-redis-application.md`. Runtime preparation and
application adapter implementation are in progress. The owned distro import is
recorded below; no Redis instance, full application launch or requirement closure
is claimed.

## Official artifact and private image preparation

The official Ubuntu 24.04.5 ARM64 WSL artifact was downloaded in 167.424 seconds,
388,300,496 bytes, SHA-256
`74478b5024d9047397ba79d17c27f73caf85ada4988f88cffc2892d65e6a806b`.
Current Microsoft metadata, selection, download receipt and the unchanged base
are retained under `.local/r20-redis-oct28/`.

Read-only archive inspection found enabled systemd services and an OOBE script
with interactive setup and Windows font installation. The reviewed preparation
derives a separate archive changing only the two WSL configuration files to
disable these effects and use explicit provisioning. All other Linux contents
and metadata must survive verification before import.

| Attempt | Actual outcome | Disposition |
| --- | --- | --- |
| A1 | Refused `SOURCE_PIN` in 105 ms; no output archive | Python's Windows named/opened ctime semantics differ. Same opened source hash was correct. Preserve `derivation-a1*`. |
| A2 | Refused `VERIFY_METADATA` in 39.092 s after producing a 428,093,617-byte archive | Archive is unaccepted; no successful receipt. Preserve archive and `derivation-a2*`; compare actual metadata before any correction. |
| A3 | Passed in 53.577 s, exit zero, stderr empty | Independently accepted inert archive; no distro imported. |

A2's source identity correction was independently reviewed: compare common
object fields across named/opened providers, and preserve complete per-provider
identities including ctime before/after. Eight inert tests and actual read-only
source-open checks passed. These preflight checks did not establish archive
round-trip correctness; the actual A2 failure remains authoritative.

None of these three archive-derivation attempts executed Linux, imported a
distro or installed a package.
All owned Python processes were observed absent after completion. No failed
archive may be imported or treated as a verified runtime.

A2's first actual mismatch was a regenerated PAX `linkpath` header for a Unicode
certificate symlink. A3 copies the original decompressed tar bytes, changing only
the two configuration header/body regions. It retains strict semantic readback
and additionally compares all 1,349,304,320 raw tar bytes outside exactly two
1,024-byte regions. Twelve supplied and ten independent tests, including an
actual-source Unicode/PAX fixture, passed before dispatch.

The accepted A3 output is 428,971,502 bytes, SHA-256
`f2c493deeaa2ef5f3da7929374ab19aa171fd17014ca4c3f2b27ff9154a5b493`.
`rootfs-derived-a3.json` is 2,194 bytes, SHA-256
`5742f897ee4693b4130e9c98d58f88956ae95311a0448801a2dcaef67f313188`.
It records 49,344 verified metadata entries, 35,954 regular contents and exactly
the two intended config differences. The parent and independent Python reviewer
matched current artifact/source hashes, receipt/stdout equality, empty stderr
and process absence. This accepts archive preparation only. The later owned
distro import and first-boot continuation are recorded below separately.

## Application lane

The consumer is implementing bounded key/script operations and actual readiness
and rate-limit/cache seams in its isolated author worktree. Shared credential
and owned-service contracts are under independent review. Author tests are not
yet canonical integration or real Redis evidence. The single built bootstrap
must install the verified binding before deferred application initialization,
without duplicate module identity or an unverified global setter.

Next complete the owned runtime and reviewed adapter,
and join real readiness, quota and cache behavior before full TLS/HTTPS/R02 work.
All 101 master groups, the full production profile and release remain open.

## Imported runtime and integrated foundation

The controlled import command succeeded in 9.630 seconds and created only the
owned `Capital-R20-Redis-20261028A1` registration, GUID
`{6d785bcd-f67f-4de2-ae0b-16b2c014d1c7}`, at
`.local/r20-redis-oct28/distro-a1`. The prior registration set was empty; the new
default refers to this owned GUID. Preserve this registration and VHD for the
continuation; do not repeat import or adopt another distro.

The combined import/inspection controller refused `BOOT_OUTPUT`, although its
boot command exited zero. The preserved stderr contains two `ps` terminal-size
warnings. The original packet remains failed because later source/object checks
were not reached. A separately reviewed read-only continuation will set COLUMNS
and LINES only in the Linux inspection child while retaining strict empty stderr,
exact registration/root/VHD identity checks and complete source postchecks.
No Redis installation, application launch or VM-exit certification follows from
this import. Evidence is `.local/r20-redis-oct28/import-a1-controller.json` and
the associated raw capture files.

The twelve-file Redis operations/readiness foundation is locally integrated at
`cc8243a5`; the helper repair is `9c3da9f3`. Combined canonical focused checks
passed 427/427 and static checks passed. These cover bounded logical keys,
invalidation/script contracts and actual readiness extraction, not a joined live
Redis service. The separate Analytics cache candidate remains uncommitted and
under remediation after review found committed-write failure/hang risks from
awaiting ordinary optional cache invalidation. The strict profile and ordinary
post-commit behavior need separate acceptance.

The reviewed read-only boot continuation subsequently passed in 3,799 ms, exit0.
`inspection-a2-controller.json` records exact registration/root/VHD object
identities before and after, all eight source post-pin checks, three clean
bounded captures, and zero stderr. The Linux child-only screen dimensions fixed
the warning without permitting stderr. The original import packet remains
failed/preserved; the continuation does not reimport or retroactively clear it.
No package was installed, Redis started, global configuration edited or VM exit
certified. Independent review accepted the 4,527-byte continuation receipt,
SHA-256 `e8b06045a55546842398ec87f3de364c17fd2746b6721d07eea1e4dfff1cde82`,
all six raw captures and eight dependency pins. Root/VHD object identities are
preserved; the VHD grew 32 MiB during boot, so unchanged disk bytes are not
claimed. Parent independently observed all three reported Windows PIDs absent.

## Reviewed Analytics repair integrated

Canonical `59457654` integrates author `a6b3bf25444cc081e1d6b9f563387eb2bece56eb`,
exactly fourteen reviewed paths. The former three-path candidate was not accepted:
awaiting optional invalidation could fail or indefinitely delay an already
committed finance write. The repaired candidate owns a separate ordinary Redis
connection with 400 ms connect/command deadlines and a 1,000 ms overall deadline,
disables offline queue/reconnect/resend, disconnects on every exit and fences
late commands/results.

Six actual post-commit branches now catch only the explicit ordinary optional-cache
failure and continue subsequent effects. Low-level invalidation still rejects
incomplete deletes. Required-profile refusals remain explicit and take priority
over concurrent ordinary failures; they are not silently converted to optional
success. Required-profile committed-write handling still needs its later joined
application acceptance. No automatic financial-write retry was added.

General review and Astra High TypeScript final review accepted the frozen receipt
`analytics-repair-r2-frozen-source-receipt.json`, 12,967 bytes, SHA-256
`61bead42edd002808cbd339df630f3f131d7f1094da5a769cc127da1c7258b01` in the
R04 author's `.local/r20-installed-loading-oct28/`. Meaningful prior failures
cover all six caller branches, never-settling ordinary invalidation and mixed
ordinary/required error priority. The final reviewer rehashed fourteen source
and sixteen log pins and independently passed 38/38 protected unit tests and
static checks in the exact author candidate.

After integration, all fourteen canonical files match the reviewed source after
CRLF normalization. Fresh canonical protected unit tests passed six files / 38
tests, zero failures, in 9.86 seconds; `npm run check` and `git diff --check`
passed. Local logs and the materialization receipt are under
`.local/r20-installed-controls-oct28/canonical-analytics-59457654-*`.
These are hermetic mocked-repository/cache tests, not actual Redis or financial
persistence evidence. Private credentials, real owned service, restricted factory
and joined readiness/quota/cache acceptance remain next.

## Signed Redis packages discovered, not installed

The actual owned-distro discovery passed in 21,144 ms, exit0, with empty stderr
and all nine source postchecks. Independent review accepted the 4,619-byte
`package-discovery-a1-controller.json` receipt, SHA-256
`fe80681da58e32af2fe82d434250fa18e9f2a69f6caf0cd14f62da5466924f29`,
all six raw captures and ten printed maintainer/control bodies. The controller
and shell are retained in the R19 author's `.local/r20-installed-stage-oct28/`:
`discover-redis-packages-controller-a1.ps1` (21,956 bytes,
`5cceed80f9b40ce3358b203f99b3219a726132da2558ab166ddc08ccca27f414`)
and `discover-redis-packages-a1.sh` (7,998 bytes,
`39b3d3a777ee1f95e5fad20ebaac9f28df865f37f80295f417a432a186a65d66`).

Discovery created the owned distro's policy-rc.d denial and five Redis unit masks,
then used a process-local APT configuration excluding ambient hooks. Official
HTTPS indexes required the pinned Ubuntu keyring, signature/date/expiry checks,
and exact archive SHA-256 agreement with signed package metadata. It simulated
and downloaded only; no maintainer script was executed.

| ARM64 package | Exact signed package version | Archive bytes |
| --- | --- | ---: |
| libatomic1 | 14.2.0-4ubuntu2~24.04.1 | 11,604 |
| libjemalloc2 | 5.3.0-2build1 | 204,324 |
| liblzf1 | 3.6-4 | 7,426 |
| redis-server | 5:7.0.15-1ubuntu0.24.04.5 | 51,686 |
| redis-tools | 5:7.0.15-1ubuntu0.24.04.5 | 1,170,186 |

The five archives total 1,445,226 bytes. Exact archive/control hashes and paths
are in the 16,870-byte discovery stdout, SHA-256
`96410f77665f76145dd9ba9a3564081962eb5ba805302877d0264cb656011dc7`.
Dpkg status before/after remained
`0a82fbafed6c08be25f6c5ab8ff4a0c3dda1ddd5281c118b2b690d7c628d0796`;
the final census contained no listed APT or Redis process. Parent observed all
three reported Windows processes absent. Root/VHD object identity is preserved,
not disk-byte immutability or VM termination. The directory-size assertion is
a post-download check, not an enforced disk quota.

The actual redis-server post-install script invokes update-rc.d/invoke-rc.d and
systemd unmask/enable helpers. Installation is a separate controlled step using
only these five cached archives. Verify actual manual-mask semantics, prevent
immediate startup and persistent SysV/systemd autostart, then verify package,
process and listener state. Pre-install masks alone do not prove that outcome.

The separately reviewed credential prerequisite is committed in the R04 author
as `992b13f3e246de9ef95aba1d820df468359a85cf` and copied into the R19 producer as
`ed22a851`. Eleven pure tests and author static checks pass; general and Astra
TypeScript review accepted prerequisite source only. Canonical integration is
held for the genuine producer join. Missing-producer refusal is not positive
binding or connection-lifetime evidence. The actual factory/slot contract is
under Astra adjudication before implementation.

Astra subsequently approved source implementation with binding rulings: private
SELECT 0 followed by INFO server/ACL WHOAMI/marker identity on the same physical
connection; independently verified server databases=1; narrow -select +select|0
ACL subject to actual Redis 7.0.15 tests; driver readiness is not admission.
Disable the driver's automatic INFO/CLIENT behavior. Observe actual socket close
on cleanup. Keep RedisStore initialization rejection authoritative even when
Express-rate-limit catches it; revoke uncertain commands before its retry and
allow reload only after definite NOSCRIPT.

For the later build, use one private state-cell module identity with distinct
pinned emitted getter and installer boundaries. The app imports only the getter;
the trusted bootstrap admits/probes/installs before importing the app. Verify the
original build graph and resolved emitted parent-to-target edges, including
aliases, dynamic imports and createRequire. Do not independently bundle duplicate
state/brand modules or expose authority through app-reachable chunks. This is the
selected concrete implementation of the single-identity contract, not proof that
the current broad indexed-parent loader already enforces it.

Consumer ownership now also includes the actual core CacheStore seam: required
profile operations must reject unsupported patterns, preserve confirmed zero
deletions, and avoid ordinary Map fallback. Synchronous Map APIs and broader AI
cache behavior are outside this slice's acceptance. The consumer is recording
the precise revised file ownership before implementing these rulings. Genuine
producer joins, real ACL checks and build/runtime evidence remain required.

## Offline installation accepted; service not started

The A1 installer was held before dispatch after independent review identified a
missing DPKG_MAINTSCRIPT_PACKAGE context for the direct deb-systemd-helper call.
Its source, wrapper and preflights remain preserved with `install-a1-review-hold.json`
in the R19 author's local stage directory. No A1 installation was attempted.
A2 scopes that variable to the single helper call. An inert probe of the exact
helper guard demonstrates missing-context refusal and scoped-context success.
Independent review accepted the narrow repair and fresh zero-launch preflights.

The actual A2 offline installation passed in 4,858 ms. Canonical local receipt
`package-install-a2-controller.json` hashes to
`55c51cb61557518cca85a4e0b6543660516ccf1bf178e2e76db08474e3f7c873`.
All ten source postchecks, registration/root/VHD checks and three bounded captures
passed. Independent raw review rehashed all six logs and accepted the result.
The 5,354-byte installation stdout hashes to
`c7dc97380643a12012465ae25b3f5f73a0f9bf0c7b6412993f7a26c6d0180cb1`.

All five packages are installed at the previously verified versions with `ii`
status and empty `dpkg --verify` output. Redis UID/GID is 105/108. The server
symlink resolves to `/usr/bin/redis-check-rdb`, 2,723,512 bytes, SHA-256
`54a0ace7ff91c089ff23ee102420be96926db4bb436a50c9616440995f3dc113`.
Its version probe reports 7.0.15, jemalloc 5.3.0, 64 bits, build
`d064f9f48c901a92`. Redis CLI is 411,624 bytes, SHA-256
`b6f4c2b16f6bc3cf54e830abfe86f160e2f7b219c5e36e58368341836773aaa6`.

Dpkg stderr was nonempty and is preserved inside annotated stdout: startup was
denied by policy, and presetting the masked unit failed as intended. The reviewed
maintainer script tolerates that preset failure; dpkg returned zero. Outer
stderr was empty. Five unit masks remain `/dev/null`, observed SysV links are
all K links, and final process/listener checks show no Redis service. The only
reported TCP listener is WSL DNS on port53. Parent observed all three reported
Windows processes absent. VHD object identity remains stable while its bytes and
size legitimately changed; VM termination is not certified.

The exact A2 sources remain in the R19 local stage directory: shell
`install-redis-packages-a2.sh`, 7,625 bytes, SHA-256
`8b5a128d0ea90ce8a1caffb557c2548e110c9692b6a0c1f94fa3fa7c5bc01ceb`;
wrapper `install-redis-packages-controller-a2.ps1`, 22,829 bytes, SHA-256
`f6efb4f847a09d7dbc7c8a24c62ca3aa8d2ce1249cd9d2ac6109cab07a226fdc`.
Installation and version probing do not establish a live server, Windows
connectivity, private service issuance or application/profile acceptance.
Next launch the real supervised service, join genuine credential/connection
identity and actual readiness/RedisStore/cache consumers, then continue the
approved emitted build boundary and full-profile work.

## Explicit application startup integrated; service review still open

Canonical `29cf24b0` extracts `server/production-application.ts` with explicit
`startApplication()` and the existing static-serving setup. Ordinary
`index-prod.ts` still loads dotenv and starts automatically. General and Astra
High TypeScript reviews found no actionable defects in this bounded extraction.
Five synthetic-dependency entry tests passed, canonical `npm run check` passed,
and both real entry graphs compiled with esbuild without evaluating the app.
The ordinary output has 465 source inputs and 1,897,188 bytes; the application
output has 464 inputs and 1,897,085 bytes. These are compile-only artifacts,
not a production build/profile acceptance. The real application import remains
effectful, including transitive dotenv loading through `db.ts`.

Evidence is under canonical `.local/r20-application-entry-oct29/`; the source/log/
compile receipt hashes to
`96929923770066069403c345e850b817bd65af2a6978b2b3edce5be7bec3b5cd`.
Read `docs/plans/2026-10-29-r20-redis-app-build-boundary.md` for the selected
deferred-artifact shape and Astra's clarification: preserve the required single
identity/import-authority/ordering invariants without treating a particular
module layout as an extra requirement.

Producer A1 source review did not clear dispatch. It found possible loss of an
undrained owned subprocess followed by an incorrectly verified prelaunch cleanup
receipt, an unbounded admin socket-close wait, provider reuse before complete
cleanup, and wall-clock heartbeat freshness. Independent Python review also found
a conservative process-disappearance race in recovery. Original sources/helper/
handoff are preserved in the R19 author at
`.local/r20-installed-stage-oct28/redis-owned-a1-preserved/`; A2 repairs are under
way. No Redis service has been launched by this work. Package installation must
not be repeated.

The consumer's operations/lifetime R2 passed 30 pure tests but final review
reproduced an overdue successful result after synchronous event-loop blocking.
R3 records monotonic absolute deadlines and inherited operation budgets with
34 passing focused tests; final review and refreshed static checks are pending.
Separately, core-cache R2 resolves two general-review findings: ordinary Redis
deletion must purge older fallback Map entries, and required `has()` must refuse
instead of reading the Map. Its 29 focused tests pass, with final TypeScript
review/static refresh pending. Neither batch establishes a genuine factory,
slot, application connection or Redis persistence/runtime acceptance.

### Operations and core-cache source prerequisites integrated

Final Astra review accepted the monotonic deadline repair and strict core-cache
R2 after verifying all twelve source pins and the refreshed author static receipt
`fc011cc5f9f5fd494ecac6cdcafec0ae965039a1adaf2ad9691b5c397ce45ef0`.
The original blocked-event-loop probe now rejects and disconnects once instead
of returning an overdue success. Separate author commits `e5c0d381` and
`04d00386` were integrated canonically as `5d214e88` and `72833e53`.

All twelve canonical files match reviewed source after CRLF normalization.
Fresh canonical checks passed 34/34 operation/lifetime tests (982.009 ms),
29/29 protected unit core-cache tests across four files (4.69 s), and
`npm run check`. Evidence is in
`.local/r20-redis-consumer-integrated-oct29/{materialization.json,ops.log,core.log,check.log}`.
The new startup-entry regression is now included in `test:runtime`; the routine
suite passed 16/16 (696.656 ms), including all five new entry tests. General and
Astra reviews accepted that one-line script wiring.

This is integrated source and synthetic component evidence. The credential
prerequisite remains outside canonical until its genuine producer join; the
factory/slot, default consumer wiring, live Redis ACL and full profile remain
pending. The separate rate-limit facade is not integrated: review reproduced an
invalid-init plus Express `skip` path allowing protected `next()` despite the
failed initialization. Its repair is assigned; the original failure is preserved.

### Rate facade integrated; final service tracking repair in progress

Rate-limit R2 revokes the binding on failed/repeated initialization, including
Express's caught-init plus skip path. General and final Astra reviews accepted
the exact three-file candidate. Author `eb97e568` was integrated as canonical
`2744c2da`; normalized source matches. Fresh canonical tests passed 17/17
(266.146 ms), and static checks passed. Logs are `rate.log` and `rate-check.log`
in `.local/r20-redis-consumer-integrated-oct29/`. This tests actual libraries with
inert transport, not a real socket or application-tier wiring.

Producer A2 fixed the earlier cleanup issues, passed 24 inert JS tests and the
Python recovery regressions, and received general/Python source approval. Final
Astra review found a further concrete gap: a spawned supervisor's `error` event
was treated as exit/drain even though a failed `kill()` can emit error without
exit or close. A3 is assigned to require actual lifecycle observations and keep
ownership when cleanup cannot be proved. A2 is not cleared for dispatch.

The parent assembled a bounded nineteen-pin controller and added manifest,
projection, ownership, credential, host-object and cleanup identity joins.
The current controller A3 is 27,574 bytes, SHA-256
`37f1e5ae5ce85e03bbf626d0bc5fc6159430436e8b572c8a74db766c5d3bdca1`,
under the R19 local stage directory. Its logic review and fifteen inert identity
tests pass. A predicate-grouping defect reproduced only for its accepted Int32
function branch; the raw-JSON Int64 path did not reproduce it. Both observations
and prior sources are preserved. This controller still pins the held A2 runtime:
refresh and review its exact source vector after producer A3 freezes. No first
service execution/output exists, and no controller source approval establishes
runtime acceptance.

## First live service attempt refused; evidence preserved

The precise producer A3 error/exit/drain repair subsequently passed final Astra
review with 25 focused inert tests. General review cleared controller A4,
27,574 bytes, SHA-256
`a016d263b5c1c267ee9f493cadf5ef99c0b2a062cdde0889f56c09437260c4b6`,
including all nineteen execution pins. The actual bounded attempt then ran
against the owned distro and port55465, after fresh Windows/Linux port checks.

It failed at SERVICE/CAPTURE_SERVICE after 5,109 ms. The service child exited 1
after 1,626 ms with 643 stdout bytes, empty stderr and fully drained pipes. No
issued event appeared; the ownership file is empty. Preserve canonical
`.local/r20-redis-service-oct29a1/` unchanged:

- `first-service-a1-controller.json`, 2,832 bytes, SHA-256
  `53bcfa5a15a91af78817cb598911147edaf5c9e694246aa72569d083fdc60c2e`.
- `first-service-a1-result.json`, 642 bytes, SHA-256
  `6a63de14975d4c8579fc28156b1929a8c20306e07e71ffed1e295ef51b19e8c1`.
- Service stdout, 643 bytes, SHA-256
  `1eeea8b8852f7cc3fe85e6882e7ef44c60fafb8c64c8c301ab88bdca96295694`.

Independent review verified all six capture hashes and the result/stdout join.
The subordinate helper reports process/listener/socket/Windows-controller cleanup,
stable host identity, zero retained captures and revoked authority. Later
read-only checks found the reported Windows PIDs absent, no Windows55465 listener,
unchanged registry/root/VHD identities and all nineteen source pins matching.
These do not replace the skipped outer POST or an independent saved Linux census:
the outer failure and `linuxCleanupOnControllerFailure=UNVERIFIED` remain intact.

Source narrows the refusal to the interval after native readiness but before
public projection/credential binding. The internal cause is not retained;
Windows forwarding timing is only a hypothesis. The next repair adds fixed
nonsecret admission phases and saved nonsecret readiness/cleanup observations.
Never copy raw Redis errors, configuration, secrets or markers into logs. Do not
repeat the unchanged attempt or reinstall Redis.

A new diagnostic allocation exists at `.local/r20-redis-service-oct29a2/`, with
runId `r20redis20261029a2` and fresh Redis instance/credential references and
generation. No secrets or service were created. All certifications remain false;
other service/build declarations remain explicitly inert. Exact new input pins:

- Manifest 5,894 bytes:
  `c3c625ba64823b8700d23cac0c0e73d597f7c91d90a4552f2b38fc72d90469cf`.
- Manifest pins 601 bytes:
  `87149de0d2127255994d28c86ee0744eb06e24abe529039c9bdb004fbcf4903b`.
- Allocation scope 1,844 bytes:
  `143091606fa84501c5b8a3d8d34b6704896996c18a0cbef2332b0c5820e8c4da`.

Freeze and independently review the diagnostic source/helper and new outer
controller before dispatch. Use fresh Windows/Linux port checks; allocation
does not reserve the port. The R04 factory/slot source is separately frozen and
handed off to the runtime implementer; its positive joins remain unverified.

## Second actual attempt: Windows connection refusal isolated

General and final Astra review approved producer diagnostic A4, with 27 passing
inert tests. The closed diagnostic labels and scalar native observation allowlist
do not expose credentials, raw Redis errors or configuration and do not replace
existing admission/cleanup gates. General review then verified controller A5,
27,574 bytes, SHA-256
`e04f1e770da58e672e8c89e9c93ff22463d0e96789283865eaa832cdab12dc4a`,
all nineteen current pins and its limited allocation/source-reference delta.

The actual bounded diagnostic attempt failed SERVICE/CAPTURE_SERVICE in 4,027 ms.
The service child PID21284 exited 1 after 1,297 ms, with 995 stdout bytes and empty
stderr. All three captures exited and drained, without timeout, overflow or
capture cleanup issues. The helper records `WINDOWS_CONNECT/TCP_REFUSED`: the
first Windows TCP connection received ECONNREFUSED before AUTH, INFO, marker
validation, credential binding or service issuance. Why the connection refused
is still unproved; forwarding timing remains a hypothesis.

Preserved canonical `.local/r20-redis-service-oct29a2/` evidence:

- Controller 2,833 bytes, SHA-256
  `003925f79d000b2c368ba6c28982f100e93a95f889bcd236f1f014804caeecbe`.
- Result 994 bytes, SHA-256
  `fe8122a8d4a6d5c82d118558a7fece9e5806e0893f56bbb9503598c99acf8df7`.
- Service stdout 995 bytes, SHA-256
  `bb31376a21fac12a646b719a4907ce7262170137a2aae7789d70c7b44dd4c8aa`.

Independent review verified all six capture byte/hash joins and stdout=result+LF.
The saved native READY and STOPPED rows join PID11/start tick232; READY also records
listener inode11273, supervisor PID10, boot ID
`03823594-2dbc-4a61-9f64-66c995802743` and executable device/inode2096/49490.
STOPPED reports termination and listener closure without recovery. These support
the subordinate cleanup receipt. Independent delayed checks found capture PIDs
22304/20932/21284 absent, no Windows55465 listener, and all nineteen pins unchanged.
They do not constitute the skipped outer POST: passed=false, ownership file empty,
sourcePinsVerifiedAfter=0 and linuxCleanupOnControllerFailure=UNVERIFIED remain.

Do not rerun these unchanged bytes. The runtime implementer is investigating a
bounded pre-auth connection-readiness correction, with the failed source/evidence
preserved first. No change to host networking, exposure, ACL or credential lifetime
is implied. Settings component browser checks proceed independently in the
serialized browser/runtime window. No full profile or application acceptance.

## Third attempt: genuine issuance, shutdown acceptance still failed

Producer A5 implements bounded pre-auth connection readiness: only ECONNREFUSED
can retry, after observed socket closure, under one monotonic deadline and native
liveness/cancellation checks. No authentication or command replay is added.
General and final Astra review approved the source; 41 focused tests, syntax and
static checks passed. A4 source and the second failed packet are preserved in
the R19 local stage's `redis-owned-a4-actual2-preserved/` (23 files; receipt SHA
`71c0133ca6d275ba48d7725c7cd6690c8685d3bc1735a2a2ffc8c0ed3dbff4f1`).

General review cleared all nineteen pins in controller A6, 27,574 bytes, SHA-256
`3c7f9ef3b0d245c0735d358a7c90f84804f13114e59380d01b7a477768350392`.
One actual attempt ran with fresh allocation `.local/r20-redis-service-oct29a3/`.
It reached the genuine `owned-redis-issued` event and saved a nonempty ownership
receipt after authenticated admission. This is progress beyond the first two
attempts, not full service acceptance.

The helper then failed at STOP because endpointClosed=false. Its cleanup records
Linux PID11/start224 termination and listener closure, admin connection closure,
host identity stability and authority revocation, but cleanupVerified=false.
The outer controller failed SERVICE/CAPTURE_SERVICE after 4,751 ms; the service
child PID15484 exited1 after 2,186 ms, with 3,100 stdout bytes and empty stderr.
Captures24528/9888/15484 exited/drained without timeout or overflow. Parent delayed
observation found them absent and no Windows55465 listener; this does not change
the failed observation or replace the skipped outer POST.

Preserve the third packet unchanged:

- Controller 2,833 bytes, SHA-256
  `5633bd991c284ae5a5912ea321d0252afa176b10d85512aee7febefca639ddfd`.
- Result 968 bytes, SHA-256
  `cf485c8bf87bf60bc0d68fb53f1b6df2e9cce636caef283afd9dbd3b10654f73`.
- Ownership receipt 1,547 bytes, SHA-256
  `7ee0e71ab6736b2e98514b8dd7eb352f8db554af524906d3058f7d26bd618960`.
- Service stdout 3,100 bytes, SHA-256
  `93bc88103b7afd2f8c8115949879eb78d8b2d248bbeae16b55a99596507bc8d1`.

Independent raw adjudication is pending at this checkpoint. No unchanged rerun:
the next investigation is bounded endpoint-closure observation with every probe
socket physically closed, preserving failure if closure cannot be established.
Forwarding latency is still not an established environmental root cause.

## Fourth attempt accepted; producer prerequisites integrated

Independent review accepted the third packet as genuine issuance followed by
failed cleanup. Producer A6 then replaced the one-shot endpoint observation with
a single 750 ms monotonic closure budget. Connected probes must physically close
before a bounded retry; only ECONNREFUSED plus observed probe closure and a final
in-budget snapshot can certify closure. Timeout, other errors and unverified
closure remain failures. Fixed scalar diagnostics distinguish those outcomes.
No process, ACL, exposure or host-network configuration changed.

General and final Astra source review approved A6 and its 52 focused tests/static
checks. General review verified controller A7, 27,574 bytes, SHA-256
`f6db7820079218716c986a9b8cfc2aa57cf1b52332d97aba523fa4d2a640a9cf`,
including all nineteen source/input pins. The fresh a4 component allocation
contains no full-profile certifications.

The actual run at `.local/r20-redis-service-oct29a4/` passed POST in 5,751 ms:
genuine authenticated issuance, service/credential revocation, refusal of late
completion, no protected callback after revocation, process/socket cleanup and
19/19 post-run source pins. All four captures exited0 and drained with empty
stderr and no timeout, overflow or cleanup issue. The service capture took
2,539 ms. Linux READY/STOPPED join PID11/start241; Windows closure required six
probes and finished with TCP_REFUSED, physical probe closure and no expired budget.

Independent raw review verified two stdout events, the exact final-result line,
ownership/projection/input joins, all eight capture-log hashes, registry PRE/POST
and stable root/VHD identity fields. At 07:59:09 UTC, all five reported Windows
PIDs were absent and no Windows55465 listener remained. Preserve exact evidence:

- Controller 5,974 bytes, SHA-256
  `675136bc2bf3a707b608a3c20cbaef02f0b9449fba0cb1b015af7e6ddda2e493`.
- Result 1,690 bytes, SHA-256
  `1ee627b9a63d76fb791ead4f023e59e7c9ae62c12a99d26743b6b2083fa8f8ba`.
- Ownership 1,549 bytes, SHA-256
  `80ad1181d4a7aa21c5c7cbe9366c353ce76aa7cb19722ae993f0b518dea151d9`.
- Service stdout 3,824 bytes, SHA-256
  `a1d4a1fe30e28045ae2ff4f3cbe8c3d3ca3fb7ec8e688502429b1842da7e1f04`.

This accepts the bounded producer component only. Earlier a1/a2/a3 failures remain
failed, and no forwarding root cause or VM-exit proof is established. The factory,
slot, real application, other services, persistence and full profile were not
evaluated by this run. Do not repeat the accepted producer merely to regenerate
the same evidence.

The credential prerequisite author `ed22a851` was integrated as `a45f5e60` after
the genuine join. Seven producer files were committed in R19 as
`e2a6fe5b28df9b8fb44859fb09937d31423b56c6` and integrated as
`a9864d8e2a2f91f82ee80c9a944ee82923a8d778`. All ten normalized credential/producer
files match. Fresh canonical checks passed 52/52 focused tests (1,203.3407 ms) and
`npm run check`; evidence is `.local/r20-producer-integrated-oct29/`.

Next: the runtime implementer continues the preserved ten-file R04 factory/slot
candidate in R19, materializing its reviewed dependencies and exact archived
sources into one genuine module graph. Static/negative checks and independent
review precede any new positive factory dispatch. The parent retains actual
native windows and application/build/loader integration ownership. No fake
issuer, serialized capability adoption or cross-worktree runtime imports.

## First factory/slot attempt failed during admission A

The ten archived factory/slot files were materialized exactly into R19 after
scoped dependency commits `37496d45`, `fd76f836`, `929a379e`. General and final
Astra source review accepted them with fresh 8/8 candidate tests, 84/84 prerequisite
tests and TypeScript checking. They remain uncommitted and outside canonical.

The reviewed positive helper uses genuine producer/credential capabilities and
three distinct admissions: close A while B stays live, admit C, revoke credentials
while B and C are both live, then check terminal slot/admissions, one notification
per connection and generation-matched physical closes. Pending reads are explicitly
pre-dispatch fencing checks, not on-wire cancellation or uncertain-write evidence.
No cache/rate-store operational acceptance is claimed by this helper.

The frozen helper A2 is 14,113 bytes, SHA-256
`3d2ac221b23fa98b6451cdf72eaf4c3b8edf56fe708891323cda5cdfba904d10`.
Graph A4 is 75,326 bytes, SHA-256
`007577e9e1f8b2acec83a62a2507108c57d5b38eed342c6cfc0101709d3340e2`.
Its 107 execution inputs include 18 metadata/lock files; compile-only inputs and
recorded cold-import targets are covered. Cold import attempted zero sockets.
This inventory is component provenance, not full-profile import enforcement.

The parent controller adds nine graph/host/input/executable pins for 116 total.
General review accepted its new three-identity/close joins, strict proof flags
and inherited gates; final Astra accepted helper/graph source. Controller A1 is
49,932 bytes, SHA-256
`48de0e3a54782426ec213232c4881079f17ec978088c0557d30cf630b2974f95`.
Its parser passed, malformed invocation refused without dispatch, and 54 inert
public-receipt shape cases passed. A generator newline-anchor failure and a test
fixture variable-shadowing failure are preserved; neither launched a service.

The actual run against fresh `.local/r20-redis-service-oct29a5/` failed at
SERVICE/CAPTURE_SERVICE after 8,567 ms. The service child PID27208 exited1 after
3,359 ms, with 3,393 stdout bytes and empty stderr. Producer issuance succeeded;
the helper then refused at ADMIT_FACTORY_A before returning admission A. Preserve:

- `first-factory-a2-controller.json`, 2,833 bytes, SHA-256
  `38eb47cdc630063e9620a1678592c6d35e6f2b44b9d804e1cd4d4e797072392e`.
- Result 1,259 bytes, SHA-256
  `de9d178d3f73b76fe148062e54a0654cd32060318a5dc187881aeb69343ed6df`.
- Ownership 1,549 bytes, SHA-256
  `902b64847adb80dc02e19d61fc8e44cc13f4903d21e160830f3f2868809382d8`.
- Service stdout 3,393 bytes, SHA-256
  `d48ff74146debf2cd35dbee436664a3d4362177217d32b0cbd1e24c572bdcb00`.

Independent raw review verified event/result/ownership/input joins and all six
capture hashes. Factory cleanup says closed=true/notOpened=false: the ioredis
constructor returned, but this does not prove successful TCP connection, AUTH,
identity commands or a returned admission. No B/C, slot, readiness or fanout
acceptance follows. Producer cleanup separately passed; native PID11/start348
matches STOPPED, and endpoint refusal/physical probe closure succeeded once.
At 09:08:32 UTC the reviewer found all four checked Windows PIDs absent and no
Windows55465 listener. All 116 pins matched during delayed inspection, but outer
POST was skipped at 0/116, with null host/registry-after and controller-failure
Linux cleanup UNVERIFIED. The original failed status is unchanged.

The exact admission step is missing. The runtime implementer is preserving this
candidate/evidence and adding fixed nonsecret stage/reason diagnostics, retaining
factory cleanup separately from producer cleanup. No speculative ACL, connection,
host-policy or network repair and no unchanged retry. Fresh diagnostic allocation
`.local/r20-redis-service-oct29a6/` exists with no service, secrets or outputs:
manifest SHA `cd5176a170c09edf8fc05b1f1969f793cc73f4d9e44e1ff08f514f19d04dc40a`,
pins SHA `b6c09b8752a305b1c05f269c6eb91a33ed10f904ce4735ec8149646571c6b458`,
scope SHA `c6c14f394ecd53cd020d06ada33cf9b476ec51c3425ef1bbb54f1d33adef6af9`.
Review the changed factory/helper/graph and refreshed full controller before
the next actual diagnostic attempt. All R20 full-profile obligations remain open.

## Second factory attempt: connected client, unresolved socket-stage refusal

The diagnostic delta and controller A2 passed independent general and final
Astra source review. The actual fresh a6 attempt then failed at
ADMIT_FACTORY_A, reporting `SOCKET_CHECK/CREDENTIAL_REFUSED`. Controller A2
is 50,139 bytes, SHA-256
`5b8c58edee560064e8699330e38a4649f660aa060cd6bf9dcbae6661a1b141df`;
its 117 pins cover graph A5's 108 execution inputs and nine supporting inputs.
The diagnostic regression suite passed 14/14 before dispatch.

This narrows the failure: `await client.connect()` resolved, then a check before
private identity admission failed. It does not establish incorrect credentials.
The socket-stage checks were not recorded before the secret callback sanitized
their exception to `REDIS_CREDENTIALS_REFUSED:ACTION`. A local socket, lifetime
or lineage error can therefore receive the credential label. No speculative
credential, ACL, network or deadline change is justified.

Preserve `.local/r20-redis-service-oct29a6/first-factory-a3-*`:

- Controller: 2,834 bytes, SHA-256
  `b95743d58e4cce6bf6f9b88cd2a063a02c8560e08962e96450b9606579611387`.
- Result: 1,336 bytes, SHA-256
  `9883066072317760f5918a10b926aef0466f5f6c64a1dd4395006658fe9688bd`.
- Ownership: 1,549 bytes, SHA-256
  `37ee21266f375284006aca1f38ff66e3937ba2ca027adc735476a275a6568638`.
- Service stdout: 3,470 bytes, SHA-256
  `e5076febccbdf14058083a97736ac55fbd15bda0190e7ce4b20c002021e7610f`.

Independent raw review accepted the coherent failure record, including event,
result, ownership, manifest, allocation, projection, native-stop and six capture
hash joins. Factory cleanup reports closed=true/notOpened=false; producer cleanup
separately reports success, with matching Linux PID11/start231 and five Windows
closure probes ending in refusal and physical close. No returned admission A,
B/C, slot or factory acceptance follows. Outer POST remains 0/117, after-host and
registry observations remain null, and controller-failure Linux cleanup remains
UNVERIFIED. Delayed verification of all 117 pins is not a matching POST.

The original service Node PID26928 exited and drained according to its owned
capture; that numeric PID was later reused by BatteryDm. A later 09:58:09 UTC
inspection found checked PIDs absent and no Windows55465 listener. Neither
numeric PID reuse nor subsequent absence changes the original captured identity.

`redis_socket_diagnosis` owns preservation and bounded source diagnosis in R19.
Record local check failures before secret sanitization and repair only a proven
cause. No unchanged native retry; parent retains native/controller ownership.
All full-profile, persistence and release obligations remain open.

## Third factory attempt: endpoint equality check isolated

The diagnostic A2 source passed general and final Astra review with 17/17 focused
tests, ten syntax checks and an explicitly recorded successful TypeScript exit.
The A6 candidate was archived before edits: 146 files, preservation receipt
75,867 bytes, SHA `7bb7c0a791e509a69a8e8c40b2f761d3fc44678ed63087d7ae6e8a39aaf8c5ef`.
Source handoff `redis-factory-diagnostic-a2-review.md` is 10,300 bytes, SHA
`dcbdac3140433ff93f61aee63e59b2df4c3af23e5b91e3a0c11149e9ffe4c711`;
frozen receipt is 9,761 bytes, SHA
`8ca5fe49d36d43bb6445c51549afb8c5497bc7959acd25bd81724c078bb7a90f`.
It records local errors before secret sanitization and a fixed scalar socket
snapshot, without changing the predicate, transport, ACL, budgets or cleanup.

Parent controller A3 is 50,139 bytes, SHA
`6f126b2b66182180f8118d373378c0e030ebc5383502fedc65900b069a536162`.
Independent review verified all 117 pins and ten unchanged controller functions.
Malformed invocation refused before opening a result or dispatching any capture.
Fresh a7 actual execution then failed at ADMIT_FACTORY_A after 5,639 ms:
`SOCKET_ENDPOINT/SOCKET_REFUSED`. Preserve
`.local/r20-redis-service-oct29a7/first-factory-a4-*`:

- Controller 2,832 bytes, SHA
  `35a98d141a7c7be2fd923569fbd66b3af11e53f4c02fab887f071121306589d0`.
- Result 1,550 bytes, SHA
  `c35e50c05973f144c9825d56a489515a58c778aaf554ecb053598595ee460415`.
- Ownership 1,550 bytes, SHA
  `3d965cd6cad147e1d87dd2ba764bd98bc2b913ace5582d71bd02af8930c267d6`.
- Service stdout 3,685 bytes, SHA
  `ef146e98f93013b38ce56ae039c1e335b7c4df2f9a67a2f62d6f6eb3d1df30c1`.

Independent raw review verified all event/result/ownership/native-stop joins and
six capture hashes. Post-connect lifetime, stream-observation and authority
checks completed before the endpoint equality guard refused. The snapshot records
one current observed Socket, destroyed=false and clientStatus=ready, with both
remoteAddressMatches and remotePortMatches false. This does not distinguish absent
metadata from a different peer. Pinned ioredis resolves connect on ready without
awaiting AUTH in this configuration; neither ready nor this snapshot proves
authentication. Private SELECT/INFO/WHOAMI/marker checks were never reached.

Factory and producer subordinate cleanup report success, including matching
Linux PID11/start211 and six bounded Windows probes ending in refusal/physical
closure. Original capture PIDs976/19588/32448 exited and drained; at 10:13:41 UTC
the reviewer observed no checked PID occupants and no Windows55465 listener.
Outer POST remains skipped at 0/117, after-host/registry are null and its failure
cleanup label remains UNVERIFIED. Delayed 117-pin matches are not a matching POST.
No returned admission or slot acceptance follows. The runtime worker now diagnoses
socket metadata using bounded local synthetic transport tests if necessary;
no unchanged native retry or relaxed endpoint guard is authorized by this record.

## Genuine factory/slot component accepted after socket-option repair

Local synthetic probes isolated the endpoint metadata failure on the pinned
Node24.22.0 Windows ARM64 runtime: `setNoDelay(true)` invoked in a connector
resolution microtask while TCP connect is pending produced an empty peer address
and undefined peer port, including through the native getter. Immediate invocation,
omitting that call, and invocation after connect preserved metadata. The actual
ioredis constructor options reproduced the failed strict check despite successful
synthetic AUTH/PING. These observations do not assert a defect on other runtimes.

The sole production behavior change is explicit `noDelay: false`, avoiding that
pre-connect call and retaining Nagle. No peer, private identity, ACL, retry,
lifetime, deadline or cleanup guard was relaxed. Meaningful RED then 18/18 GREEN,
eleven syntax checks and TypeScript passed. General and final Astra reviews
accepted the source/helper; general review separately accepted controller A4.
Handoff `redis-factory-nodelay-a1-review.md` is 10,497 bytes, SHA
`3d82db2a73667a54587f855e31885e42fa70fccbd11a8127efaae84531abac1e`;
frozen receipt is 17,192 bytes, SHA
`2323a733cad120b97f55058cdacc8f9042df7640f6f72e2960ff99368049ee13`.

Fresh a8 execution passed in 7,955 ms with actual POST117/117, consistent host
object identities/registry, four exited/drained captures and empty stderr.
Service execution took 2,747 ms within the unchanged budgets. Preserve
`.local/r20-redis-service-oct29a8/first-factory-a5-*`:

- Controller 8,590 bytes, SHA
  `639eca29471b65bdd077d7c82e8c1c6ae90fe16963056a26f8d5d7f68f70e3aa`.
- Result 4,304 bytes, SHA
  `ca4198738f04c61cd1b56591d79ae6eeed69c65047de42f00a4a945bf4653633`.
- Ownership 1,549 bytes, SHA
  `a8ea8eb8ae66bfe385b2805f3e3f61383d2a825c579ecf9a4333f743d70a45ec`.
- Service stdout 6,438 bytes, SHA
  `982155c7dda135e7f14163aa9f3e65e24c5b5ccdfc4a5c62b975782950835cf3`.

Independent raw review accepted eight capture hashes, exact event/result/outer
packet joins, ownership/manifest/credential/service lineage, three distinct
connection generations and both physical-close arrays. The genuine same-socket
SELECT/INFO/WHOAMI/marker admission and readiness succeeded. Slot replacement was
refused; closing A left B live; shared-credential revocation fenced simultaneously
live B/C, each notified once; the slot became terminal and could not reinstall.
All three connections closed. Producer revocation/cleanup passed, with matching
Linux PID11/start262 and seven bounded Windows closure probes ending in refusal
and physical close. At 10:37:10 UTC the reviewer observed the recorded Windows
processes absent and no Windows55465 listener.

This accepts factory/slot component evidence only. The pending operations were
fenced before dispatch, not cancelled on wire; cache/rate-store operations,
ordinary application loading, full profile, persistence, VM exit and release
remain unverified. Prior a5/a6/a7 failures remain failed. Do not repeat accepted
producer/factory/native-addon components without a changed requirement. The author
is preserving the accepted execution packet and preparing the thirteen reviewed
source files for scoped local integration; the build/application boundary is next.

The author preserved the accepted A8 packet before commit under
`.local/r20-installed-stage-oct28/redis-factory-slot-a5-accepted4-preserved/`:
174 files, receipt 91,807 bytes, SHA
`5006dbb9b04930b9d71c5c8c1828642839de42bd8fd3a627f8023b9f0e09817e`.
Thirteen source files were committed in R19 as
`88588c842d3902ca43889743712d19caa54b7f52` and integrated canonically as
`efc490ed0f38cd9ed3b96a682e39a4abdcb6ebff`. All thirteen normalized sources match.
Fresh canonical verification passed 18/18 tests (1,929.0233 ms) and `npm run check`,
both exit0, under `.local/r20-factory-integrated-oct29/` with result and parity
receipts. These local integration checks do not replace or broaden A8's native
component evidence. The application/build/loader boundary remains the next task.

## Redis consumer application joins and local verification, 29 October

The canonical working-tree candidate now connects the admitted profile to the
ordinary Redis consumers. `server/config/redis.ts` does not construct the
ordinary client after profile admission; cache and quota helpers use the
profile's cache/quota facades, while the seven rate-limit tiers use the
production rate-limit facade. Core and analytics cache singletons receive the
profile cache, readiness uses the profile probe, and environment validation
accepts the profile only while its slot remains current. A stale slot refuses
even when `REDIS_URL` is set.

The job lock and AI-cache cases received explicit fail-closed dispositions.
Snapshot work refuses under the admitted profile because the profile does not
provide the scheduler's lock contract; it cannot run unlocked through a null
ordinary client. The profile's AI cache deliberately does not use the shared
`ai:*` Redis namespace: reads miss, writes are no-ops, and invalidation does not
call ordinary Redis. The AI tool execution path remains available and its
sanitization regression verifies a cacheable spending tool still fetches and
returns data. This is a safe no-cache behavior for this profile, not evidence
that an identity-scoped AI cache has been implemented.

The final focused protected run passed 21 test files / 174 tests. The exact log
and exit receipt are in
`.local/r20-redis-consumer-oct29-final/focused-tests.log` and
`focused-tests.exit`. `npm run check` passed with pinned Node 24.22.0, including
TypeScript, storage-import, LOC, Node-tool syntax, module metadata/status, W9,
and W10 checks; `git diff --check` also passed. Logs and exit receipts are in
the same directory. An initial `npm run check` invocation resolved Node
22.23.2 and stopped at the repository runtime guard before source checks; that
failure is preserved in `check.log` and `check.exit`, and the corrected
Node 24.22.0 run is preserved separately. Diagnostic RED outcomes from earlier
implementation iterations are summarized in
`development-failure-summary.md`; raw output for those individual RED runs was
not saved.

The production build passed with pinned Node 24.22.0. Its generated server
bundle `dist/index.js` is 1,910,085 bytes, SHA-256
`53d0676a79cef861ac49140eb808ff49f488e1bf816973c8c96b374c9131e8cb`. Static
inspection confirms that the bundle contains `readInstalledProductionRedis`,
the refused-slot path, and the consumer module's `productionRedis` read. This
establishes build inclusion only; no installed bootstrap or full application
profile was launched from that bundle.

The separately emitted application entry was also regenerated from the same
candidate with `packages: external`, compile-only, in
`.local/r20-application-entry-current-oct29/`. It is 1,909,982 bytes, SHA-256
`d73132f683e65667a37460761daba9aca4aff386c09af7132161683f88352c3b`, with 483
inputs. The metafile lists
`server/config/redis/production-slot-state.mjs` as an internal bundled input;
the application output contains its own `never-installed` cell. Separately,
`production-slot-bootstrap.mjs` re-exports the installer from that same source
module. If a trusted bootstrap loads its own copy while the application entry
bundles another copy, the installer and consumers will address different cells.
No current staged consumer proves that both sides share one module identity or
that profile admission reaches this app entry. This is an unresolved authority
boundary, not a runtime test failure. The existing 16/16 runtime suite tests
the synthetic entry behavior only; it does not prove slot identity. The logs,
output and metafile are retained under `.local/r20-application-entry-current-oct29/`.

No packaging or shared-cell architecture change was made from this Luna
checkpoint. Resolving whether to externalize and stage the cell or use another
reviewed mechanism changes the trusted application authority boundary and needs
the Astra High checkpoint in the governing plan. At that checkpoint the model
call failed as unsupported; the availability retry and subsequent review are
recorded below. No app-runtime launch followed the failed model call.

An independent Luna Extra High source review found no actionable defect in the
profile-local AI no-cache disposition or its direct cache tests. The reviewer
did not run tests. Astra final review was outstanding at that checkpoint after
the unsupported-model failure. Source changes were still
uncommitted on canonical HEAD `e161afeb`; this is not Astra approval or an
integrated release candidate.

The local disposable PostgreSQL target is allocated only at
`127.0.0.1:55432` from `.local/completion-pg`; its current process state must be
rechecked before any use. Absence of Redis listeners on6379/6380 does not imply
absence of an owned Redis capability: prior A8 used55465. No real Redis
application launch, persistence/browser journey,
staging test, shared-database write, or release action was performed. The next
application-runtime step therefore remains gated on resolving the shared-cell
build boundary, Astra review availability, an owned real Redis runtime, and the
existing installed-stage controls. All 101 master closure groups remain OPEN.

## Astra checkpoint restored and implementation allocation

After the tool/model availability refresh, a single bounded retry successfully
ran `r20_astra_boundary_review` using Astra High. It accepted the external
module-preserving graph direction and rejected the current bundle for profile
launch. The concrete contract is
`docs/plans/2026-10-29-r20-application-module-identity.md`: one canonical staged
getter/cell/admission/issuer graph, explicit TS dependency emission, parent-edge
loader controls, deferred application evaluation and unchanged one-shot
revocation semantics. This is architecture acceptance, not final source,
installed-loading, runtime or release acceptance.

A separate Luna Extra High consumer review raised a HIGH finding: admitted
Redis passes environment/health checks while all required scheduled jobs lack
their lock capability. Astra upheld it. The required correction is startup
refusal before cron registration plus required-jobs readiness/startup503, even
with successful DB/Redis probes or a supplied ordinary REDIS_URL. Operation
guards remain; no job-disabling mode or substitute lock is authorized here.

Two Luna Extra High implementers have separate ownership: `r20_profile_emitter`
owns only the new compile-only emitter/helpers/build tests;
`r20_required_jobs` owns Redis capability assertion, validation, scheduler,
health and their focused tests. Parent retains documentation, broad testing,
review and integration. Their implementation/results are not yet accepted by
this allocation record. Existing Sharp/GeoIP component acceptance remains
separate; full application success is held until required capabilities exist.

## Accepted consumer source integration

Astra High final source review verified all23 path hashes/sizes in
`.local/r20-profile-build-oct29/consumer-source-freeze.json` (SHA-256
`ca94dd0ad88307ffa0f3644839653e6631e41212119897d724435541c9103ec4`) and
accepted only that scope for local integration. The parent committed those
exact paths as `0feb5a22` (`fix(runtime): bind Redis consumers and reject missing
job capabilities`). Emitter and R05 files were excluded.

The missing-job correction passed6files/33tests. Astra identified an existing
R19 log-callsite mock lacking the new exports; the parent added explicit
ordinary-mode `productionRedis: null` and the no-op capability assertion without
changing its logging assertions. Its protected run passed9/9. Current canonical
`npm run check` passed under Node24.22.0. These results and the preceding174-test
consumer run are distinct checkpoints; the174 result predates the job correction.
Raw outputs are under `.local/r20-required-jobs-oct29/` and
`.local/r20-profile-build-oct29/check-parent1.log` with its exit receipt.

Current admitted-profile startup intentionally refuses because required job
locks remain unavailable; readiness/startup return503 and liveness is unchanged.
This is accepted honest refusal behavior, not provision of lock capability,
full-profile readiness, persistence/browser acceptance or release approval.

The compile-only emitter remains unintegrated. Independent review corrected
silent tsconfig failures, an optional trusted-member declaration, and source
hashes reread after compilation. Parent then found that the default still
selected the ordinary auto-start `server/index-prod.ts` instead of the deferred
`server/production-application.ts`. Earlier10/15-test and actual compile records
are preserved as superseded candidates; their output was never evaluated.
Entry correction and final emitter review remain pending.

## Accepted compile-only emitter integration

The entry and graph-edge corrections subsequently passed review. The default
is the deferred `server/production-application.ts`; a regression includes a
poisoned ordinary entry to distinguish them. A shared relative-specifier
function now makes the emitted trusted import literals match the recorded
parent/specifier/target edges, including static/dynamic TypeScript-to-MJS
mapping. Independent general/TypeScript and Astra High follow-ups accepted the
four frozen emitter files for source-only local integration. They were committed
as `fd02b281` (`build(runtime): emit deferred application with a pinned Redis
module graph`). No ordinary build/start command changed.

The final focused build suite passed17/17 under Node24.22.0. The parent then
executed the corrected CLI into the fresh
`.local/r20-profile-build-oct29/emission-final/` directory and independently
read back all23 output hashes/sizes plus the graph file; there were no extra
files. This is inert emitted-file verification, not trusted installed staging,
custody or loader acceptance. No emitted module was evaluated.

- Graph digest: `c6562d9ca21af13943ccb6d0236952f1227187b31b5aa13fe51853779f47910f`.
- Application:1,907,166bytes, SHA-256 `db5bc7a9ed6013e7faa3e2d26dd6fd849f87d8fed6dd52ed9a262d620427ad7e`.
- Application compiler inputs:467; one fixed getter edge; trusted modules:22,
  including the emitted Redis-readiness TypeScript module.
- Readback/source-pin receipt:
  `.local/r20-profile-build-oct29/final-emission-readback.json`, SHA-256
  `88cf58d0cc33dfa1de122e4a02cf0241dd98faeb91fa58f1b0a66811ffcb8563`.
- Raw evidence: `tests-profile-review5-final.log/.exit`,
  `emit-profile-review5-final.log/.exit`, `emit-parent-final.log/.exit`, and
  `syntax-final.log/.exit` in the same evidence directory.

Limits are explicit: the compiler-source bytes are captured, but tsconfig and
inherited configuration bytes are not fully pinned in provenance. Authority
copy detection covers configured paths and identical bytes, not semantically
altered copies. The declared graph grants no execution/producer authority.
Earlier wrong-entry and mismatched-edge packets remain preserved as superseded.

Next: explicitly join this application graph to package inventory and a
separately identified stage/loader/bootstrap contract. Existing Sharp/GeoIP
stage and component-loader acceptance cannot authorize these application
edges. Preserve the required-job startup refusal until its missing capability
is implemented under R14/R19. No full-profile, persistence or release claim.

## Application package preparation, after source integration

A bounded read-only map confirmed that `runtime-resolution.mjs` validates the
old `server/index-prod.ts` metafile and `runtime-package-tree.mjs` binds package
reachability to that root inventory. `installed-runtime-stage.mjs` remains
specific to the accepted Sharp/GeoIP component. Their existing brands cannot
be reused as proof that the deferred application's external imports resolve.
The next application-root inventory contract requires Astra review before a
new branded reader or stage consumer is implemented; the accepted emitter
contract alone is not that approval.

The coordinator prepared inert data at
`.local/r20-profile-build-oct29/application-package-preparation.json`, SHA-256
`533689468b84603b1e5250134957a705f82557e2ff06e0a2bdcf7580d87cc67b`.
It records 41 distinct parent/kind/package-specifier rows, with occurrence
counts, from the emitted application and trusted graph. Builtins and the
internal getter edge are excluded. All package names occur somewhere in the
historical package tree; this is only a name-membership comparison. No row
has an observed application-root resolution or resolved file, and all closure
statuses remain pending. No code was evaluated or staged.

The historical tree is
`.local/r20-installed-controls-oct28/installed-package-tree-candidate-c1.jsonl`,
SHA-256 `ec9538190465c1efb4e88a4f2f157f4e82d70224c1f0a36aee804d2922ba2127`,
bound to build `e47d53cdb18eaf29fc56a2ce117ea4fe07f31bde`. The preparation artifact
pins that file and the emitted graph bytes separately and explicitly grants
no application resolution, stage, custody or execution authority. Package-name
membership does not prove package subpath exports, import conditions, physical
file identity, current installed bytes, transitive closure or loading safety.

## Application-root inventory architecture accepted,30 October2026

The designated Astra High checkpoint `r20_application_inventory_checkpoint`
completed a fresh source-only review at canonical545c3004. It accepts a separate
closed-schema application declaration reader, inert candidate collector and
literal-ESM resolution observer. Read
`APPLICATION-ROOT-INVENTORY-DECISION.md`, SHA256
`a9eceea4bc2cb92104507cecf82d50f176c2efa7a56ff77de1ffd4447915592a`,
before implementation. It supplies exact parent/kind/specifier binding, runtime
and condition policy, physical identity/lookup-footprint checks, disjoint brands,
bounded schemas and meaningful negative tests. Unsupported observations must
remain explicit blockers; no component brand is promoted to application authority.

Astra reread the historical preparation/graph pins and found zero drift across
489 declared source rows and23 emitted outputs. This does not complete the missing
compiler-configuration provenance or grant execution authority. No tests, services,
resolver observation, package evaluation or dependency changes were performed by
the reviewer. Next implementable source is the new reader and its synthetic
regressions, followed by the observer only within the accepted contract.

Application package-tree/stage/custody/loader/bootstrap and actual full-profile
journeys remain later gates. Required job-lock startup refusal stays mandatory.
This architecture checkpoint does not approve unimplemented source or waive
independent review and final Astra assessment before integration.
