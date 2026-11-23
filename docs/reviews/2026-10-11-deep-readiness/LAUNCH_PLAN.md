# Full delivery and launch plan

The owner explicitly withdrew the November deadline during assessment. **This plan is driven by completion gates, not a date or feature cuts.** Staging is required early. The final target is the full existing application, followed by a controlled invited-household rollout and then broader release if desired.

## Capacity and honest estimate

Assumption: one primary developer familiar with this repository, about six focused engineering hours per day, timely product decisions and provider access. The owner has not supplied confirmed staffing or a staging URL. Estimates include implementation/local tests and separate integration/release acceptance; external waiting is additional.

| Packet | Scope | Developer days | Depends on |
|---|---|---:|---|
| P00 | Environments, dependencies, baseline | 2–4 | None |
| P01 | Sessions, safe DTOs, credential integrity | 3–5 | P00 |
| P02 | Verified onboarding and recovery | 2–4 | P01, controlled SMTP |
| P03 | Full household lifecycle | 4–7 | P02 |
| P04 | Privacy/role/reference matrix | 3–5 | P01/P03 contracts |
| P05 | Profile, MFA UI, self-service export/erasure, shared views | 12–20 | P01–P04 |
| P06 | Ledger/account/currency/cache invariants | 4–6 | P04 |
| P07 | Import/export completion | 3–5 | P06 |
| P08 | Budgets and rollover | 3–5 | P06/P12 |
| P09 | Goal lifecycle integrity | 2–4 | P04/P06 |
| P10 | Investments/GRZ full lifecycle | 4–7 | P04/P06, P11 contracts |
| P11 | Recurring and reliable workers | 3–5 | P06, domain occurrence contracts |
| P12 | Categories/tags/merchants/rules/presets | 3–5 | P04/P06 |
| P13 | Dashboards/reports/cash flow | 3–5 | Financial domains and P12 |
| P14 | Durable storage and receipt/OCR journey | 2–4 | P00/P04/P06/P11 |
| P15 | Notifications and recap | 3–5 | P04/P11/P13 |
| P16 | Claude primary, Gemini fallback, AI functionality and provider controls | 4–7 | P04/P13/P18 foundation |
| P17 | UX/accessibility/device completion | 3–5 | Domain journeys, continuous work |
| P18 | Production operations/recovery/performance | 4–6 | Starts with P00, closes after domains |
| P19 | Integrated acceptance and release | 5–8 | All completion outcomes |
| **Total** | **Full existing scope plus CHG-AI-01** | **72–122** | |

This is approximately **432–732 focused engineering hours**. Add a 20% planning reserve for unexpected integration/data-migration issues: about **87–147 developer-days /18–30 working weeks** for one developer, before leave, public holidays and external waits. That is roughly **four to seven months**, not a commitment to a particular date. A second capable engineer can parallelize frontend/domain and operations work after shared contracts settle; do not simply halve the estimate because privacy, schema, integration and review remain shared dependencies.

