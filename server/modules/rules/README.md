# Rules Module

Auto-categorization rules for transactions.

## Endpoints

| Method | Path     | Auth   |
| ------ | -------- | ------ |
| GET    | /        | all    |
| GET    | /:id     | all    |
| POST   | /        | member |
| PUT    | /:id     | member |
| DELETE | /:id     | member |
| PUT    | /reorder | member |
| POST   | /preview | member |

## Privacy (CLAUDE.md Rule 11)

All bulk paths that read or mutate transactions — apply-to-past on create/update,
`POST /preview`, and `RuleService.testRule` — fetch via
`findByHouseholdWithVisibility(householdId, userId, ...)`: a member never reads or
mutates another member's private transactions. `dryRunRule` enforces the same via
`findByIdWithVisibility` (SCP-334), and `applyRulesToTransactions` skips foreign
private transactions as defence-in-depth even if handed an unfiltered list.

## Known Limitations

### INT-RULES-001: Rule-Based Transaction Splits Not Persisted

**Status:** Architectural limitation (deferred to future improvement)

**Context:** Rule-based split transactions (created by `server/services/rule/actions.ts:138-212`) are not persisted in the `transaction_splits` table, unlike manually created splits. When a rule action splits a transaction, the splits are applied directly to the transaction's amount and category, but no split records are created.

**Impact:**

- Rule-generated splits and manual splits have different data representations
- Budget reporting queries that rely on `transaction_splits` table may miss rule-based splits
- Split editing and analytics features need to handle both types of splits differently
- Inconsistent data model increases complexity for future features

**Workaround:**

- Rule-based splits are reflected in the transaction amount and category assignments
- Budget calculations use transaction amounts directly, so they capture rule-based splits
- UI displays transaction details correctly based on applied rule actions

**Future Improvement:**

Consider unifying split representation by persisting all splits (both manual and rule-based) in the `transaction_splits` table. This would require:

1. Schema migration to ensure transaction_splits supports rule-based metadata
2. Update rule action execution to create split records
3. Update budget/reporting queries to use unified split table
4. Migration script to backfill existing rule-based splits
