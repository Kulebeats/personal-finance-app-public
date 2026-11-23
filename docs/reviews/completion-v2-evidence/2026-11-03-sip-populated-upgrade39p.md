# SIP migration 0028 populated rehearsal — locally verified

Independent Astra review accepted the bounded synthetic 0027-to-0028 preservation rehearsal. Root executed seed, upgrade and separate read-only verify phases serially, each exit 0, with independent raw-evidence adjudication before advancing. No production or shared database was touched.

## Exact inputs and target

- Baseline: `db5667a99047cdabc4b564e21b67dd3df176ae52`; final schema/mapping/metadata: `502493f89e3798d342ebce3ad9f5944c5eb393ed`; fixture checkout: `0c8893547095d10c487de04268cc84df6a27fb3d`.
- SQL SHA256: `ee2a9df095f3d1759884f4906a4edd10a28f70cceaf21ba8c4967c80b1d60913`.
- Reviewed operator: `003a7317e8eb98588e255fbb353273ebef8a91707e81c5b44c31ea187cf43616`; wrapper: `8d417e1dfe9096fee6d0ff47ba8aea162b7e8de669485a1b8d6dc78b3095bbe3`.
- Marked disposable database: `pfa_completion_scope_sipupgradenov03a_test`, OID **1843187**, PostgreSQL **18.6**, `127.0.0.1:55432`, owned canonical `.local/completion-pg` directory. Pinned Node **24.22.0**; child environment allowlist excludes inherited provider credentials.

## Evidence

Raw packets remain at `C:/Users/USER/.codex/worktrees/capital-sip-populated-rehearsal-nov03/personal-finance-app/.local/sip-upgrade-operator39p/`.

| Phase | Root result SHA256 | Operator packet SHA256 |
| --- | --- | --- |
| Seed | `245340a108be9195bb4437642429da50b327d7ce514be774da4cd3c349a4e81b` | `89173182a7a976a8d3ec7289d6e0b4b4964f8c5c2560039e7bc3370ffaef4330` |
| Upgrade | `235a76aaa99bd9eca9ff1a553e083599a8ed11a3ebee7a1b38c20b4585a32556` | `8f545281e36486e10724d17513b5c5ab43d38c2e1f9b7df09091a1332f37a6a0` |
| Verify | `900a2e98e9300b59b3ead4d01746db3dc94ca8b2cf9be4c646af64a29c9a9486` | `9431897886308bbc0ce96b045ea7fde9bb3526deb71d64e87fcc42de462b80ff` |

Astra independently checked all 25 evidence hashes per phase. All 15 complete table snapshots (39 rows), eight semantic frames and 55 prior receipt-catalog rows survived unchanged. The first 28 migration IDs/hashes/timestamps remained identical, with only reviewed 0028 appended as migration 29. All ten legacy authorization pointers remain null and all four new tables remain empty. The installed nine functions, eight triggers, three definer-function PUBLIC revocations, deferred reservation FK and seven proof columns match reviewed SQL. Verification used default and transaction read-only mode with repeatable-read isolation.

Postflight retains exactly three synthetic users, two households, three accounts, three holdings and four audit rows. Transactions, other database clients and the remaining eight scope counters are zero. This is an intentionally populated fixture, not an all-zero cleanup claim. Source stayed clean and all phase stderr was empty; no failure packet was produced. Earlier unrelated failures remain preserved.

## Remaining work

This accepts migration preservation only. Fresh-target signed API baseline, real authorization/replay, executor/purchase/lot/audit/proof atomicity, erasure, adverse SQL and race behavior remain required. The schema candidate has not been integrated into canonical application source. Next is the existing eight-case signed caller baseline on a separate fresh 29-migration disposable target. Full SIP, R13 and campaign requirements remain open; no deployment or release readiness is claimed.
