# AddTransactionModal Refactoring Plan v2

## Objective
Refactor `AddTransactionModal` to use new TanStack Query hooks and support edit/delete modes.

## Current State Analysis

**File**: `client/src/components/AddTransactionModal.tsx` (341 lines)

**Critical Issues Identified**:
1. Uses legacy `useTransactions().add` which doesn't return proper success/error handling
2. Category field saves `name` but API expects `categoryId`
3. Account field is optional but API requires `accountId`
4. Amount is number but API expects string
5. No edit or delete capability

---

## Approach Decision: Single Modal vs. Separate Modals

### Option A: Single Dual-Mode Modal (Recommended)
- Fewer files to maintain
- Shared form logic
- Consistent UX

### Option B: Separate Modals
- Simpler individual components
- More code duplication
- Clearer separation of concerns

**Recommendation**: Option A with good internal organization

---

## Implementation Plan

### Phase 1: Props Interface Update

```typescript
interface TransactionModalProps {
  // Trigger mode (uncontrolled)
  children?: React.ReactNode;

  // Controlled mode
  open?: boolean;
  onOpenChange?: (open: boolean) => void;

  // Edit mode
  transaction?: Transaction | null;

  // Callbacks
  onSuccess?: () => void;
}

// Derived state
const isEditMode = !!transaction;
const isControlled = open !== undefined;
```

### Phase 2: Hook Replacements

**Before**:
```typescript
import { useTransactions, useCategories, useAccounts } from "@/hooks/use-finance-data";

const { add: addTransaction } = useTransactions();
const { categories } = useCategories();
const { accounts } = useAccounts();
```

**After**:
```typescript
import { useCreateTransaction, useUpdateTransaction, useDeleteTransaction } from "@/hooks/useTransactions";
import { useAccounts } from "@/hooks/useAccounts";
// Keep useCategories from use-finance-data until categories API exists

const createMutation = useCreateTransaction();
const updateMutation = useUpdateTransaction();
const deleteMutation = useDeleteTransaction();
const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
```

### Phase 3: Form State Management

**Option A: Keep useState (minimal changes)**
```typescript
const [formData, setFormData] = useState({
  amount: "",
  merchant: "",
  categoryId: "",  // Changed from category (name) to categoryId
  accountId: "",   // Changed from account
  notes: "",
  date: new Date(),
  type: "expense" as "expense" | "income",
  isRecurring: false,
});

// Initialize form when transaction prop changes
useEffect(() => {
  if (transaction) {
    setFormData({
      amount: Math.abs(parseFloat(transaction.amount)).toString(),
      merchant: transaction.name,
      categoryId: transaction.categoryId || "",
      accountId: transaction.accountId,
      notes: transaction.notes || "",
      date: new Date(transaction.date),
      type: transaction.type,
      isRecurring: transaction.isRecurring || false,
    });
  }
}, [transaction]);

// Reset form when modal closes
const resetForm = () => {
  setFormData({
    amount: "",
    merchant: "",
    categoryId: "",
    accountId: "",
    notes: "",
    date: new Date(),
    type: "expense",
    isRecurring: false,
  });
};
```

**Option B: Use react-hook-form + Zod (recommended for production)**
```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const transactionSchema = z.object({
  amount: z.string().min(1, "Amount is required").refine(
    val => !isNaN(parseFloat(val)) && parseFloat(val) > 0,
    "Amount must be a positive number"
  ),
  merchant: z.string().min(1, "Merchant is required"),
  categoryId: z.string().min(1, "Category is required"),
  accountId: z.string().min(1, "Account is required"),
  notes: z.string().optional(),
  date: z.date(),
  type: z.enum(["expense", "income"]),
  isRecurring: z.boolean(),
});

type TransactionFormData = z.infer<typeof transactionSchema>;

const form = useForm<TransactionFormData>({
  resolver: zodResolver(transactionSchema),
  defaultValues: {
    amount: "",
    merchant: "",
    categoryId: "",
    accountId: "",
    notes: "",
    date: new Date(),
    type: "expense",
    isRecurring: false,
  },
});

// Reset with transaction data in edit mode
useEffect(() => {
  if (transaction) {
    form.reset({
      amount: Math.abs(parseFloat(transaction.amount)).toString(),
      merchant: transaction.name,
      categoryId: transaction.categoryId || "",
      accountId: transaction.accountId,
      notes: transaction.notes || "",
      date: new Date(transaction.date),
      type: transaction.type,
      isRecurring: transaction.isRecurring || false,
    });
  }
}, [transaction, form]);
```

