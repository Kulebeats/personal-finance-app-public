# R02 mail readiness and bounded component proposal

**Disposition: standalone component implementation deferred by parent, 28 October
2026; independent readback and parent documentation review completed.** This is
documentation acceptance only, with no implementation or runtime acceptance.
Prioritize the shared full-profile
dependency/resolution/custody contract, then anonymous-CSRF proof, with sink/MIME
work allocated directly against that profile. The detailed alternative below is
retained for review history and possible future diagnostic need, not immediate
implementation.
Source baseline: `8dd829a9156f287a4b65a13cb062eaec425bc7e3`, branch
`codex/capital-r02-mail-readiness`, isolated
`C:\Users\USER\.codex\worktrees\capital-r19-foundation\personal-finance-app`.
Governing allocation: canonical
`docs/plans/2026-10-28-r02-defaults-and-mail-execution.md`.
Only this file and `R02/FRESH-BROWSER-PROOF-CONTRACT.md` are authored here.
No code, package, runtime profile, test, listener, DB, SMTP/network or provider
action accompanies this draft. No execution result or group closure is claimed.

## Decision to adjudicate

One alternative is a distinct **`pfa-mail-component-v1`** component that compiles the actual
`sendEmail` implementation and its three local helpers, then calls it with one
synthetic in-memory message in an isolated `NODE_ENV=production` child. Capture
its actual SMTP envelope and MIME at an owned, authenticated `127.0.0.1` sink.
Use explicit **plaintext loopback with AUTH PLAIN**, `SMTP_SECURE=false` and no
advertised STARTTLS. This is a local synthetic transport policy for this component
only; it makes no native TLS or credential confidentiality claim. The existing
service exposes no CA option. This choice needs neither application changes nor
`ignoreTLS`, a transporter replacement, or `rejectUnauthorized:false`.

Existing tests mock mail or call Nodemailer directly, so this component could
add evidence that the real service configures and uses
SMTP, transmits its real composed MIME, returns the observed outcome and emits
sanitized logs under the selected local policy. It cannot establish registration
issuance/templates, token persistence, auth/public route reachability, browser
consumption, cookie/CSRF/limiter behavior, hosted inbox delivery or full R02/J01.
The auth email service is deliberately outside this import graph because it
imports DB-backed token issuance/consumption.

The component must not consume or modify `local-production-v1` manifests. Their
fixed mail-disabled policy and false `runtimeDependencyIdentity` /
`executionAuthorized` certifications remain intact. Component acceptance cannot
change them. No SMTP endpoint may be appended to an old manifest. Full application
execution still requires its separately reviewed new contract/version.

## Alternatives, cost and critical-path value

**Parent decision: defer the seven-file service component and prioritize the
shared full-application dependency/runtime custody contract.** The component is
not necessary to unlock R02: after the real application is safely releasable,
registration can exercise the same emailService directly against the reviewed
sink and supply actual auth-template/issuance evidence. Its isolated CJS success
would clear none of the current full-profile launch, Redis, native HTTPS or
anonymous-CSRF gates. No observed transport defect currently makes this separate
diagnostic build a prerequisite.

| Alternative | Value toward actual R02 proof | Cost and disposition |
|---|---|---|
| Shared application dependency/runtime contract first | Addresses the existing hard launch refusal; actual installed bytes/resolution/custody and deployed build identity benefit the whole combined profile | Broader work but required regardless; prioritize this reviewed contract, with source-only Redis/CSRF planning independent where useful |
| Fit authenticated SMTP sink and MIME/evidence adapters into that shared profile | Directly supports actual registration mail and fresh-browser consumption under one accepted runtime/egress contract | Prefer after the shared interfaces are concrete; assign exact files and native slots separately rather than build another launcher |
| Seven-file isolated service/CJS component described below | Narrows uncertainty about service configuration, SMTP composition and logs only | Adds a compiler projection, loader/custody policy, process/env guard and lifecycle to maintain/review without removing a full-profile blocker; defer unless parent identifies a specific transport question whose answer changes the next R02 action |

