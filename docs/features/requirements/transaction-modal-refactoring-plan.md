# AddTransactionModal Refactoring Plan (Revised)

## Executive Summary

This plan refactors `AddTransactionModal` (currently ~1,600 lines) into smaller, testable units while preserving behavior. The base phases should reduce the modal to ~1,150-1,300 lines. Hitting the original 900-1,000 line target requires the optional extractions in Phase 6.

## Goals

- Reduce complexity by extracting reusable hooks and components.
- Maintain all existing behavior and data flow (no feature removal).
- Follow existing codebase patterns and hook conventions.
- Improve testability with smaller, focused units.
- Keep utilities pure and SSR/test friendly.

## Current Behavior Must Match

These behaviors are intentionally preserved in the refactor:

- Create mode defaults: form initializes with `type: "expense"`, blank amount, `date: new Date()`, empty account IDs, `tags: []`, and `ownerUserId: null`.
- Create mode open/reset: defaults are recalculated from user preferences, with `rememberLastAccount`, `defaultTransactionType`, and `autoFillTodayDate` applied.
- Edit mode reset: form values are set from the transaction data, tags come from `useTransactionTags`, and merchantName is `transaction.merchantName || transaction.name`.
- Merchant selection: selecting a merchant sets `merchantName`, `merchantId`, and optionally `categoryId` from `defaultCategoryId`.
- Transfer behavior: transfers have a separate update/create path and use `cleanMerchantName` with "Transfer" fallback.
- Tags are updated via `useSetTransactionTags` on create and update.
- Recurring rule is created only in create mode when `isRecurring` and `recurringFrequency` are set.
- Attachments: create mode uploads selected files; edit mode shows existing attachments via `AttachmentsSection`.
- Receipt scan: upload triggers OCR, results are stored, and autofill sets amount, merchant name, and date; receipt is linked after transaction creation.
- Goal linking: create mode links via `goalId` after creation; edit mode uses the inline link/unlink UI.

---

## Phase 0: Baseline Behavior Lock-In (Low Risk)

1. Document the current defaults and update flows (see mapping section in this plan).
2. Add targeted tests or scripts to lock in key behaviors (defaults, tags, goal link, receipts, attachments).
3. If no automated tests are available, add a manual checklist and complete it before and after each phase.

---

## Phase 1: Extract Pure Utilities (Low Risk)

**Target**: Form defaults and merchant name normalization.

### 1.1 Create `client/src/lib/transactionFormUtils.ts`

Notes and fixes:

- Keep utilities pure: do not read `localStorage`, do not import hook types.
- Accept inputs explicitly (ex: `lastAccountId`, `userPrefs`, `now`).
- Preserve edit mode fields (including recurrence fields when available).
- Keep tag defaults based on the transaction tag list, not all tags.

```ts
import type { Transaction } from "@/lib/api";

export type TransactionFormValues = {
  type: "income" | "expense" | "transfer";
  amount: string;
  merchantName?: string;
  merchantId?: string;
  date: Date;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  goalId?: string;
  isRecurring: boolean;
  recurringFrequency?: "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
  recurringEndDate?: Date;
  createRecurringRule: boolean;
  notes?: string;
  tags: string[];
  ownerUserId: string | null;
};

export type UserPreferences = {
  rememberLastAccount?: boolean;
  defaultTransactionType?: string;
  autoFillTodayDate?: boolean;
  rememberLastCategoryPerMerchant?: boolean;
};

export function buildEditModeDefaults(
  transaction: Transaction,
  transactionTagIds: string[],
  existingRecurring?: {
    frequency?: TransactionFormValues["recurringFrequency"];
    endDate?: Date;
  }
): TransactionFormValues {
  return {
    type: transaction.type === "transfer" ? "transfer" : transaction.type === "income" ? "income" : "expense",
    amount: Math.abs(parseFloat(transaction.amount)).toString(),
    merchantName: transaction.merchantName || transaction.name,
    merchantId: transaction.merchantId || "",
    date: new Date(transaction.date),
    accountId: transaction.accountId,
    toAccountId: transaction.transferAccountId || "",
    categoryId: transaction.categoryId || undefined,
    goalId: undefined,
    isRecurring: transaction.isRecurring || false,
    recurringFrequency: existingRecurring?.frequency,
    recurringEndDate: existingRecurring?.endDate,
    createRecurringRule: false,
    notes: transaction.notes || undefined,
    tags: transactionTagIds,
    ownerUserId: transaction.ownerUserId || null,
  };
}

export function buildCreateModeDefaults(options: {
  userPrefs?: UserPreferences;
  lastAccountId?: string | null;
  now?: Date;
}): TransactionFormValues {
  const { userPrefs, lastAccountId, now } = options;
  const defaultAccountId =
    userPrefs?.rememberLastAccount && lastAccountId ? lastAccountId : "";

  const defaultType =
    (userPrefs?.defaultTransactionType as TransactionFormValues["type"]) || "expense";

  const defaultDate = userPrefs?.autoFillTodayDate ? (now ?? new Date()) : (now ?? new Date());

  return {
    type: defaultType,
    amount: "",
    merchantName: "",
    merchantId: "",
    date: defaultDate,
    accountId: defaultAccountId,
    toAccountId: "",
    isRecurring: false,
    createRecurringRule: false,
    tags: [],
    ownerUserId: null,
  };
}

export function cleanMerchantName(value: string): string {
  const cleaned = value
    .replace(/[#*]+/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/\b(pos|purchase|payment|card|debit|credit|txn|ref)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return value.trim();

  return cleaned
    .split(" ")
    .map((word) => {
      if (word.length <= 3 && word === word.toUpperCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}
```

