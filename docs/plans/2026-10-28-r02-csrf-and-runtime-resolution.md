# R02 verification CSRF and native runtime-resolution plan

**Goal:** Implement the approved token-authorized verification CSRF boundary and
an independently reviewed native external-import resolution/byte observation.
**Architecture:** Two isolated Sol Extra High authors, one independent Sol Extra
High reviewer, parent coordination/final acceptance; four active agents maximum.
**Tech stack:** Existing Express, csrf-csrf, TypeScript, protected Vitest/PostgreSQL,
Node 24.22.0 and current production-manifest/Windows metadata primitives.

## Baseline and authority

Owner requested continuation. Baseline `5db5f5a9e2be29fedcfefef85e868446f06b4270`
has accepted local category defaults, full 3,316-test server regression and eight
browser cases. Do not repeat unchanged baselines without a reason. Earlier
session-access and category acceptance limits remain intact. Local source work,
guarded synthetic tests and local commits are authorized; shared DB, external
delivery/providers, provisioning, main merge, deployment and release are not.

Keep primary C:/Dev/personal-finance-app untouched. Existing clean worktrees are
reused with prior branches preserved. No new package, schema, token format,
credential authority, production-profile permission or SMTP implementation is
part of this batch. All 101 canonical groups remain open.

## Ownership and slots

| Role | Branch and owned paths |
|---|---|
| Coordinator/final reviewer | canonical plans/ledger/acceptance, integration and combined checks |
| CSRF author | `codex/capital-r02-verification-csrf` in capital-r04-foundation; `server/app.ts`, a focused `server/middleware/csrf-policy.ts` if needed, directly related CSRF tests, narrowly extended existing R02 real-DB tests, `R02/VERIFICATION-CSRF.md` |
| Runtime author | `codex/capital-r20-runtime-resolution` in capital-r19-foundation; proposed `server/testing/production/runtime-resolution.mjs`, `.regression.mjs`, and `R20/RUNTIME-RESOLUTION.md`; exact interface/native fixture allocation requires design readback first |
| Independent reviewer | read-only design, source and evidence review; separate typed/security review reuses a freed slot |

Agents must preserve others' edits and may not spawn more agents. Database,
static/build and broad suites require a parent-assigned exclusive slot. Pure
bounded source/contract tests may overlap read-only review. No application source
changes during canonical integrated verification.

## Task 1: Verification CSRF boundary

The master permits a narrow token-authenticated exception when no ambient-session
authority is used and the visitor cannot be authenticated or switched. Parent and
independent reviewer already selected this design from actual token-consumer source.

1. Trace production CSRF selection and existing tests. Return the exact minimal
   extraction/test composition before editing production source. Preserve existing
   policy behavior; add only `POST` with exact `req.path` equal to
   `/api/auth/verify-email` or `/api/settings/security/email/verify`. No prefixes,
   case folding, slash/encoding normalization or additional route exemptions.
2. Write red tests on the existing behavior. Exercise real csrf-csrf enforcement
   in a narrowly identified middleware component, including valid-CSRF controls
   and ordinary cookie mutation rejection. A true production-environment selector
   passed to a pure policy test is not full production-app/browser evidence.
   Do not run the complete app outside existing protected profiles or defeat the
   test environment guard. A focused helper must also be the app's actual consumer.
3. Implement the minimal change. Keep session configuration, token consumption,
   route limiters and signed-in resend/change/cancel CSRF behavior unchanged.
   Do not persist new anonymous session fields or widen current authority.
4. Extend protected mounted/database regression coverage for both endpoints:
   valid initial and email-change tokens; invalid/hash/expired/replayed tokens;
   initial-only purpose rejection without consumption; simultaneous consumers;
   unrelated authenticated and MFA-only visitor identity; exact token-owner
   email/reset/MFA/notice/audit effects with independent readback. Inventory
   existing evidence before adding duplicative tests. Test-mode DB results alone
   cannot prove production CSRF or limiters.
5. Run focused real-middleware, unit and marked-DB checks, nonincremental TypeScript
   and npm check; preserve red/green evidence, freeze exact source for independent
   and final review. Parent integrates accepted changes and runs applicable full
   server/static/build/browser gates. The captured-mail fresh-browser chain and
   full profile remain separate acceptance requirements.

## Task 2: Native resolution observation

1. Turn the prior two-file proposal into an exact bounded interface and test plan
   for independent/parent adjudication before implementation. Pin branded profile,
   built entry, Node runtime, actual build/metafile, controlling package metadata,
   independent expected resolutions and entry bytes. Define what prevents fake
   fixture expectations from being presented as current installed-byte evidence.
2. Use native ESM import-mode resolution with the actual entry as parent; prove
   that the pinned runtime honors that parent. Do not substitute require.resolve,
   evaluate dependency/application code, install packages, change the deployed
   build, or create another CJS projection/launcher. Reuse existing manifest/path
   and generic Windows metadata primitives unchanged where applicable.
