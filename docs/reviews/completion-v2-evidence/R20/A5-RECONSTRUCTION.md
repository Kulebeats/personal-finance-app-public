# A5 portable privacy fixture reconstruction

Status: synthetic input reconstruction only, 15 October 2026. No current endpoint, database or privacy result is asserted here. Governing R04/R20 contracts supersede historical behavior. Provisioning and actual owner/member/outsider oracles remain required.

Separate reviewer accepted `538bc47` after independently matching source literals and integer-cent arithmetic. No script execution, credential/state-file reuse or runtime privacy acceptance was inferred.

## Source and phase boundaries

The preserved [security/privacy evidence](../../2026-10-13-independent-readiness-fable/evidence/domain-security-privacy.md), section 2, describes the private-account leak fixture. Read-only inspection of historical `.local/readiness-fable-2026-10-13/scratch-security-privacy/p1.mjs`, `p3.mjs` and `p5.mjs` supplies exact dates, account types and link setup. No historical script was executed, and no jar, password, stored ID or connection state was reused. The complete inputs needed from those files are recorded below.

Household membership acceptance, role changes, owner transfer and lockout were earlier/later probe phases. Do not reconstruct the final mutated household as the initial privacy fixture. In particular, the historical member was briefly admitted as admin through a wrong-recipient invitation defect. A fresh privacy fixture must explicitly create the intended member role; invitation correctness has its own R03 scenario.

## Fresh actors and logical references

| Logical actor | Household | Role in this baseline | Purpose |
|---|---|---|---|
| OWNER | A | owner | Owner of private account; positive visibility control |
| MEMBER | A | member | Shared-data positive and private-data negative controls |
| OUTSIDER | B | owner | Foreign-household denial; must not join A implicitly |

Generate fresh IDs and synthetic email addresses; establish verified identity through the protected fixture boundary. Household base currency is ZMW. The portable scenario pins UTC server, Africa/Lusaka actor/household timezone and as-of date 2026-10-14; this is an explicit test convention, not a recovered historical host-clock guarantee. Admin, view_only and Professional are separate role variants with independent reset state. Unknown-role denial uses a controlled seam if the schema enum forbids it, never a weakened production enum.

| Key | Account type | Currency | Opening | Visibility / owner |
|---|---|---|---:|---|
| PRIVATE | savings | ZMW | 5000.00 | private, OWNER |
| SHARED | checking | ZMW | 1000.00 | shared, OWNER |

| Key | Date | Type | Account | Amount | Synthetic label |
|---|---|---|---|---:|---|
| PRIVATE_EXPENSE | 2026-10-05 | expense | PRIVATE | 777.77 ZMW | PRIVSECRET purchase |
| SHARED_EXPENSE | 2026-10-05 | expense | SHARED | 11.11 ZMW | SHAREDTXN coffee |

The historical private transaction's own `is_private` flag was false: privacy came from its parent account. Preserve this case to detect readers that filter only the transaction flag. Exact persisted transaction/account/household/owner links must be checked; a label or total alone is insufficient. Transaction-level privacy true and a different author's private account require separate variants.

## Linked surfaces

- Shared goal: A5 Shared Goal, type save_up, goalType emergency_fund, target 10000.00 ZMW. Enable spendingReducesProgress and link PRIVATE_EXPENSE as spending. Historical `p3.mjs` first attempted a contribution link; `p5.mjs` establishes the spending scenario. Do not assume both attempts create valid links or replay the ambiguous sequence.
- Shared tag: A5Tag, color #112233, attached by OWNER to both expense rows.
- Recurring: created by OWNER from PRIVATE_EXPENSE, frequency monthly, linked to the private account and source transaction. The historical API inferred scheduling fields; it did not specify a complete portable next-due/end-date contract. A future builder must pin and independently read those fields before recurrence/tick assertions. This reconstruction supports privacy linkage, not recurring schedule correctness.
- Optional negative-write control: MEMBER owns a separate emergency_fund/save_up goal with target 100.00 ZMW and spendingReducesProgress enabled. Attempts to attach PRIVATE_EXPENSE or PRIVATE must leave links/progress unchanged.

## Independent expected observations

| Observation | Literal expected result |
|---|---:|
| PRIVATE after expense | 5000.00 - 777.77 = 4222.23 ZMW |
| SHARED after expense | 1000.00 - 11.11 = 988.89 ZMW |
| OWNER visible net worth | 4222.23 + 988.89 = 5211.12 ZMW |
| MEMBER visible net worth | 988.89 ZMW |
| OWNER visible expenses | 777.77 + 11.11 = 788.88 ZMW |
| MEMBER visible expenses | 11.11 ZMW |

Each sensitive read needs OWNER's positive control as well as MEMBER's denial/filtering and a same-surface shared-data positive control. Scan private names, exact generated private account/transaction/rule IDs, amount 777.77 and totals 788.88/4222.23/5211.12; compare actual structured rows/counts, not string scanning alone. A public shared goal/tag may remain visible, but its private linked rows, activity, aggregates and metadata must be filtered under the requesting actor. OUTSIDER must not receive A's shared or private rows.

Required surfaces include goals transactions/activity/summary, tag transactions, recurring list/detail/transactions/history, reports/exports and recap. Metadata counts must match visible data. Direct private-resource requests use the governing non-disclosing denial contract; do not interpret a failed unrelated authentication or step-up check as a proved privacy check. The historical private-transfer request stopped at STEP_UP_REQUIRED, so it did not establish downstream visibility enforcement.

Negative writes include editing the private recurring rule, unlinking the private goal transaction, tagging/linking/assigning the private account or transaction, and writing or transferring against PRIVATE. Compare persisted before/after state and audit effects. Execute each in a reset scenario so one successful unauthorized mutation cannot hide the next. These are acceptance requirements, not claims that the baseline or current implementation satisfies them.
