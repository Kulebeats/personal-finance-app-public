# R04 Shared owner: bounded current-source port

Status: isolated candidate, not accepted or canonically integrated. Full R04 and
all canonical groups remain OPEN. No release or remote operation is authorized.

## Source and ownership

Worktree: `C:\Users\USER\.codex\worktrees\capital-r04-shared-owner-port\personal-finance-app`.
Branch: `codex/r04-shared-owner-port`; base
`809264b6169967ffd78ced668f3b3ca0fabccc39`.

This ports the already implemented Shared-owner repair from preserved author
`bb1312476fed70092a8a04fb6b4d3c325a8c38d3`, rather than merging its 114-file
snapshot and inherited preference work. Only six source/test paths are included:

- AccountCoreService retains explicit null and defaults only omitted ownership;
  Shared creation is not recorded as assignment to another actor.
- The client Account response type permits null ownership.
- The original service, signed HTTP/SQL and browser regressions are retained.
- The current completion browser configuration gains only the Shared-owner test.

The service and all three regression files were hash-verified before copying.
The nullable type was applied as a one-line patch. The source freeze is
`.local/r04-shared-owner-port-oct31a/source-freeze.json`; its six SHA-256 values:

| Path | SHA-256 |
| --- | --- |
| server/services/account/AccountCoreService.ts | d6f1fb65b1b9620a38e4d5e2585e638c7c282b70bdce0de9eb6e94285afa05f7 |
| client/src/lib/api.ts | 303902862b606d7b93286e1dc8f56ace8f3b8a4f529f47b9cab92e1f2ca39258 |
| playwright.completion.config.ts | 7816c66902a2001b3ae49ca8b29af31114f710090f2f1a770c6871b4a79d1234 |
| server/services/__tests__/completion-r04.account-shared-owner.test.ts | 58b14ba527081bf1734255f631766a590a8293f315358de4a5244d1994cd0c16 |
| server/modules/accounts/__tests__/completion-r04.account-shared-owner.realdb.integration.test.ts | 0eae6462730d955f806360fcbe7cf6eecbacc192e2fafb67419290dda3052de6 |
| e2e/completion-r04-shared-owner.spec.ts | e6ca4eb7a4d3cc1dfe24e5d64a144c5f4f888ac4b0064eff58947c63b5bf5441 |

## Fresh verification

Pinned Node 24.22.0 and the existing protected unit wrapper were used. The local
node_modules junction points at canonical dependencies; no install was performed.
Raw logs and result receipts are under `.local/r04-shared-owner-port-oct31a/`.

| Check | Result | Log SHA-256 |
| --- | --- | --- |
| Existing accountService suite on unchanged base | 19/19 pass, exit 0 | 1ad65898279137d626555d359ae319db4d82c79d71aaf21cba443dfa498ff963 |
| Original ownership regressions on unchanged base | 2 fail / 11 pass, exit 1 | 784cc94f7d242e1723fe1d2d0d522999a84aeb585ec809994c37c0d8470015f8 |
| Existing and new suites after port | 32/32 pass, exit 0 | a9af8b38281899f65f03af7b3ee0e6f35354cb73031769550a763f466084d86f |
| Explicit browser/config strict TypeScript check | exit 0, no diagnostics | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| npm run check (runtime declarations, full tsc and repository guards) | exit 0 | 7efbb93aba29f7bb9a9f923e49a8d1fb6f5e5bdbfb55c2f1d4727cc2aecd0667 |

The two RED failures reproduce explicit Shared becoming actor-owned and private
plus Shared incorrectly succeeding. GREEN covers existing account callers and
the null/omitted/self/other-member/private rejection distinctions. This is unit
evidence, not persistence or browser evidence.

Commands, from the port checkout with the pinned node directory first in PATH:

```text
node scripts/run-protected-tests.mjs unit vitest --server run services/__tests__/accountService.test.ts --maxWorkers=1
node scripts/run-protected-tests.mjs unit vitest --server run services/__tests__/completion-r04.account-shared-owner.test.ts --maxWorkers=1
node scripts/run-protected-tests.mjs unit vitest --server run services/__tests__/accountService.test.ts services/__tests__/completion-r04.account-shared-owner.test.ts --maxWorkers=1
node node_modules/typescript/bin/tsc --project .local/r04-shared-owner-port-oct31a/tsconfig.browser.json --noEmit
npm run check
```

The focused config extends ../../tsconfig.json, disables incremental output, and
explicitly includes the e2e test, browser config and server/types. Its SHA-256 is
`97c74ee64c36a26736575351d6e53549a2a58b07a154055527fbe77813238e05`.
The six source hashes were rechecked unchanged after all checks. Source-freeze
SHA-256: `fa96af8689fce8aeb8a035216717380ac961c8b5942e56728f3aa75d491216bb`.
The repository metadata check still reports 0/22 modules final-ready; a passing
static check does not turn those release gates green.

## Outstanding gates and next action

Independent general/TypeScript and Astra final review are pending reviewer quota
recovery. The existing review agent has been given this candidate's location;
the quota hold is not an approval. Do not canonically integrate yet.

No fresh HTTP/SQL or browser execution was attempted for this port. The separate
C2 owned PostgreSQL startup/bootstrap action was rejected by automatic approval
review as "blocked by policy"; this continuation does not retry that action by
another launcher. Resolve the tooling gate before requesting a serialized fresh
disposable runtime window. The original author's 15 HTTP/SQL and one browser pass
remain historical evidence described in SHARED-ACCOUNT-OWNER-CANDIDATE.md, not
fresh acceptance of this current-source port.

Preservation commits save unfinished work locally; they do not constitute review,
off-device backup, canonical integration, production readiness or closure of R04.

## Independent current-port source reviews, 31 October2026

Sol Extra High general code-reviewer and separate TypeScript reviewer each
reviewed809264b6..777cf5b7392f7609623e050a25ae52eac52c4569 in the clean isolated
port. Both returned no actionable bounded source/test findings. The real
UI/API/validation/service path preserves explicitnull and omission distinctly;
existing capability/private/member checks remain intact. Nullable response
consumers, async test behavior and current browser registration were checked.
The service and three regressions match the preserved author's blobs, and only
six non-documentation paths differ from the current-source base.

The TypeScript reviewer matched all six source hashes and five existing receipt
log hashes, including32/32 unit, full repository check and focused browser tsc.
Neither reviewer reran checks or touched source, DB or browsers. These are
independent source approvals plus inspected coordinator evidence, not fresh
HTTP/SQL/browser acceptance. Astra High final review and current protected
runtime evidence still gate acceptance/integration. The original historical15/1
runtime passes do not become current-port results through review.

## Astra final bounded-source adjudication, 31 October2026

After the reported quota retry time, the existing Astra High reviewer completed
review of777cf5b7 against809264b6, verified the clean checkout and all six source
hashes, and found no actionable source/test finding. Explicitnull/undefined
semantics, private/member guards, nullable response type and browser registration
were cleared in source. This completes final bounded-source adjudication only.
Fresh current-port HTTP/SQL and browser evidence remains missing, so canonical
source integration and full R04 acceptance remain gated. No runtime was executed
by the final review; historical15/1 and current32-unit/static results retain their
original scopes.
