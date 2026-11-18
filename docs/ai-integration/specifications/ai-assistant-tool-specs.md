# Thandiso AI Tool Specifications

Version: 2.1
Date: 2026-07-12
Status: Canonical Tool Contract

> **Implementation status note (2026-07-12, code-verified):** the 12-tool inventory,
> privacy filters (§1.3), tool cap (§1.5), and sanitized-egress policy (§1.6) are
> SHIPPED (`ai.gemini.ts`, `ai.privacy-filters.ts`, `ai.sanitizer.ts`,
> `ai.validation.ts`). Two parts of this contract are NOT yet implemented and must not
> be assumed by consumers:
> 1. §1.1/§3 — shipped sanitized outputs serialize amounts as **plain decimal strings**
>    (e.g. `"amount": "245.00"`) with currency supplied as prompt context, NOT as
>    `MoneyDto` objects (see `SanitizedTransactionData` et al., `ai.types.ts:174-275`).
> 2. §1.2/§4 — `convertedAmount` multi-currency handling and the metadata fields
>    (`resultCount`, `truncated`, `excludedCount`, `excludedCurrencies`, `emptyReason`)
>    do not exist in code (traceability rows FR-AI-011/012/016: Not implemented).
> None of this affects the chat client: tool outputs never reach the client — only the
> generated `reply` text does.

---

## 1. Cross-Tool Rules

### 1.1 Money

- Internal calculations must use `Money`.
- Serialized outputs use `MoneyDto`:

```json
{ "amount": "123.45", "currency": "ZMW" }
```

### 1.2 Multi-Currency

- Use `convertedAmount` in household base currency when available.
- Exclude non-convertible rows from aggregates.
- Return metadata:
  - `excludedCount`
  - `excludedCurrencies[]`

### 1.3 Privacy and Soft-Delete Filters

Always exclude:
- `deletedAt != null`
- `isArchived = true`
- `isHidden = true`
- private data not visible to requester role
- `hideTransactions = true`

### 1.4 Empty-State Contract

No hallucinated values. Return explicit empty metadata:
- `emptyReason` such as `no_transactions`, `no_goals`, `no_budgets`.

### 1.5 Deterministic Execution

- Maximum 2 tools per query.
- Deterministic priority based on intent classifier.

### 1.6 Logging and Payload Policy (Resolved)

- Raw tool outputs are internal only.
- Audit logs store sanitized tool summaries only.
- Provider payloads receive sanitized and bounded summaries only.
- Internal identifiers (`transactionId`, `accountId`, `merchantId`, `goalId`) must be removed or mapped to non-sensitive aliases before logging/provider calls.

---

## 2. Tool Inventory (MVP)

| Tool | Purpose | Cache TTL | Max Results |
|---|---|---|---:|
| `get_spending_by_category` | category spend for period | 5m | 20 |
| `get_budget_status` | budget vs spent status | 5m | 20 |
| `get_goals_status` | goal progress | 5m | 20 |
| `get_upcoming_recurring` | upcoming recurring payments | 5m | 20 |
| `get_recent_transactions` | latest transactions | none | 20 |
| `get_account_balances` | current account balances | 5m | 20 |
| `get_merchant_spending` | spend by merchant | 5m | 20 |
| `get_category_trends` | monthly category trends | 5m | 10 |
| `get_monthly_summary` | income vs expenses summary | 5m | 1 |
| `get_transaction_search` | filtered transaction search | none | 20 |
| `get_goal_assignments` | goal-account links and progress | 5m | 20 |
| `get_cash_flow` | short-horizon cash flow projection | 5m | 1 |

---

## 3. Representative Output Shape

Internal output may include IDs for joins. Sanitized output for logs/provider must remove those IDs.

Example sanitized transaction result:

```json
{
  "date": "2026-02-01",
  "description": "Groceries",
  "amount": { "amount": "245.00", "currency": "ZMW" },
  "category": "Food",
  "merchant": "Shoprite"
}
```

## 4. Required Metadata for Sanitized Results

Each tool summary must include:
- `resultCount`
- `truncated: boolean`
- `excludedCount`
- `excludedCurrencies`
- `emptyReason` when applicable

## 5. Validation Requirements

- Strict input schema validation.
- Range limits for `days`, `months`, `limit`.
- Provider-bound payload hard cap to enforce token budget.