The bounded AUTH sink, single SMTP transparency decoder, MIME semantic oracle and
sanitized event/redaction rules are potentially reusable in the eventual full
profile, subject to matching its process/transport interfaces and fresh acceptance.
Their present design is reusable preparation, not accepted code. The separate CJS
projection/compiler inventory, four-file loader and single-service child are
specific to this alternative and do not attest the production bundle or full app
dependency graph; they would likely duplicate or be discarded by that work. The
component's environment/egress concepts may inform the shared contract, but its
mail-only guard cannot substitute for combined browser/API/PG/Redis/mail routing.

The seven-file detail below is retained as a **deferred alternative**, not the
default next allocation or an instruction to implement. Parent acceptance requires
both demonstrated critical-path value and a feasible reviewed custody/control
mechanism. Reusable sink/parser work alone also needs a concrete shared-interface
fit and separate exact-file amendment. Documentation preparation does not justify
building an elaborate harness merely because it can execute independently.

## Current source, refreshed rather than inherited

| Local source at baseline | Verified source observation | Remaining proof |
|---|---|---|
| `server/core/public-auth-link.ts:2`; `server/modules/auth/auth.email.service.ts:39,69`; `server/services/emailService.ts:143,203` | Canonical verification/reset paths use the shared public-origin builder; production rejects absent, non-HTTPS or non-origin APP_URL | Actual auth-generated message MIME and exact emitted link are uncaptured |
| `server/routes/auth-email-link.ts:6`; `server/app.ts:136`; `client/src/App.tsx:86,116` | Legacy server302 precedes sessions; canonical and legacy client routes exist | Real native-HTTPS redirect/page/request chain |
| `client/src/pages/VerifyEmail.tsx:30,67,108`; `client/src/hooks/useSecurity.ts:140` | Token captured once and removed from location; public email-input resend, generic wording and explicit sign-in action are implemented | Non-test anonymous consume, same visitor identity and one-use behavior |
| `server/auth.ts:27`; `server/middleware/householdGuard.ts`; `client/src/components/session/SessionBoundary.tsx:111`; `client/src/lib/session.ts` | Verified server/session preconditions and client state/lifetime boundaries exist; checkpoint acceptance is separately recorded in `SESSION-ACCESS-ACCEPTANCE.md` | Carry these controls through the captured-mail full profile; ordinary regression acceptance does not certify production CSRF/cookies |
| `server/services/emailService.ts:31-65,81-124` | Test mode disables config; host/user/pass required; port defaults587, secure is true only for exact `true`; SMTP_FROM required; private transporter cached; sendMail sets disableFileAccess/disableUrlAccess; boolean return catches failures | Explicit complete config, real service send, authenticated sink DATA and observed bounded failure |
| `server/utils/logger.ts:1-3,54-94`; `server/utils/log-redaction.ts:15-48` | Logger imports Express names used only as types; emits static service event messages, context allowlist and safe error name/code | Emitted import graph must erase Express; sentinel proof must cover actual stdout/stderr and failure evidence |
| `scripts/__tests__/dependencies.test.mjs:57-109` | Existing plain TCP fixture calls Nodemailer directly with ignoreTLS; no AUTH; streamTransport fixture composes MIME only | It is an idea for protocol framing, not the proposed app-service proof; do not execute/import this broad suite here |
| `package-lock.json:9885`; local `node_modules/nodemailer/package.json:3,21` | Lock and installed metadata report Nodemailer10.1.1; package has ESM and CJS exports and no declared runtime package dependencies | Matching metadata is not installed-byte/custody attestation |
| Local `node_modules/nodemailer/dist/cjs/nodemailer.js`, `sendmail-transport/index.js`, `fetch/index.js`, `smtp-connection/index.js` | Entry eagerly loads multiple transport families, including dormant spawn/HTTP/TLS paths; SMTP can use AUTH PLAIN | Restrict actual bytes/resolution and every dispatch capability; selecting SMTP alone is insufficient |

