# Astra acceptance of isolated R12/R08 composition — 3 November 2026

**Verdict: APPROVE bounded local canonical integration of exact `1ab00412b67e5c752cbe6e9d51254b871058bec6`. SIP remains excluded and HELD.** This is source and protected local verification acceptance for the reviewed R12 currency/caller and R08 rule allocation/audit slices. It is not full packet closure, staging, production persistence, external delivery or release approval. Canonical integration has not been performed by this reviewer.

The owner restored Astra orchestration/review in this chat. Governing authority remains the canonical master completion specification and CAMPAIGN. Read this together with [the initial review](2026-11-03-astra-three-candidate-review.md) and [the superseding full-SIP-delta hold](2026-11-03-astra-sip-full-delta-addendum.md). The SIP addendum's HIGH private-plan finding is unchanged by these R12/R08 results.

## Exact source reviewed

Worktree: `C:/Users/USER/.codex/worktrees/capital-r12-r08-reviewed-nov03/personal-finance-app`.

Live Git inspection found clean head `1ab00412b67e5c752cbe6e9d51254b871058bec6`. The canonical-base delta from `0a9ca999c56b025622ed722e1cdc57fc11d2cce9` is exactly 29 paths: all 19 reviewed R12 paths plus all 10 reviewed R08 paths, with no set differences and no owner-blob differences. The three existing SIP product files are unchanged from canonical; `recordSipPurchase.ts` and `sipHoldingFxSource.ts` are absent. Shared schema, migrations and dependency manifests are unchanged. This is not the three-candidate `6195e1e3` composition.

The reviewer independently inspected completed raw receipts and logs, parsed runner results and rehashed available manifests. No runtime or DB commands were executed by this reviewer. The following are actual coordinator-run receipts, independently inspected rather than merely accepted from reported totals.

## Fresh exact-head evidence

All packet paths below are beneath this worktree's `.local` directory. Recorded runtime is pinned Node 24.22.0, SHA-256 `DF4B0E71E4E4D022BF8582FBE75F6061FEB9C4A111A86F3FEC6300D24B6FE5E0`.

| Packet | Independently verified result |
|---|---|
| `astra-r12-r08-server39b` | Exact-head 463/463 tests across 21 complete files; zero failed/pending/todo; command exit 0. Includes all prior R12/R08 server callers and the 16-case pure split-allocation test. Source pre/post match and tracked tree clean. |
| `astra-r12-r08-client39c` | Exact-head 79/79 tests across nine complete client files; zero failed/pending/todo; command exit 0; matching clean head afterward. |
| `astra-r12-r08-project39d` | Exact-head full `npm run check` exit 0 through runtime, TypeScript, import, LOC, tool syntax, module metadata/report and W9/W10 checks; matching clean head afterward. |
| `astra-r12-r08-browser39e` build | Exact-head full `npm run build` exit 0. Raw log confirms runtime prebuild, Vite client build and esbuild server bundle. |
| `astra-r12-r08-browser39e` browser | Exact-head four expected Chromium passes across three specs; zero skipped/unexpected/flaky; one worker, zero retries; command exit 0. Source pre/post match and tracked tree clean. |

Server39b target is `pfa_completion_scope_r12r08compose39b_test`, OID `1813420`, exact `r12r08compose39b` synthetic marker and 28 migrations. Its postflight records all six primary and nine scope counters zero, including other clients. All 19 entries in its evidence-hash manifest match freshly calculated hashes. Raw server/client log totals agree with runner JSON and declared command file lists.

Browser39e target is `pfa_completion_scope_r12r08browser39e_test`, OID `1816377`, exact `r12r08browser39e` marker and 28 migrations. All 23 entries in its final evidence-hash manifest, including retained readback, match freshly calculated hashes.

The report records `TEST_BROWSER_CLIENT=built`; the browser server serves `dist/public` in that mode. It runs the protected test app using the TypeScript browser-server harness. The production server bundle was built successfully but was not the process used for these browser journeys. No production-mode deployed-server claim follows.

