# Application runtime follow-through checkpoint

Status: integrated local source and component evidence; full-profile application
execution, R02 journey acceptance and release remain open.

## Source and review

The owner approved the sequence in
`docs/plans/2026-10-28-r20-application-runtime-followthrough.md`.
Two Sol Extra High authors used separate existing worktrees; independent general
and TypeScript/JavaScript/security review occupied the fourth slot sequentially.
The parent inspected the changes, adjudicated the contracts and integrated them:

| Slice | Reviewed author | Canonical integration |
| --- | --- | --- |
| Concrete native/data inventory | `58002e3fa0e3a1c0c7811376b2d81a81a50f94ef` | `90cc8b5` |
| PostHog dependency/ESM repair | `2a5bdbe479716cb11c91cf692ede1afb4a652552` | `e47d53cdb18eaf29fc56a2ce117ea4fe07f31bde` |

The latter is the combined application/test candidate for the checks below.
The parent plan, this acceptance record and a narrow JSONL LF attribute are
documentation/packaging follow-ups. No existing application entry, runtime stage
or enforcement authority was widened.

The analytics repair declares the missing package, replaces the broken ESM
require call and fixes the SDK capture signature. Configured external events are
aggregate-only; identifiers, exception text, query hashes and arbitrary strings
are excluded. A supported capture-only fetch adapter also prevents the SDK's own
flush diagnostics from retaining raw transport responses/errors. The SDK's
optional environment-selected v1 capture protocol consumes successful response
JSON, so it is explicitly refused before client construction with logger fallback;
the default/explicit v0 path remains supported. This late review correction has
its own failing-then-passing regression and refreshed final language review.

## Canonical checks

All commands use pinned Node 24.22.0 Windows ARM64. Logs are retained under
`.local/r20-application-runtime-oct28/`.

| Check | Observed result |
| --- | --- |
| All production-harness pure regression files | 283/283, zero failures/skips, 473.2822 ms |
| `npm run check` | Exit 0; TypeScript and repository guards pass |
| `npm run test:runtime` | 11/11, zero failures/skips; reviewer independently repeated 11/11 |
| Production build | Exit 0; Vite 33.96 seconds, server bundle produced |
| Client initial-JavaScript budget | 190.35 kB gzip against 300 kB |
| `npm run test:dependencies` | 8/8, zero failures/skips, 10.02 seconds; synthetic Sharp transforms, local OCR and owned loopback SMTP component checks |
| Full protected server suite | 241 files / 3,357 tests passed, zero failures/skips, exit 0, 578.02 seconds |

The author also passed the unchanged analytics Vitest suite 12/12 through the
protected unit runner with the API key empty. That imported the installed SDK
without constructing a client. The pure runtime regressions instead use a
synthetic SDK. Neither result proves real external capture/delivery.

The full server run uses the existing separate synthetic database
`pfa_completion_identity_r01int15a1_test`, run `r01int15a1`, at
`127.0.0.1:55432`, one worker and no file parallelism. Before starting, the guarded
read-back verified the exact target and persisted run marker; its public result
is `server-target-proof.log`. Ambient `finance_app` is never selected.
`server-full.log` records the complete serial run on the unchanged application
candidate. This supersedes the earlier full-server result with one failed tag
assertion: the subsequent test-only correction now has full-suite confirmation.
No client/browser suite was relabelled as newly run.

## Actual installed-root observation

The parent installed only the three reviewed packages into previously absent,
private canonical dependency directories by verified create-only byte copies.
The materialization inventory SHA-256 is
`d1ecc5a3eb3dba7db1a56d28eefa3dbb461902b2f4f243a24701c43a55c7851c`:
718 files, 3,731,937 bytes. No lifecycle scripts or native packages were introduced.
The exact manifest/lock delta and isolated lock dry-run are recorded in
`DEPENDENCY-DISPOSITION.md`; this is not a claim of a fresh full `npm ci`.

Generating the esbuild metafile reproduced the production server bundle bytes
exactly: `dist/index.js` is 1,888,579 bytes. The independently reviewed preparation
and observation helpers bind build and harness commit `e47d53cd` to allocation
SHA-256 `fe718e7d01a536ba6a6923b3331a152edd7a9dc4c0da5949776c55573c23fa47`.
The first observer invocation refused the ordinary shell environment at its
existing exact-five-key preflight. Its failure logs are preserved; no guard was
relaxed. The same helper succeeded with a cleared, five-key environment and the
pinned physical runtime. Its controller had a 60-second bound, exited zero and
drained stdout/stderr; the whole command took 4.756752 seconds. The parent
transcription `observer-controller-record.json` identifies the tool result and
its limits; it is not an independently generated process attestation.

Successful observation found 72 selected files, 34 static ESM package roots,
one literal dynamic root and **zero uncovered require calls**. PostHog resolves
to `posthog-node/dist/entrypoints/index.node.mjs`; its selected SHA-256 is
`48aea30dc9ced1a7feadcbfb1b4d0bbc7edb201995a30d7d9ec1c5e2d917e971`.
The reviewer independently rehashed all 242 unique selected/build input files
(91,529,694 bytes), confirmed the metafile's single static PostHog import and
matched the allocation/helper pins. Successful stdout SHA-256 is
`da54c614cf5f018821efa1c7317f3db795281f8a01112031c092885fdf6bbec0`;
stderr is empty. No selected application/SDK module was evaluated by this
read-only observation.

This clears the old missing-root/ESM-require obligations for this new build.
It does not establish transitive closure, native/data custody or application
execution; all four corresponding certifications remain false.

## Native/data and audit limits

`RUNTIME-NATIVE-DATA.md` and its portable JSONL contain the concrete Sharp ARM64
addon, two sibling DLLs, selection sources and all 3,134 fast-geoip data files.
The reviewer independently matched all 3,153 file pins, 181,397,469 bytes.
JSONL SHA-256 remains
`eeee58625ff01e128ec068f6295a0600fb009871bdc25cb50ba6ac3587205088`.
Windows checkout initially materialized CRLF bytes; the parent restored the exact
reviewed LF bytes and added the narrow attribute to preserve them. Native source
and regression checkout line endings differ from author raw pins, but their Git
content is identical. Future native dispatch must pin actual checkout bytes.

The fresh production dependency audit is **not green**: both baseline and candidate
have the same six affected package findings, four high and two moderate, in
body-parser, multer, nodemailer, qs, zod and zod-validation-error. The reviewer
independently compared the complete vulnerability objects. The three-package
addition has zero findings; no existing dependency remediation is claimed.

Still required: the actual installed application stage/consumer; native loaded-DLL
path and retained-custody proof; bounded real GeoIP data reads; full-profile
service/TLS/egress/secret integration; captured-mail and browser/persistence account
journeys. A fresh host inventory still finds no Redis server, Docker or Podman
command and no installed WSL distribution, so an owned real Redis runtime remains
a separate prerequisite. Standalone component greens do not satisfy that gate.
All 101 master groups, R02/J01/G1 and release remain open. No push, main merge,
deployment, real external delivery or shared database mutation accompanies this
checkpoint.