## Exact proposed implementation ownership

All paths below are **new proposals**, not existing tools or assigned authority.
The parent amendment must assign them explicitly before implementation. Preserve
all app/auth/DB/session/production-profile/ordinary-test source and package files.

| Proposed file | Sole responsibility |
|---|---|
| `server/testing/mail-component/contract.mjs` | Closed-schema, versioned public controls/caller pins; immutable role records with private in-memory identity; no environment, network, import or secret resolution |
| `server/testing/mail-component/runner.mjs` | Reviewed filesystem/dependency capture and TypeScript projection, create-only absent stage, source/output/resolution verification, endpoint ownership, role lifecycle, bounded serial child launch, redacted evidence and cleanup |
| `server/testing/mail-component/guard.cjs` | First child code before service load: import allowlist and actual-byte checks, role-bound socket/egress/listen/file/process controls, immutable control checks and static refusal events |
| `server/testing/mail-component/smtp-sink.mjs` | Strict bounded TCP/AUTH/envelope/DATA state machine; in-memory capture; no relay, TLS, DNS, file or provider operation |
| `server/testing/mail-component/mime.mjs` | Independent bounded MIME decoding/semantic comparison and evidence projection, not mail composition or delivery |
| `server/testing/mail-component/service-child.cjs` | Receive one private ephemeral input, require guarded staged real service, invoke sendEmail once, emit only allowlisted outcome, exit; no app/auth/DB imports |
| `server/testing/mail-component/mail-component.regression.mjs` | Pure refusal/parser controls plus separately allocated native role/SMTP negatives; no broad app suite or test-mode claim |

No production source repair is proposed. If projected imports or Nodemailer
behavior make this exact graph infeasible, return the concrete finding for
adjudication. Do not add a loader bypass, stub logger, dependency, transport
injection or production edit to make it run.

## Dependency, source and import custody

1. Parent assigns one absent physical run root and a trusted snapshot owner. Pin
   the exact source/harness commit and hashes of these seven harness files,
   package.json, lockfile and the four production files:
   `server/services/emailService.ts`, `server/utils/logger.ts`,
   `server/utils/log-redaction.ts`, `server/core/public-auth-link.ts`.
   Verify source parity before staging and again at completion. No `.env`, auth,
   database, application bootstrap or unrelated source enters the stage.
2. Compile those four byte-identical sources only with the existing installed
   TypeScript5.6.3 `transpileModule`, pinned `lib/typescript.js` and metadata,
   `module=CommonJS`, `target=ES2020`, `esModuleInterop=true`, no source maps,
   no import-preservation option. Stage mirrored `server/.../*.js` paths beneath
   a generated pinned `{ "type": "commonjs" }` package file. No import/string
   substitutions, bundler aliases, mock exports, tsx loader or app tsconfig hooks.
   Capture compiler bytes and diagnostics as part of preparation; fail on any
   diagnostic or unexpected emitted dependency. In particular, logger's Express
   type-use import must disappear. This emission is a bounded component build,
   not parity with the deployable esbuild application bundle.
3. Snapshot the actual installed Nodemailer package metadata and complete
   `dist/cjs` runtime bytes under staged `node_modules/nodemailer`, including its
   `dist/cjs/package.json`. Preserve package export/require resolution. Inspect
   and enumerate the actual closure, including any additional data file it needs,
   before authorizing execution; reject an unreviewed added file rather than
   widening a directory allowlist. Pin every loaded JS/JSON file, content length,
   normalized stage-relative path and final resolved real path; exact-file load
   guard rejects fallthrough outside this snapshot. No package installation,
   lifecycle script, cache repair, global resolution, NODE_PATH or NODE_OPTIONS.
   The loader must compile/parse the same opened, hashed JS/JSON bytes it checked,
   without handing the filename to a later unchecked reopen. A load-time digest
   followed by Node reopening a mutable path is insufficient.