The four journeys check actual holdings/portfolio currency conversion, recovery after committed DELETE acknowledgement loss, refusal to delete genuinely sold history, and recovery after committed opening acknowledgement loss. The R12 journey retains fixed 300 ZMW/15 USD expectations, real HTTP writes/responses and SQL unchanged-financial-state checks. This fresh exact-head evidence now exists independently of the older source-equivalent `33ff13d6` run. That older result and its failures are preserved, not relabelled.

## Browser retention and diagnostic limits

Browser postflight is deliberately NOT zero. It records four synthetic users, households, accounts and holdings; zero cash transactions; 19 audits; four sessions and four tracked sessions; and zero other clients. `retained-readback.json` independently records five investment transactions, four lots, one disposal, five opening receipts, one deletion receipt, zero recurring plans/execution logs, four authenticated sessions and zero sessions missing users. Audit grouping accounts for eight account CREATEs, five actor-only holding CREATEs, one actor-only holding DELETE, one household-audience investment CREATE and four actor-only investment CREATEs. Duplicate account creation audit behavior remains outside these slices, as already registered under NEW-32.

The readback SQL in `.local/root-operators/browser-readback39e.sql` starts a repeatable-read/read-only transaction and guards database name, loopback address/port, cluster data directory, OID and exact marker. Its retained fixtures are persistence evidence, not cleanup success. The failed historical blanket-zero interpretation is not reused.

Raw browser diagnostics contain asset `net::ERR_ABORTED` observations and the expected DELETE 409 for sold history. The final assertions pass. No claim is made that all browser diagnostics vanished or that their general cause was established. Missing optional provider configuration and synthetic login-security warnings do not supply provider/staging evidence.

## Restricted evidence artifact

The raw browser `playwright.json` serializes inherited `webServer.env` and contains an unrelated credential-bearing `POSTGRES_MCP_URL`. No credential value is reproduced here. This is a concrete inherited harness/report exposure outside the 29-path source scope, not a new R12/R08 application defect. The reviewer reported it promptly after expanding report configuration during mode inspection.

**The raw packet is restricted, local-only and non-shareable.** Preserve the original and its hashes; do not commit, publish or forward its environment payload. Root subsequently created `playwright-results-without-config.json` and `redaction-provenance.json` as supplemental derivatives, leaving the original 23-entry manifest untouched. Independent inspection confirms the derivative omits the entire `config` property and retains identical stats, suites and errors. Recalculated hashes match the linkage: original `530E2ECF84A25168F5C49C33FBF63B2B56FE9419D5C1F08A1E4D3074B3F10DD8`; derivative `94FB90DA32F89F5671CC6B84DF72F77D8DD2D66844EF04E9CD99CB7F6ED40A59`. This is not a comprehensive secret scan or publication approval. Future operators should remove inherited credential-bearing environment variables before child execution. No harness source patch or rerun is folded into this R12/R08 acceptance; artifact-only redaction does not change the tested candidate.

## Integration boundary

Root may perform the authorized local canonical fast-forward to exact `1ab00412` after rechecking source/destination identity and clean ownership. This reviewer has not changed canonical. Preserve the SIP candidate and its HIGH finding on the separate held lineage; do not merge `6195e1e3` in place of the SIP-excluded target.

This acceptance covers the specific selector/metadata/display-state repairs, owned test cleanup, complete rule allocation validation/cent conservation and transaction-bound mandatory rule audits. All full R08/R12/R13 requirements, private-plan authorization, overdue policy, dated valuation, staging, external providers, UAT and release retain their remaining gates. Earlier failures stay failed and retained.

## Review Summary

| Severity | Count in accepted 29-path delta | Status |
|---|---|---|
| CRITICAL | 0 | pass |
| HIGH | 0 | pass |
| MEDIUM | 0 | pass |
| LOW | 0 | pass |

Verdict: APPROVE bounded local canonical integration of exact R12/R08 composition `1ab00412`; raw browser evidence remains restricted/non-shareable. SIP integration remains HELD under the separate HIGH finding. No release approval.
