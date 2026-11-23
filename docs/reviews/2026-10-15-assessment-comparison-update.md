# Updated comparison after Claude's full-application revision

Reviewed 15 October 2026 (Africa/Lusaka). Application HEAD remains **381e9439afabe7c6cf829cb1cbded91d36da44ee**. This document supersedes the current-status conclusions of the [14 October comparison](2026-10-14-assessment-comparison.md); that document remains the historical comparison of the earlier packages.

## Conclusion

**Claude has materially improved the assessment and closed the largest scope disagreement.** Its plan now requires the complete application, withdraws the November deadline and pilot feature deferrals, and incorporates many Codex findings. It also reports three targeted HTTP/DB reproductions that resolve earlier uncertainty. This is stronger assessment evidence, not an application fix: the app remains NO-GO.

The two plans are now broadly aligned, but Claude's revised documents still conflict with the owner's settled Thandi requirement and contain a few scope and evidence inconsistencies. Use the combined findings and full-product gates; do not treat WP-19 as a ready implementation contract until the corrections below are incorporated.

## What changed

| Topic | Earlier Claude package | Updated Claude package | Revised comparison |
|---|---|---|---|
| Product scope | Small invited pilot, multiple features withheld | Every advertised feature working; hiding only temporary containment | Major disagreement resolved. My previous statement that Claude still plans only a reduced pilot is now historical. |
| Deadline | 11 November stretch and later pilot alternatives | No fixed date; gate-driven delivery | Aligned with the owner's latest brief. |
| Work breakdown | 16 primary packets | 21 packets, including notifications, OCR, AI, accessibility and integrated acceptance | Much closer to the full completion contract. |
| Effort | 27.5–41 days for the smallest pilot; 44–64 for the earlier larger plan | 70.5–107.5 developer-days; approximately 81–124 with 15% reserve | Compare with Codex's 72–122 before reserve, not the obsolete pilot figures. |
| Rule reference validation | Foreign-household action values not exercised | ORG-003 reproduced over HTTP and DB | Additional runtime evidence for the original source finding. |
| Rule dry-run | Category-only path showed no writes | ORG-004 tag and split actions reproduced writes | Different-action explanation confirmed; not an actual contradiction. |
| Household preferences | Successful writes described as per-user | AH-09 reproduced as a view-only write to shared household preferences | Disagreement resolved in favor of the original finding; Claude restores P1. |
| Other adopted findings | Operations/mutation cases missing or unexercised | GAPS §1b preserves original IDs and verification states | Better traceability; adoption does not mean runtime verification or repair. |

Sources: Claude's [progress ledger](2026-10-13-independent-readiness-fable/PROGRESS.md), [revised specification](2026-10-13-independent-readiness-fable/COMPLETION_SPEC.md), [launch plan](2026-10-13-independent-readiness-fable/LAUNCH_PLAN.md), and [adopted findings](2026-10-13-independent-readiness-fable/GAPS.md).

## The three new runtime results

Claude's [EVIDENCE §4b](2026-10-13-independent-readiness-fable/EVIDENCE.md) and [findings-draft re-verification section](2026-10-13-independent-readiness-fable/evidence/findings-draft.md) report the following against its disposable audit database in development mode:

1. **ORG-003:** a member's rule assigned another household's category and tag to a transaction; the foreign tag's usage count increased. The foreign household's tag-list endpoint did not list the transaction. This proves a cross-household reference/write integrity failure; it does not by itself establish every possible read leak.
2. **ORG-004:** tag dry-run created a transaction-tag link and increased usage; split dry-run created two split rows. The returned preview did not faithfully describe those writes. The category-only probe from the first audit never covered these branches.
3. **AH-09:** a view-only caller received 200 when writing household preferences; an admin read back the new values. The earlier “per-user preferences” explanation is explicitly withdrawn.

These are Claude-executed results reviewed here, not probes re-executed by Codex on 15 October. FIN-03 transfer-leg deletion and ORG-001 role fall-through remain source-confirmed in this update. Push egress was not probed.

## Remaining contract corrections

### 1. Thandi provider choice is already settled

DEC-11 and WP-19 still ask whether to adopt Claude-primary/Gemini-fallback or choose a single provider. The owner already chose Claude primary with Gemini fallback and explicitly authorized specification-only work. No repeat provider-choice approval is needed.

The [14 October Thandi specification](2026-10-11-deep-readiness/THANDI_PROVIDER_SPEC.md) should govern WP-19, including its role-aware consent and concurrent-spending corrections. Numerical budgets, actual model access, credentials and controlled staging costs remain implementation prerequisites; the provider preference does not.

### 2. WP-19's failure, consent, spending and audit rules are incomplete or contradictory