4. Source/lock hashes do not authenticate installed bytes. Obtain the actual-byte
   inventory through a trusted preparer independent of the service child; parent
   and reviewer bind it to the protected snapshot they inspected. Refuse links,
   junctions/reparse paths, hardlink aliases or inherited writable shared stages.
   Enforce exclusive custody/no concurrent writers for preparation through child
   exit, with descriptor/readback and adjacent identity checks. If Windows native
   reopening/custody cannot be established, stop before code import; two matching
   path hashes alone do not prove absence of a replacement race.
5. First child code installs guards and a closed CommonJS resolution/load policy.
   It admits only the projected four sources, exact reviewed Nodemailer files,
   exact harness files and enumerated Node builtins from the pinned Node24.22.0
   executable. Required dormant builtins may load only behind denied capabilities
   (e.g. child_process can be imported by sendmail but cannot spawn). No native
   addons, arbitrary dynamic import/require, eval-created module loader, workers,
   app, Express, auth, storage, pg, ioredis, dotenv or provider package loads.
   A forbidden import must refuse before that module's first statement.

The preparer/compiler is a separate guarded, offline phase and exits before SMTP
allocation. Its larger filesystem/tool capability is never inherited by the mail
child. The child loads only attested emitted bytes and the staged runtime package;
the compiler itself is absent from its allowed graph. The later amendment must
pin actual runtime/compiler/files/custody evidence; none is asserted here.

## Run allocation and immutable transport controls

The amendment must name the new absent run root, unique run ID, reviewer, pinned
Node executable/hash, exact harness/production/dependency inventories and an
explicit unused numeric sink port. No default port, port0, localhost, IPv6 alias,
wildcard, named pipe, socket path, inherited descriptor, listener adoption or old
native-PG/browser allocation. Parent checks absence and owns the new listening
process. Address readback must equal `127.0.0.1:<allocated-port>` and match the
owned process before service import. No DB or Redis target is allocated.
The native-negative amendment must also name one distinct owned numeric-loopback
canary endpoint and observer/control role. It stays forbidden to the service
child; only that separate probe role may make the live observability control.
Include these probe connections in the fixed allocation budget. Never use an
ambient unrelated listener or contact a real forbidden external destination.

Freeze closed public controls before any secret or source load: component/version,
run ID, physical roots/file pins, endpoint, role IDs, recipient policy, bounds,
scenario set and approval reference. Consumers require the private original
validated record; copied, forged, mutated, extra-field or stale-run records fail.
Each process revalidates the exact allocation bytes against its independently
supplied caller pins and creates its own private branded record; an IPC JSON copy
does not transport or establish the original in-memory brand.
Public records contain **no executionAuthorized override** and no serializable
password, challenge, raw MIME or credential hash. Parent authorization remains a
separate exact allocation, never a truthy caller field.

Create a fresh environment from an allowlist, never from ambient process.env.
Pin NODE_ENV=production, TZ=UTC, APP_URL=CLIENT_URL to one inert synthetic HTTPS
origin, SMTP_HOST=127.0.0.1, the exact SMTP_PORT, SMTP_SECURE=false and exact
SMTP_FROM. Generate the run-only user/password in memory and convey them on a
private one-use IPC capability; materialize only in that isolated child's env
before the guarded module load. Nothing secret is in argv or persistent manifest.
No SESSION_SECRET, DATABASE_URL, Redis/provider/push credentials, proxy variables,
Ethereal controls, TLS bypass settings or debug/preload flags may be inherited.

The child's reviewed bootstrap makes its complete environment snapshot read-only
before importing the service; prove that mechanism on the pinned Node in a pure
negative control before granting sockets. Independently recheck transport values
at every dispatch against immutable controls. Do not freeze or intercept the
Nodemailer transporter itself, change getTransporter, replace sendMail, inject
timeouts/ignoreTLS/plugins, or alter service return values. Cached transporter
state cannot escape its single-use child; exit destroys it. If env immutability
cannot be enforced, withhold native execution and adjudicate the mechanism.