### Phase 4: Submit Handler

```typescript
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();

  // Validation
  if (!formData.amount || !formData.merchant || !formData.categoryId || !formData.accountId) {
    // Show validation errors (handled by react-hook-form if using Option B)
    return;
  }

  const amount = parseFloat(formData.amount);

  if (isEditMode && transaction) {
    // UPDATE
    updateMutation.mutate({
      id: transaction.id,
      data: {
        date: format(formData.date, "yyyy-MM-dd"),
        name: formData.merchant,
        amount: amount.toString(),
        type: formData.type,
        categoryId: formData.categoryId,
        notes: formData.notes || null,
      },
    }, {
      onSuccess: () => {
        handleClose();
        onSuccess?.();
      },
    });
  } else {
    // CREATE
    createMutation.mutate({
      accountId: formData.accountId,
      date: format(formData.date, "yyyy-MM-dd"),
      name: formData.merchant,
      amount: amount.toString(),
      type: formData.type,
      categoryId: formData.categoryId,
      notes: formData.notes || undefined,
      isRecurring: formData.isRecurring,
    }, {
      onSuccess: () => {
        handleClose();
        resetForm();
        onSuccess?.();
      },
    });
  }
};
```

### Phase 5: Delete Handler with Proper Confirmation

```typescript
const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

const handleDelete = () => {
  if (!transaction) return;

  deleteMutation.mutate(transaction.id, {
    onSuccess: () => {
      setShowDeleteConfirm(false);
      handleClose();
      onSuccess?.();
    },
  });
};

// In JSX, use AlertDialog instead of confirm()
{showDeleteConfirm && (
  <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete Transaction</AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to delete this transaction? This action cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          className="bg-destructive text-destructive-foreground"
        >
          {deleteMutation.isPending ? "Deleting..." : "Delete"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)}
```

### Phase 6: Controlled/Uncontrolled Mode Handling

```typescript
// Internal state for uncontrolled mode
const [internalOpen, setInternalOpen] = useState(false);

// Use controlled value if provided, otherwise internal
const isOpen = isControlled ? open : internalOpen;

const handleOpenChange = (newOpen: boolean) => {
  if (isControlled) {
    onOpenChange?.(newOpen);
  } else {
    setInternalOpen(newOpen);
  }

  // Reset form when closing in add mode
  if (!newOpen && !isEditMode) {
    resetForm();
  }
};

const handleClose = () => handleOpenChange(false);
```

### Phase 7: Category Fix

**Problem**: Current code uses category name as value, but API expects categoryId.

**Fix**: Update Select component to use category ID:

```typescript
// BEFORE (broken)
<SelectItem key={cat.id} value={cat.name}>
  {cat.name}
</SelectItem>

// AFTER (correct)
<SelectItem key={cat.id} value={cat.id}>
  {cat.name}
</SelectItem>
```

**Note**: Also need to handle the static `budgetCategories` - either:
1. Remove them (use only API categories)
2. Give them consistent IDs
3. Create a categories API endpoint

### Phase 8: Loading States

```typescript
const isSubmitting = createMutation.isPending || updateMutation.isPending;
const isDeleting = deleteMutation.isPending;

// Disable form during submission
<Button type="submit" disabled={isSubmitting}>
  {isSubmitting ? (
    <>
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {isEditMode ? "Saving..." : "Adding..."}
    </>
  ) : (
    isEditMode ? "Save Changes" : "Add Transaction"
  )}
</Button>

// Disable all inputs during submission
<Input
  disabled={isSubmitting || isDeleting}
  ...
/>
```