| Revised Claude text | Required reconciliation with the agreed specification |
|---|---|
| Provider failure/no provider produces a 503 | Eligible Claude failure first follows bounded Gemini failover, then truthful local degraded mode where useful and permitted. Unavailable is appropriate when there is no useful permitted result. |
| “consent copy ... unchanged” | Adding Anthropic requires versioned disclosure of both processors and authorized re-consent before external calls. Owner/admin manages household consent; all attempts recheck it. |
| “per-household cost cap and cancellation in Redis” | Name the durable atomic shared reservation contract: all applicable ceilings, unique attempt claims, idempotent settlement, unknown-charge holds and a separate fallback reservation. A Redis cap statement alone does not establish these guarantees. |
| “no quota consumed” on failure | Distinguish the product's chat quota from external spend. Unknown or known provider charges must not disappear when a response fails or times out. |
| “audit rows unchanged,” but acceptance and G4 say no `ai_query`/audit row on failure | Reconcile explicitly: preserve sanitized operational/audit evidence of request outcome, attempted provider/stage, known or unknown usage and fallback. Prevent empty successful assistant messages, not visibility into failures. |
| DECISIONS external-AI proof checks `used_gemini: true` | Replace a Gemini-only success oracle with separate Claude success, forced eligible Claude failure to Gemini, and final local/unavailable cases, with accurate provider provenance. |

Both assessments allocate 4–7 days to AI, but equal estimates do not make these contracts equivalent. This comparison records the corrections without rewriting Claude's original document.

### 3. Full-scope wording still contains removal alternatives

The revised overview promises every advertised feature, yet WP-04 permits removal of Professional and removes “Configure shared views”; DEC-12 preserves a role-removal alternative. Removing fictitious billing copy is sensible, but dropping a promised capability is a product scope decision and cannot silently count as full completion. Keep permission policy decisions explicit, and reconcile shared-view/entitlement behavior against Codex P03/P05 before declaring the scopes identical.

Settings and data lifecycle remain the largest estimate difference: Claude WP-10/11 is 5–7 days, versus Codex P05 at 12–20 including MFA and broader exit/shared-view work. MFA is separately priced in Claude WP-16, so this is not a direct like-for-like comparison. Compare the actual deliverables and acceptance states before changing the estimate.

### 4. GRZ still needs a reconciled accounting contract

The defects remain: principal is classified as income and disposed bonds remain payable. The previous comparison's qualification also remains: record-only holding creation does not by itself prove every later principal receipt is fictional. Resolve external/manual purchase provenance, return of capital, cash settlement, asset retirement and reporting together. Do not infer that either automatically debiting the purchase or suppressing every principal receipt is the correct repair.

## Arithmetic and evidence corrections

I independently summed the revised 21 packet rows: **70.5–107.5 days is correct**. The exact 15% reserve calculation is **81.075–123.625**, reasonably rounded to **81–124**.

| Comparison | Correct overlap |
|---|---|
| Claude 70.5–107.5 versus Codex 72–122, before reserves | **72–107.5 days** |
| Claude approximately 81–124 versus Codex approximately 87–147, with their respective reserves | **87–124 days** |

The README/launch-plan statement “overlap 81–122” mixes the two bases. Claude's own detailed comparison already gives the correct unbuffered intersection. Use consistent reserve assumptions for a delivery forecast. Its March–April 2027 one-developer release-candidate dates are projections, not verified commitments or a fresh combined estimate. The first audit estimates were independently produced; the updated packet plan follows the cross-read and adoption, so its convergence is not wholly independent corroboration.

GAPS §1b contains **13 table rows covering 14 IDs** labelled “not exercised,” not 12: FIN-04/08/09/13/14, AH-06/10/12, OPS-004/010, ORG-005, ORG-007/008 and QA-01. AH-06 has separate recipient-binding evidence; the unexercised case here is concurrency. These are Claude's verification labels, not a claim that neither assessor ever exercised any part of those findings: Codex previously reproduced FIN-04's account-import failure.

Other statements still need qualification:

- The broad “ledger core is sound” claim remains bounded by the original 21-account fixture and tested operations. That reconciliation predates the additional rule/split probes and does not clear all edit/delete, liability-sign or import-loss cases.
- The revised comparison labels Codex's **future** verification mode as test mode. That describes the original local audit environment, not the original completion requirement: Codex P19 already required production-mode/staging evidence.
- “All P0s runtime except scheduler” is no longer accurate after adopting source-only FIN-03 and conditional push egress risk. Keep evidence labels per finding.
- No intended staging environment has been proved ready. “Nothing deployed” is stronger than the evidence of an unavailable/unverified deployment.

## Recommended consolidated position

1. Accept the full-product re-scope and the three additional runtime confirmations.
2. Carry both assessments' IDs and acceptance evidence; retain all Claude-new financial/UI findings from the previous comparison.
3. Use the already-selected Thandi specification as WP-19's governing contract, with the corrections above propagated to decisions and release gates.
4. Reconcile remaining settings/shared-view/role scope and GRZ accounting decisions, then price the same deliverables with one reserve policy.
5. Keep readiness NO-GO until fixes and candidate-SHA staging evidence close the required gates. A more complete assessment does not raise runtime readiness by itself.

This review changed only comparison documents. Claude's assessment, application source, configuration and databases were not modified, and no runtime tests or provider calls were made.