Use separate guarded roles. Runner may start only its exact pinned children; sink
may listen only at its allocation and may not connect anywhere; service child may
connect only once to that numeric sink and may not listen. Deny TLS/STARTTLS,
HTTP(S)/fetch/WebSocket, DNS destination resolution, UDP, proxies, alternate
loopback ports, pipes, preconnected/lookup/handle overrides, subprocesses, worker
threads and native addons before untrusted dependency imports. Cover direct
Socket/connect and module aliases, not just high-level send calls. Numeric isIP
checks needed by Nodemailer may remain pure; hostname lookups must refuse.
File reads are limited to the attested loader graph, with no attachment/file/URL
capability. Keep saved native methods private to the owning bootstrap and sync
builtin exports before dependency load. This is a reviewed trusted-code boundary,
not a claim of hostile-code/OS sandbox isolation.

## Sink, recipient and MIME contract

One exact sender `sender@<runId>.example.invalid` and one exact recipient
`recipient@<runId>.example.invalid` are permitted. Match the complete ASCII
envelope addresses, not a suffix or display-name string. Reject multiple/empty
recipients, header injection, CC/BCC, alternate domain, address literals, SMTPUTF8,
forwarding/relay or further delivery. Validate expected From/To MIME semantics
after DATA as well as the SMTP envelope; do not claim sink RCPT policy is a
production recipient restriction. The generic sendEmail API itself has no such
production restriction.

Proposed fixed maxima:16 serial service children,24 TCP connections per allocation,
one concurrent connection, one message and one recipient per child, two accepted
complete positive messages total;64KiB DATA bytes,8KiB aggregate headers,64 headers,
4KiB command line,1KiB AUTH payload,1KiB non-DATA receive remainder. Command/DATA
limits use byte counts before string conversion. DATA is incrementally framed and
bounded rather than allowed to grow in an unbounded pending buffer. A decoded
UTF-8 part is at most32KiB, maximum two body parts, no nested multipart/attachment.
Timeouts:3s connect/greeting/auth,3s idle,10s connection,15s per child,5min entire
allocation. Parent kills only owned expired children/sockets and records failure;
no service SMTP timeout is silently changed.

Sink grammar:220 greeting; bounded EHLO name;250 AUTH PLAIN and SIZE65536 only;
valid AUTH before MAIL, one MAIL then one allowed RCPT then DATA, bounded CRLF
framing and terminator detection, explicit250 only after complete capture and checks; QUIT/221,
bounded RSET as defined by the fixed state machine. No STARTTLS, LOGIN/OAuth,
pipelining, VRFY/EXPN or permissive “250 any command” behavior. Strict base64
PLAIN decodes to empty authzid/NUL/exact synthetic user/NUL/exact password; reject
wrong/replayed state or malformed payload with static535 and no accepted DATA.
Never retain/log AUTH lines or base64 credentials. Bound comparisons and use
timing-safe equal-length credential comparison. Unexpected commands/state or any
limit violation close the socket and fail the expected-positive case.

The sink alone performs SMTP transparency removal, exactly once. It recognizes
the complete `.<CRLF>` terminator line across arbitrary TCP chunk boundaries and
excludes that line; for each preceding DATA line it removes exactly one stuffed
leading dot and preserves the line's CRLF. It hands the parser **unstuffed RFC5322
message bytes**, never SMTP wire bytes or an unterminated partial message. The
MIME parser must not remove any additional leading dot. Pure byte-exact oracles
must split CR/LF, doubled dots and the terminator across chunks, and round-trip
literal body lines `.`, `..`, `.text`, `..text` and terminator-like nonterminal
text without loss or early completion. These are required future controls, not
tests executed for this draft.