3. Bound input/file/process counts and timeouts; compare resolved paths and the
   same opened bytes, metadata, size and hashes. Reject escaped roots, reparse or
   hardlink aliases, changed controlling package metadata, swapped files, forged
   records, caller mutation, wrong runtime/build/metafile pins and alternate
   conditional-export or nested-shadow resolution.
4. Separate pure/synthetic contract tests from any actual installed native
   observation. Native probes may only use an approved absent fixture root and
   pinned Node with a closed environment; no listeners, DB, browser, mail or
   evaluation of application/dependency modules. Parent assigns concrete run pins
   after the design is reviewable. An evaluation sentinel must remain untouched.
5. The earned claim is root external-import resolution and entry-byte observation
   only. Transitive/dynamic/native closure and ongoing custody are not implied;
   `runtimeDependencyIdentity` and `executionAuthorized` stay false. Provide a
   finite follow-through to full closure/custody rather than adding observation
   layers that never resolve the actual gate. Freeze reviewed code/evidence and
   integrate only after applicable checks.

### Design readback amendments

The CSRF author may mechanically extract the unchanged selection wrapper into
`createCsrfPolicyMiddleware(protect, getEnvironment)` before recording behavioral
red, after writing the tests. The actual app must consume the same factory with
the real `doubleCsrfProtection` and default request-time environment selection.
Only the component fixture supplies a production selector with HTTP-only test
cookies; it uses real express-session and csrf-csrf, not a stub protection handler
for the positive/negative enforcement evidence. This is component evidence, not
a full production-app or native-cookie claim. No full non-test application launch.

Parent owns a one-time same-options esbuild invocation with an additional
`--metafile` output under a separately assigned absent run root. It must produce
the actual matching server entry/metafile and record source/runtime/compiler
identity without changing package.json or the production build semantics.
The observer cannot fabricate build metadata or assume build ownership.

The runtime inventory must classify every metafile external import kind. Static
ESM imports and literal dynamic-import roots may receive import-mode observations;
require-call roots remain explicitly uncovered unless a separately reviewed
require-mode observation is later implemented. Builtins receive native identifier
observations, not file-byte claims. Unsupported or omitted roots cannot silently
disappear from the result. This resolves the review's coverage concern without
turning a partial observation into runtime-dependency or execution certification.

## Targets and completion

Current pinned physical Node directory:
C:/Users/USER/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/capital-r00-runtime/node-v24.22.0-win-arm64.
Earlier ordinary checks used the logical AppData alias to the same bytes; native
identity checks require the physical path, as recorded in runtime acceptance.
Protected DB target (release only after fresh identity verification): canonical
`.local/r01-integrated/target.json`, run `r01int15a1`,
`127.0.0.1:55432/pfa_completion_identity_r01int15a1_test`. Use no ambient finance_app,
shared 5432, schema push or unmarked fallback. Parent owns Golden browser target.

The batch is complete when both bounded candidates receive independent and parent
review, exact local integration and appropriate validation, with failures and
unproven production/full-profile claims explicitly retained. No blanket skips,
relaxed assertions, policy thresholds or hidden test/profile overrides to get green.

### Validation scheduling

The reviewed CSRF change is integrated and validated while the inert runtime
observer remains in its isolated author checkout. This avoids idling the main
server regression behind independent tooling. Record the exact tested CSRF head;
after runtime integration, verify application/test/config/package parity and run
the new observer's own checks plus applicable static gates. Do not present earlier
server/browser runs as executions of a later commit or repeat unchanged suites
without an affected source path or unresolved concern.

## Completed local checkpoint

Both bounded lanes received independent general/security and separate typed
reviews plus parent adjudication. CSRF author `1b767b4` integrated as `1bc7932`.
Runtime author `e4287ae` integrated as `f55ff1a`, with reviewed physical-runtime,
effective-environment and external-TEMP corrections through `e7da0c4`. The old
failed runtime root remains preserved; the successful fresh b1 root is empty and
retained as nonreusable. Detailed failures, corrections, pins and exact scopes are
in the two acceptance records below.

CSRF focused evidence is 29 real middleware-component tests and 63 mounted DB
tests. Full integrated server run: 3,356 passed / one older timestamp-sensitive
tag assertion failed. The nonweakening reviewed repair passed all 25 tests in
its file; the original full run is not relabelled green. Static/build/bundle and
all eight protected browser cases passed. Client source is unchanged from the
previous accepted 1,497-test baseline.

Runtime evidence: 90 pure/fake tests, successful native synthetic fixture
(three positives/two wrong-target negatives, optional native case-distinct control
unsupported), then actual installed root/byte observation on a reviewed separately
prepared inventory and matching real esbuild metafile. The latter covered 33
static file roots, one dynamic literal file root, 11 builtin groups and 70 selected
files. CJS/transitive/computed/native closure and lifetime custody are not earned.

- `docs/reviews/completion-v2-evidence/R02/VERIFICATION-CSRF-ACCEPTANCE.md`
- `docs/reviews/completion-v2-evidence/R20/RUNTIME-RESOLUTION-ACCEPTANCE.md`

All full-profile/group/release limits remain unchanged. No push, main merge,
deployment, paid provider or external delivery accompanied this local checkpoint.
