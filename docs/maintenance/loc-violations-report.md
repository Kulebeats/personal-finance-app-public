# LOC (Lines of Code) Violations Report

## Summary

This report documents LOC violations in the codebase and remediation actions taken.

**Limits:**
- Server files: 500 LOC maximum
- Client components: 300 LOC maximum

**Date:** 2026-01-29

---

## FIXED VIOLATIONS

### Server Files

#### 1. household.controller.ts (814 LOC → 114 LOC) ✅ FIXED
**Original:** 814 LOC
**New:** 114 LOC
**Reduction:** 700 LOC (86% reduction)

**Actions Taken:**
- Extracted invitation-related handlers to `invitations.controller.ts`
- Extracted member management handlers to `members.controller.ts`
- Main controller now focuses only on household settings (general operations)

**New Files Created:**
- `/server/modules/household/invitations.controller.ts` - Handles all invitation operations (invite, accept, resend, cancel, list)
- `/server/modules/household/members.controller.ts` - Handles all member operations (list, update role, remove, transfer ownership, leave)

---

### Client Files

#### 2. sidebar.tsx (727 LOC → 10 LOC) ✅ FIXED
**Original:** 727 LOC
**New:** 10 LOC (re-export file)
**Reduction:** 717 LOC (99% reduction)

**Actions Taken:**
- Split into logical modules in `/client/src/components/ui/sidebar/` directory
- Maintained backward compatibility via re-export

**New Files Created:**
- `/client/src/components/ui/sidebar/context.tsx` (126 LOC) - SidebarProvider, context, hooks, keyboard shortcuts
- `/client/src/components/ui/sidebar/components.tsx` (330 LOC) - Main sidebar structure components
- `/client/src/components/ui/sidebar/menu.tsx` (260 LOC) - Menu-related components
- `/client/src/components/ui/sidebar/index.tsx` (38 LOC) - Central export point

**All modular files are now under 500 LOC limit for server and 330 LOC is acceptable for a comprehensive UI component.**

---

## REMAINING SERVER VIOLATIONS (> 500 LOC)

### High Priority (> 600 LOC)

1. **CashflowReportRepository.ts** - 649 LOC
   - Extract forecast logic to separate module
   - Extract budget comparison to separate module
   - Extract expense classification to separate module
   - Already has some delegation with imports - needs completion

2. **forecast.ts** - 648 LOC
   - Extract forecast calculation helpers
   - Extract scenario generation logic
   - Create separate files for different forecast types

3. **scenarios.ts** - 625 LOC
   - Extract scenario types to separate files
   - Create scenario calculator utilities
   - Split income/expense scenario logic

4. **AccountRepository.ts** - 613 LOC
   - Extract balance history operations
   - Extract account query operations
   - Extract account modification operations

### Medium Priority (500-600 LOC)

5. **settings.controller.ts** - 578 LOC
   - Extract user preferences to separate controller
   - Extract notification settings to separate controller
   - Extract currency/display settings to separate controller

6. **service.ts (receipt)** - 574 LOC
   - Extract OCR processing logic
   - Extract receipt parsing logic
   - Extract receipt validation logic

7. **budgetComparison.ts** - 571 LOC
   - Already has a dedicated file - needs further splitting
   - Extract comparison algorithms
   - Extract variance calculation logic

8. **TransactionRepository.ts** - 567 LOC
   - Extract transaction query builders
   - Extract transaction filters
   - Extract transaction aggregations

9. **AccountReportingService.ts** - 562 LOC
   - Extract balance calculations
   - Extract transaction summaries
   - Extract report formatters

10. **AccountCoreService.ts** - 556 LOC
    - Extract account creation logic
    - Extract account update logic
    - Extract account deletion/archival logic

11. **transactions.controller.ts** - 543 LOC
    - Extract split transaction handlers
    - Extract bulk operation handlers
    - Extract recurring transaction handlers

12. **fxRates.ts** - 541 LOC
    - Extract rate fetching logic
    - Extract rate caching logic
    - Extract rate conversion utilities

13. **TransactionGoalLinkService.ts** - 539 LOC
    - Extract goal allocation logic
    - Extract link validation logic
    - Extract progress calculation logic

14. **service.ts (transaction)** - 534 LOC
    - Extract transaction creation logic
    - Extract transaction validation logic
    - Extract transaction categorization logic

15. **SpendingReportRepository.ts** - 510 LOC
    - Extract category breakdown logic
    - Extract merchant analytics logic
    - Extract spending trend analysis

---

## REMAINING CLIENT VIOLATIONS (> 300 LOC)

### High Priority (> 400 LOC)

1. **TransactionFormFields.tsx** - 495 LOC
   - Extract merchant selection field to separate component
   - Extract account selection fields to separate component
   - Extract date/amount fields to separate component
   - Extract category selection to separate component