The positive child calls the actual sendEmail once with immutable synthetic
subject, HTML and explicit text (include UTF-8 and escapable characters), with a
unique non-authentication sentinel URL/token in both representations. The sink
captures actual DATA only in memory. The independent parser unfolds bounded
headers, checks multipart/alternative boundaries, decodes quoted-printable/base64
or declared7bit/8bit UTF-8 from the sink's already-unstuffed RFC5322 bytes; it never
repeats SMTP dot removal. Fail unsupported charset,
duplicate critical header, malformed transfer/boundary, truncated data, attachment
or unexpected part; no substring-only or regex-only assertion of raw MIME.
Require exact sender/recipient/subject semantics and semantic HTML/text fixture
content agreement; no external URL fetch or HTML rendering. Normalize only actual
MIME transfer encoding and expected HTML entity escaping, not link/path/query.
Encoded-word subject decoding belongs in the bounded parser if the fixture uses
it; a chosen ASCII subject must not imply untested general decoder support.

Two independent positive oracles are required: actual service boolean true and
sink authentication/envelope/complete-DATA/acceptance plus decoded equality. A log
of “Email sent” or true without captured complete DATA cannot pass. The second
positive may exercise the actual service's text fallback with separate expected
content, within the same fixed run bounds; record its narrower semantics.

## Negative controls and sanitized evidence

| Control | Required independent result |
|---|---|
| Missing/wrong pins, changed source/output/dependency byte, extra file, forged record, wrong root/owner, changed env or endpoint | Refuse before service import/first socket; explicit static refusal and zero sink accepted messages |
| Import attempt of app/auth/DB/Express/dotenv/unlisted package or alternate resolution | Refuse before module side effect; reviewed canary counter stays zero; no module substitution |
| Foreign host, hostname, wrong numeric port, wildcard/path/fd/lookup/socket override, TLS/proxy/HTTP/DNS/UDP/spawn/worker attempt | Guard refusal before dispatch; independently owned forbidden local canary has zero hits and a live allowed control proves observability; never probe a real provider |
| SMTP configured fields missing; SMTP_FROM missing | Real service false and no connection where source returns before send; fixed scenario-specific expectation rather than inferred silence |
| Wrong AUTH, missing AUTH, malformed AUTH/order or foreign/multiple RCPT | Sink rejects and accepts zero DATA; real sendEmail false for applicable service scenario; protocol-only sink probes are labelled separately |
| Oversized line/header/body, incomplete DATA, invalid MIME/boundary/encoding or unsupported attachment | Deterministic bounded rejection; no successful DATA acceptance, parse pass or relay |
| Sink550 refusal, dropped connection, withheld final250 or child deadline | Classify rejected/unknown outcome accurately; do not equate false/timeout with “server definitely never received”; kill/reap only owned resources |
| SMTP text fallback | Actual fallback semantics observed and compared; no assertion that it equals authored auth-service text |
| Secret/sentinel projection | Actual stdout/stderr and every durable success/failure artifact omit synthetic auth user/pass, their base64 form, raw sentinel token, its SHA256 and full token URL; evidence writer fails closed on injected unsafe field/error |
| Cleanup | Every owned child/sink exits, sockets close and no allocated listener remains; guarded stage retained or destroyed according to parent custody/evidence policy; no raw capture remains |

Use synthetic credentials/sentinels for negatives. Do not test file/URL access by
passing unsupported attachment properties around the real SendEmailOptions type;
record source-level disableFileAccess/disableUrlAccess and separately exercise
guard refusal. A direct Nodemailer negative may test the guard but must be labelled
as such, not attributed to the actual service path.

Raw MIME, auth payloads, synthetic bearer-like URL and private IPC remain memory
only, never console, file, HAR, trace, screenshot, crash dump or retry packet.
The runner captures child output through bounded pipes, validates expected static
service events and emits its own allowlisted event ledger. On unexpected output,
discard payload, emit a static failure and retain only sanitized metadata. Preserve
failure outcome evidence without persisting the rejected raw text. Do not silence
or mock the logger to hide an exposure. Token/hash/auth sentinel checks run before
evidence writes, including parser/SMTP/timeouts/exception paths; do not serialize
generic caught exceptions, raw headers, peer reply text or message IDs.