### Phase 9: UI Updates for Edit Mode

```typescript
<DialogHeader>
  <DialogTitle>{isEditMode ? "Edit Transaction" : "Add Transaction"}</DialogTitle>
  <DialogDescription>
    {isEditMode
      ? "Update the transaction details below."
      : "Manually add a new transaction to your records."
    }
  </DialogDescription>
</DialogHeader>

// ...

<div className="flex justify-end gap-2 mt-4 pt-4 border-t">
  {isEditMode && (
    <Button
      type="button"
      variant="destructive"
      onClick={() => setShowDeleteConfirm(true)}
      disabled={isSubmitting || isDeleting}
    >
      Delete
    </Button>
  )}
  <div className="flex-1" /> {/* Spacer */}
  <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
    Cancel
  </Button>
  <Button type="submit" disabled={isSubmitting}>
    {isEditMode ? "Save Changes" : "Add Transaction"}
  </Button>
</div>
```

### Phase 10: Handle Recurring Fields in Edit Mode

**Decision needed**: Should recurring transactions be editable?

**Recommendation**: Hide recurring section in edit mode (recurring transactions should be edited via Recurring page).

```typescript
{/* Only show recurring section in add mode */}
{!isEditMode && (
  <div className="space-y-4 border border-border rounded-lg p-3 bg-muted/10">
    {/* Recurring transaction UI */}
  </div>
)}
```

---

## File Changes Summary

### Modified Files

| File | Changes |
|------|---------|
| `client/src/components/AddTransactionModal.tsx` | Full refactor |
| `client/src/pages/Transactions.tsx` | Pass transaction prop for edit mode |

### New Dependencies (if using Option B)

```bash
npm install @hookform/resolvers
```
(zod already installed)

---

## Testing Checklist

### Create Mode
- [ ] Can create expense transaction
- [ ] Can create income transaction
- [ ] Validation prevents empty required fields
- [ ] Form resets after successful creation
- [ ] Toast shows on success (no duplicates)
- [ ] Loading state shows during submission
- [ ] Modal closes on success

### Edit Mode
- [ ] Form populates with existing transaction data
- [ ] Can update all fields
- [ ] Amount sign is handled correctly (always positive in form)
- [ ] Save updates transaction correctly
- [ ] Toast shows on success

### Delete Mode
- [ ] Delete button appears only in edit mode
- [ ] Confirmation dialog shows before delete
- [ ] Can cancel delete
- [ ] Delete removes transaction
- [ ] Toast shows on success
- [ ] Modal closes on delete success

### Edge Cases
- [ ] Controlled mode works (open/onOpenChange props)
- [ ] Uncontrolled mode works (children trigger)
- [ ] Account dropdown shows all accounts
- [ ] Category dropdown filters by type (expense/income)
- [ ] Date picker works correctly
- [ ] Notes field is optional

---

## Usage Examples

### Add Mode (Uncontrolled)
```tsx
<AddTransactionModal>
  <Button>Add Transaction</Button>
</AddTransactionModal>
```

### Edit Mode (Controlled)
```tsx
const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);

<AddTransactionModal
  open={!!selectedTxn}
  onOpenChange={(open) => !open && setSelectedTxn(null)}
  transaction={selectedTxn}
  onSuccess={() => setSelectedTxn(null)}
/>

// Open edit modal
<Button onClick={() => setSelectedTxn(transaction)}>
  Edit
</Button>
```

---

## Estimated Complexity

- **Minimal (useState)**: ~2-3 hours
- **Full (react-hook-form + proper validation)**: ~4-5 hours

## Recommendation

Start with **Phase 1-6 using useState** (Option A) to get functionality working, then optionally migrate to react-hook-form later if validation needs grow.