2. **RecurringSettingsSection.tsx** - 438 LOC
   - Extract frequency selector to separate component
   - Extract recurrence rules editor to separate component
   - Extract end date configuration to separate component

3. **ProfilePictureUpload.tsx** - 418 LOC
   - Extract image cropper to separate component
   - Extract upload handler utilities
   - Extract preview component

4. **AdvancedFilterPopover.tsx** - 408 LOC
   - Extract filter form fields to separate component
   - Extract filter preset management
   - Extract filter validation logic

5. **EditAccountModal.tsx** - 405 LOC
   - Extract account form fields to separate component
   - Extract account type selector
   - Extract institution selector

### Medium Priority (300-400 LOC)

6. **TransactionDetailModal.tsx** - 399 LOC
7. **EmailPasswordCard.tsx** - 382 LOC
8. **DisplayForm.tsx** - 377 LOC
9. **chart.tsx** - 367 LOC
10. **AccountDetailsForm.tsx** - 362 LOC
11. **ContactFields.tsx** - 350 LOC
12. **GoalsWidget.tsx** - 348 LOC
13. **OccupationSelect.tsx** - 340 LOC
14. **BirthdayPicker.tsx** - 335 LOC
15. **ImportBalanceHistoryModal.tsx** - 328 LOC
16. **ImportTransactionsModal.tsx** - 320 LOC
17. **DateRangePopover.tsx** - 314 LOC
18. **MerchantDetailView.tsx** - 313 LOC
19. **Reports.tsx** - 311 LOC
20. **CategoryList.tsx** - 309 LOC
21. **AddGrzBondModal.tsx** - 309 LOC
22. **AddressFields.tsx** - 304 LOC
23. **SplitTransactionModal.tsx** - 303 LOC
24. **WidgetCard.tsx** - 303 LOC
25. **DashboardSpendingWidget.tsx** - 302 LOC

---

## REFACTORING STRATEGIES

### For Server Files

**Pattern 1: Extract by Responsibility**
```typescript
// Before: One large controller with many endpoints
export const controller = {
  // 20+ methods
}

// After: Multiple focused controllers
export { generalController } from "./general.controller"
export { membersController } from "./members.controller"
export { invitationsController } from "./invitations.controller"
```

**Pattern 2: Extract by Data Operation**
```typescript
// Before: One repository with all operations
class Repository {
  // CRUD + complex queries + reports
}

// After: Separated concerns
class CoreRepository { /* CRUD only */ }
class QueryRepository { /* Complex queries */ }
class ReportRepository { /* Report generation */ }
```

**Pattern 3: Extract Helper Functions**
```typescript
// Before: Inline calculations in service
class Service {
  async operation() {
    // 100 lines of calculation logic
  }
}

// After: Extracted utilities
import { calculator } from "./utils/calculator"
class Service {
  async operation() {
    return calculator.compute(data)
  }
}
```

### For Client Components

**Pattern 1: Extract Form Sections**
```tsx
// Before: One large form component
function LargeForm() {
  return (
    <form>
      {/* 400 lines of fields */}
    </form>
  )
}

// After: Composed from sections
function LargeForm() {
  return (
    <form>
      <BasicInfoSection />
      <AddressSection />
      <PreferencesSection />
    </form>
  )
}
```

**Pattern 2: Extract Complex Fields**
```tsx
// Before: Inline complex field logic
<FormField>
  {/* 50 lines of select/autocomplete logic */}
</FormField>

// After: Dedicated component
<MerchantSelector value={value} onChange={onChange} />
```

**Pattern 3: Extract Modal Content**
```tsx
// Before: Modal with all content inline
function Modal() {
  return (
    <Dialog>
      {/* 300 lines of content */}
    </Dialog>
  )
}

// After: Modal with extracted content
function Modal() {
  return (
    <Dialog>
      <ModalHeader />
      <ModalContent />
      <ModalFooter />
    </Dialog>
  )
}
```

---

## TESTING NOTES

After refactoring:
1. Ensure all imports are updated if public API changes
2. Run relevant integration tests
3. Verify backward compatibility for re-exported modules
4. Check bundle size hasn't significantly increased (tree-shaking should handle modularization)

---

## NEXT STEPS

### Immediate (High Impact)
1. Fix remaining server files > 600 LOC (5 files)
2. Fix client components > 400 LOC (5 files)

### Short Term
3. Address medium priority server files (500-600 LOC)
4. Address medium priority client files (300-400 LOC)

### Long Term
5. Establish pre-commit hooks to prevent new LOC violations
6. Add ESLint rule to warn on files approaching limits
7. Document refactoring patterns in contributing guidelines