**Migration Steps**:
1. Create `transactionFormUtils.ts` with the pure helpers above.
2. In `AddTransactionModal`, pass `lastAccountId` from `localStorage` and tags from `useTransactionTags`.
3. Confirm recurrence fields: if recurrence data lives elsewhere, plumb it in and preserve existing values.
4. Replace inline `cleanMerchantName` and default logic with utility calls.
5. Add unit tests for default builders and `cleanMerchantName`.

---

## Phase 2: Extract Receipt Scanning Hook (Medium Risk)

**Target**: Consolidate receipt/OCR logic without losing behavior.

Fixes to include:

- Keep autofill fields exactly as today (amount, merchantName, date).
- Guard against stale receipt IDs; ignore OCR results if the receipt ID changed.
- Surface store OCR failures and keep receipt state consistent.

**Migration Steps**:
1. Create `client/src/hooks/useTransactionReceipt.ts`.
2. Move receipt state and handlers.
3. Ensure OCR success triggers `storeOcr` and then autofill.
4. Handle store OCR errors with a toast and avoid clearing `linkedReceiptId` on failure.

---

## Phase 3: Extract Attachment Handling (Medium Risk)

**Target**: Consolidate attachment validation and upload.

Fixes to include:

- Reuse existing hooks in `client/src/hooks/useAttachments.ts` to align toasts and query invalidation.
- Preserve validation rules (type and size) and current error messages.
- Clear attachments on modal close and after successful upload.

**Migration Steps**:
1. Create `client/src/hooks/useTransactionAttachments.ts` that wraps `useUploadAttachment` and provides `uploadAll`.
2. Move validation and file selection into the new hook.
3. Update `AddTransactionModal` to use the hook.
4. Test upload success and partial failure paths.

---

## Phase 4: Extract Goal Selector Component (Low-Medium Risk)

**Target**: Create reusable goal linking UI.

Fixes to include:

- Avoid stale values by passing `currentType` and `currentAmount` from `watch/useWatch` in the parent.
- Preserve create vs edit behavior (inline link UI is edit-only; `goalId` is for create).

**Migration Steps**:
1. Create `client/src/components/transactions/TransactionGoalSelector.tsx`.
2. Move link/unlink UI and logic.
3. Pass `currentType` and `currentAmount` from `form.watch`.
4. Test linking and unlinking in edit mode.

---

## Phase 5: Extract Transfer Form Fields (Optional, Low Risk)

**Target**: Separate transfer-specific inputs.

- Keep `toAccountId` validation and selection logic unchanged.
- Use typed form props rather than `any`.

---

## Phase 6: Optional Deep Extractions (Needed to reach 900-1,000 lines)

If the 900-1,000 line target is required, add one or more of the following:

1. **Extract submission workflow**: move create/update/transfer logic into `useTransactionSubmit` or a service module.
2. **Extract form sections**: move Type/Amount/Date, Merchant/Category, Recurring, Tags, and Attachments into components.
3. **Extract preferences logic**: isolate `rememberLastAccount`, `defaultTransactionType`, and merchant default category updates.

---

## File Structure After Refactoring

```
client/src/
  components/
    transactions/
      AddTransactionModal.tsx
      TransactionGoalSelector.tsx
      TransferFormFields.tsx
  hooks/
    useTransactionReceipt.ts
    useTransactionAttachments.ts
  lib/
    transactionFormUtils.ts
```

---

## Testing Strategy

### Unit Tests
- `transactionFormUtils.test.ts`: defaults, recurrence passthrough, `cleanMerchantName`.
- `useTransactionReceipt.test.ts`: OCR success, OCR failure, store OCR failure.
- `useTransactionAttachments.test.ts`: validation, success, partial failure handling.

### Integration Tests
- Create transaction with receipt and verify autofill + link.
- Create transaction with attachments and verify uploads.
- Edit transaction and link/unlink goal.
- Create transfer transaction.

### Manual Checklist
- Create income/expense/transfer transactions.
- Edit transaction (including tags and notes).
- Scan receipt and confirm autofill + link.
- Upload multiple attachments.
- Link/unlink transaction to goal.
- Create recurring transaction.

---

## Risk Mitigation

- Recurring fields: confirm where recurrence frequency/end-date are stored and preserve them in edit mode.
- Tags: ensure tag defaults come from `useTransactionTags` only.
- Preferences: keep `autoFillTodayDate` behavior exactly as it is now.
- Goal linking: avoid stale values by using `watch/useWatch` for amount/type.
- Utilities: avoid `localStorage` reads and hook types in `lib/`.
- Rollback: use git branches/tags instead of keeping backup files in `src`.

---

## Success Metrics

- Code reduction: ~1,150-1,300 lines after Phases 1-5; 900-1,000 lines only if Phase 6 is used.
- Test coverage: meaningful coverage for new utilities and hooks (focus on defaults and error paths).
- Performance: no regression in modal load time or submit time.
- Bugs: no behavior changes in create/edit flows.

---

## Post-Refactor Opportunities

1. Split into `AddTransactionModal` and `AddTransferModal`.
2. Extract `AnimatedSegmentedControl` into shared `ui/`.
3. Add memoization for extracted components if needed.
4. Add JSDoc for new exports.

## Conclusion

This revised plan keeps behavior stable and addresses the issues identified in the review. It also gives a realistic line-count target and a clear path to reach the original 900-1,000 line goal if needed.