Revision note, 11 October: the owner requested [Claude as Thandi's primary and Gemini as fallback](THANDI_PROVIDER_SPEC.md), specification only. P16 increased from2–4 to4–7 days, adding2–3 days to the prior70–119-day baseline. Other packet estimates and the62 existing findings are unchanged. No provider has been connected or credits spent for this change.

The specialist estimates are alternate decompositions, not extra rows to add: auth/household23–41 days; finance16.5–32 days; operations and organization packets overlap common privacy, ledger, jobs and testing work. The central total budgets each outcome once. P05 is deliberately large: a complete settings/identity/data-lifecycle product cannot be treated as a one-day polish task.

Re-estimate at G1 and G2 using actual throughput. Scope additions such as new bank connections, brokerage execution, subscriptions or additional authentication methods need their own estimate. Containment flags are allowed while repairs are built, but cannot be counted as completed advertised features.

## Dependency sequence and checkpoints

| Phase | Work and concrete exit evidence | Gate / consequence |
|---|---|---|
| **1. Establish the target and safe proving environment** | P00; ratify shared contracts; provision staging and controlled providers; identify existing real data/migration risks; begin P18 storage/health/TLS foundations | **G0:** known staging URL/service/SHA/runtime/DB, safe test binding, named owners, decisions recorded. Do not run mutating tests against ambient data. |
| **2. Close identity and tenant boundaries** | P01–P04; verified user joins through actual invitation; Professional/unknown-role policy fails closed; all direct and indirect privacy routes tested; start P05 in vertical slices | **G1:** two households and all five offered roles (owner/admin/member/view_only/Professional), outsider and invalid-role controls, real cookies/mail links, no auth-material DTO leakage, no foreign/private references or unauthorized writes. Any P0 privacy/auth failure blocks real-data use. |
| **3. Establish one trustworthy financial core** | P06/P07/P12; ledger invariants, currencies, cache consistency, rule planning/execution, imports and taxonomy/merchant contracts | **G2:** independent ledger and retry/concurrency/failure fixtures reconcile; dry runs write nothing; import cannot lose rows or split transfers. Re-estimate complex migrations here. |
| **4. Complete planning and investments** | P08–P11, P13; budgets/goals/recurring/holdings/GRZ/reporting through entire lifecycle; complete P05 self-service settings/exit | **G3:** domain outputs, report/chart/table/export values and scheduled effects agree; no silent fallback, fake average, lost basis or unreversed link. All22 module journeys have concrete fixtures. |
| **5. Finish integrations and user experience** | P14–P17; receipt/OCR/storage, notifications/recap/push, AI/model/consent, responsive/accessible journeys; continuous production-like staging | **G4:** every advertised control reaches a real successful flow and useful failure state; real controlled-provider proof; mobile and assistive-technology issues closed. Hiding these modules does not satisfy G4. |
| **6. Prove operations and freeze a release candidate** | Close P18 and P19: realistic migration rehearsal, load, outages, TLS/CSRF/cookies/CSP, DB+file restore, code rollback, full UAT, current dependency/CI evidence | **G5:** exact candidate SHA has complete evidence; all required findings closed and product owner accepts UAT. No unverified production requirement marked done. |
| **7. Controlled release and expansion** | Deploy accepted candidate, run post-deploy smoke, onboard first households, monitor actual outcomes/support, then widen access | **G6:** stable real use, scheduled jobs and recovery/support ready; expansion is an explicit owner decision. |

The dependencies form a directed plan, not an invitation to wait for one enormous batch. Deliver short vertical slices with code + test + UI + database proof. P18 begins in Phase1; P17 quality work begins with the first UI changes. Job occurrence contracts are designed jointly with domains before P10/P11 implementation, avoiding a circular dependency. Source-only organization issues need safe reproductions before repair, without exposing them to real households.

## First ten working days after implementation is authorized

This is an initial execution sequence, not a promise that every task below closes in ten days. No application changes have begun in this assessment.

| Window | Priority work | Reviewable output |
|---|---|---|
| Days1–2 | Confirm product contracts, actual staging service/runtime/DB/provider ownership; inventory migration/data risks; safe test target binding | Approved decision ledger, environment map, disposable harness guard, baseline CI/audit |
| Days3–4 | Targeted dependency/runtime updates; both-store session revocation and allowlisted DTOs | Small reviewed changes with two-cookie/DTO regression evidence; supported-runtime build |
| Days5–6 | Verified registration/resend/reset link flow and onboarding query gating | Captured mail link -> fresh browser -> row read-back, pending identity denied financial access |
| Days7–8 | Household invitation contract and role default-deny; begin highest-risk privacy paths | Correct recipient/role matrix, invite acceptance and direct/related boundary regression cases |
| Days9–10 | Finish remaining G1 cases; characterize import replay, rule preview/splits and cache failures for G2 | G1 evidence pack or explicit remaining blockers; updated effort estimate and next slice |

If a foundation takes longer, move later work instead of weakening acceptance. Record discoveries and estimate changes in the register. No old “98/100” score or successful smoke run overrides a failing invariant.

## Ownership and decisions still needed

| Decision / resource | Proposed default or reason needed | Needed by |
|---|---|---|
| Actual deployment account/service and staging URL | No verified intended URL was provided; blueprint candidate did not prove a live app | G0 |
| Staffing and review ownership | Plan assumes one primary developer; name engineering, operations, QA and product decision owners (one person may wear several hats) | G0 |
| Household roles and shared views | Complete all offered roles including Professional with explicit privileges; unknown role denies; agree private aggregate behavior | Before P03/P04/P05 |
| MFA policy | Approve mandatory-policy scope, existing-session enforcement and currency-normalized high-value rules including missing/stale FX; complete self-service enrollment/recovery regardless | Before P05 policy implementation |
| Profile fields and data lifecycle | Every offered field must work; approve necessity, clearing and retention; export/erasure and shared-record consequences | Before P05 schema/UI work |
| Money semantics | Historical/current FX, refunds/pending/private budgets, import balance options, allocation limits, record-only investments | Before P06–P10 |
| Schedule semantics | Catch-up, anchor/timezone/end-date and actual versus estimated investment yields | Before P10/P11 |
| Provider accounts and budget | SMTP, storage, Redis, AI and push; controlled staging recipients and consent/data-processing choices | Begin G0; proof by G4 |
| Service/support targets | Ratify performance workload, backup frequency, recovery targets, incident/support/data-request contacts | Before P18 closure |
| Release acceptance | Owner accepts product behavior and completed evidence; deployment/public rollout remains separately authorized | G5/G6 |

These decisions do not block completing this assessment/specification. They become concrete prerequisites during implementation. There is no need to buy or connect a new platform merely to start the repairs; use existing hosting/provider arrangements once their identities are verified.

## Launch checklist and stopping rules

- All P0/P1 findings closed at the candidate SHA; P2 items that represent advertised functionality also completed. Any accepted limitation is explicit and cannot contradict the full-functionality promise.
- J01–J16 in the specification pass with real UI/API/database/provider boundaries, supported browsers/devices and production protections. A test with no assertion or a skipped populated state cannot close its journey.
- Current CI, package audit and supported runtime; reviewed migrations/backfills, data comparison and compatible rollback. Schema downgrade is not assumed safe.
- Verified TLS/proxy/session/CSRF/CSP, actual dependency health, durable files, scheduled job history, correct notification/provider outcomes and actionable alerts.
- Measured DB+files restoration into a fresh target, recovery timings and operator handover. Backups that have never been restored are insufficient evidence.
- Complete help/privacy/retention/consent/export/exit/support copy reflects real behavior. Domain owner validates financial/GRZ conventions; no unsupported regulatory claim.
- Owner UAT covers household collaboration and every advertised module; independent reviewer signs off evidence quality. Record scope/version/revision/time, not a generic “looks good.”

Stop release if any private/foreign data is visible or writable incorrectly, if money cannot reconcile, if retry/concurrency corrupts state, if accepted data can vanish on restart, if recovery fails, or if basic identity/onboarding/exit is unusable. A dependency/production-protection blocker is not waived because the audience is small. Address the cause and repeat the affected proof.

## Controlled launch after completion

Use two or three consenting invited households initially, with a named support owner and rollback contact. Record the release SHA and schema, take a recoverable backup, deploy, verify health and authenticated read/write/read-back with synthetic production smoke data under the approved process, then admit participants. Do not use their real money/history as the first test of a feature.

For the first48–72 hours, watch auth failures,5xx/errors, ledger reconciliation alarms, job overdue/failure counts, upload failures, provider delivery/costs and support reports. Check daily summaries and the next actual scheduled runs; a weekly job may require a controlled run plus observation of its real scheduled occurrence. Keep code rollback and feature containment available for incidents, but fix and re-prove the full feature before calling the release complete. Expand only after the evidence and household feedback support it.

This document creates no automation, deployment, purchase, invitation or external message. It is the complete plan for the next authorized implementation stage.
