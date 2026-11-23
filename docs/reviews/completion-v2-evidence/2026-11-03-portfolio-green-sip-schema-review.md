# Portfolio verification and SIP schema review

## Portfolio candidate

Product candidate `5aad2423fe7ffc8187b25c2c6c48fd2e6b356f0d` received independent Astra generic/TypeScript source clearance. It captures actor-visible holdings, active bills and pensions in one statement, values the captured inputs, then rechecks current signed authority and source on success or failure. Existing account-summary and snapshot contexts retain their original paths. Mixed visible holdings with private underlying basis remain outside this settled contract.

Frozen evidence tree: `C:/Users/USER/.codex/worktrees/capital-r12-portfolio-green-nov03/personal-finance-app`.

- `.local/astra-portfolio-green39j`: 41/41 passed, exit 0, exact clean 5aad2423 before/after, OID1830987, 28 migrations, all six primary and nine scope counters zero. Independent review verified all 19 manifest hashes and actual error/late-authority cases.
- `.local/astra-portfolio-callers39k`: 283/283 passed across 14 files, but the overall operator FAILED because two authenticated orphan sessions remained. All other counters were zero. OID1833909 and its failed evidence remain untouched. Read-only marker/OID-bound aggregate confirmed two authenticated orphan sessions, without exposing payloads or credentials.
- `.local/astra-portfolio-project39l`: full project check passed through TypeScript and W10 at exact clean 5aad2423.

Cleanup-only `452e2f28eee4b0371ef211a4608e20436f8ba5c0` adds parameterized session deletion for each of the two weekly-recap fixture users before deleting those users. Independent review approved the scoped cleanup; product files, all 41 focused assertions and dependency/configuration inputs are byte-identical. The focused 39j evidence is source-equivalent, not an exact-452e execution. Fresh complete caller verification in the author tree's `.local/astra-portfolio-callers39m` passed 283/283 across 14 files at exact clean 452e2f28, exit 0, OID1836831, 28 migrations and all six primary/nine scope counters zero. Independent Astra raw adjudication verified all 19 hashes and approved bounded local integration. Clean composition `ead5b2921fc4899111d896c41ff9c8764b24a628` differs from 452e2f28 only in three canonical documentation files. Root fast-forwarded canonical 7a1710a5 to that accepted composition. This is local portfolio read-boundary acceptance, not full R12 or campaign completion; no new browser/build or release evidence is claimed.

## SIP schema remains held

Unregistered, unapplied candidate `d882cfd965f7c8de647221dae6cf33c4ea108452` is preserved in `C:/Users/USER/.codex/worktrees/capital-sip-authorization-nov03/personal-finance-app`. Independent SQL/contract review found two HIGH defects before any DDL:

1. The proven-purchase immutable UPDATE trigger conflicts with actual last-household erasure: holdings are currently deleted before investment transactions, causing `holding_id SET NULL` on a still-proven purchase. Repair must preserve GRZ dependency cleanup and delete transactions before holdings, with actual erasure regression coverage.
2. A current `xmin` proves that the tuple version was written in this transaction, not that the purchase was originally inserted here. Updating an old BUY can therefore permit forbidden retrofit proof. Require actual insertion-origin binding, following the existing reservation/sealing pattern, and test old-purchase updates plus savepoint behavior.

The seven retained proof fields and composite plan/household/actor foreign-key shape otherwise match the owner's decision. Operational authorization and replay records must be purged on erasure; completed proof remains with the purchase and tombstone actor. There is no inferred legacy mandate, retention-duration decision, schema application, runtime clearance or acceptance. Sol is revising the candidate for independent re-review.

The full campaign remains active and incomplete. No push, PR, main merge, shared/production database mutation, external delivery, deployment or release occurred.



## Continuation: SIP revision and pure contract tests

After a usage interruption, live agent inventory contained only root. Git verified canonical7338f9e4 and both candidate trees clean; the schema tree remained6916ab42 and the digest tree had no source changes. Two explicitly selected Sol Extra High lanes and one independent Astra reviewer resumed the existing ownership, without duplicating runtime work.

Independent review of6916 statically closed the original erasure-order and xmin findings, but found that cascading away a reservation could bypass deferred proof admission. The assigned correction requires proof whenever the purchase survives and rejects reservation deletion while its purchase exists without proof, preventing subsequent ID-rewrite evasion. A completed-proof TRUNCATE guard is also under review. These remain source candidates, with migration0028 unregistered/unapplied.

Pure digest test-only411aa077f1410937dc9f9ce6050e94b196d777c3 passed independent static generic/TypeScript oracle review. Root ran protected unit39o in capital-sip-digest-contract-nov03/personal-finance-app: exit1, missing production module, zero tests executed. This is availability RED only, not failing product assertions. Exact clean pin/result/log are in .local/sip-digest-red39o. The Sol lane is now implementing the approved pure helper; no database or external operation occurred.