Durable evidence may contain exact nonsecret source/runtime/compiler/dependency/
output/policy identities, run/owned-endpoint identity, scenario labels, timings,
bounded connection/AUTH/envelope/DATA/acceptance counts, decoded-match and
redaction/refusal booleans, exit/timeout classification, cleanup and reviewer
disposition. No message-content digest or credential/token digest is needed.
No proof is claimed from documentation checks or source inspection alone.

## Full captured-mail journey remains a different allocation

`FRESH-BROWSER-PROOF-CONTRACT.md` remains the complete registration/browser
contract. Before that journey can execute, parent must release the following:

- New full-profile installed JS/native-addon bytes, actual resolution and custody
  contract, with app/build identity; existing false manifest certifications cannot
  be bypassed by calling app imports a component.
- Real owned Redis version/instance/ACL/challenge checks, unchanged quotas and
  forwarded-address policy, multi-instance/outage negatives and an honest minute
  window budget. `rateLimit.ts` uses real stores but skips tests; source wiring is
  not observed quota behavior.
- Selected anonymous verification CSRF repair and actual native HTTPS cookies.
  Current `app.ts:163,180-222` has saveUninitialized=false, binds CSRF to sessionID
  and does not exempt verification POSTs; `routes.ts:68-70` does not explicitly save
  anonymous session state. This is an unresolved lead requiring real evidence,
  not a proven production failure or a chosen policy. Public resend is already
  exempt; signed-in own resend/change/cancel must retain cookie CSRF.
- New full-profile SMTP-enabled policy/version and authenticated sink, exact
  public origin, native browser trust, same-client native PG/marker/schema checks
  and combined browser/API/backend/PG/Redis/mail egress negatives. This proposed
  plaintext component proves neither SMTP TLS nor integrated egress; if full-profile
  SMTP uses TLS, CA/host/leaf/secret propagation needs its own reviewed adapter.
- Actual registration-produced captured mail to fresh browser B, unmodified MIME
  link navigation, one pending-to-verified persistence transition, unchanged B/C
  visitor identity, purpose/replay/race/resend/expiry negatives, durable session/
  audit readback and later password reset/revocation/copied-cookie coverage.

The canonical/legacy links, public UI and accepted pending/session/cache boundary
are repaired local source and separately accepted local evidence. They remain
assertions to carry into this combined non-test proof, not absent implementation
tasks. External delivery, real inbox/MX/provider use, hosted testing, deployment,
shared DB changes and release require their existing owner gates.

## Review and next action

Parent deferred standalone implementation in favor of the shared full-profile
dependency/resolution/custody contract, followed by anonymous-CSRF proof; sink and
MIME work should be allocated directly against that profile. Independent reviewer
readback now covers the refreshed source observations, this disposition and the
corrected sink-to-parser framing contract. The retained alternative's feasibility
and guard details are not implementation clearance. Any future implementation
requires demonstrated critical-path value and a separate exact-file,
source/runtime/hash/custody/run amendment before implementation. Native socket
execution requires its later allocation after implementation review and passing
pure refusal checks. No endpoint, secret, listener or runtime slot is allocated
by this draft. All101 canonical groups remain OPEN.

Independent Sol Extra High reviewer completed final readback of this draft at
SHA256 `F10974B685E74DD24858D1886DBD05D06AC9F8D3B104351CDB1624815A31A653`
and the companion fresh-browser contract at
`CC187607DE5219D923FB391247B370EB7765D71EB0FC7759A499BA103C842945`.
Parent accepted that documentation disposition and authorized the two-document
commit. This final status annotation records that readback; it introduces no
component execution, runtime evidence or full-profile acceptance.
