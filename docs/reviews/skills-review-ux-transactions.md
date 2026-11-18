# UI/UX & Accessibility Review - Transactions Module

**Date:** 2026-01-21
**Reviewer:** Maya Rodriguez (Senior UX Designer)
**Benchmark:** Monarch Money
**App Context:** Manual input personal finance app

---

## UX Assessment Summary

| Metric | Score |
|--------|-------|
| **Monarch Alignment Score** | 72/100 |
| **Accessibility Score** | 62/100 |
| **Overall UX Score** | 62/100 |
| **Dark Mode Support** | 90/100 |
| **Touch/Mobile UX** | 70/100 |

---

## Module Scope

```
client/src/features/transactions/
├── components/
│   ├── TransactionList.tsx
│   ├── TransactionRow.tsx
│   ├── TransactionCard.tsx
│   ├── TransactionDetailModal.tsx
│   ├── BulkActions.tsx
│   ├── AdvancedFilterPopover.tsx
│   ├── TransactionSearch.tsx
│   ├── RecurringModal.tsx
│   └── RuleCreationModal.tsx

client/src/pages/
└── Transactions.tsx

client/src/components/transactions/
├── AddTransactionModal.tsx
├── DateRangePopover.tsx
├── TransactionSummaryPanel.tsx
└── form/
    ├── TransactionFormFields.tsx
    ├── RecurringSettingsSection.tsx
    ├── GoalLinkingSection.tsx
    └── TagsSection.tsx
```

---

## Critical UX Issues (Blocks Release)

### UX-001: Bulk Actions Toolbar Misleads Users
- **Monarch does:** Bulk actions toolbar with functional buttons that immediately execute operations
- **We do:** Renders 5 buttons (Categorize, Tag, Review, Hide, Delete) that do absolutely nothing
- **User impact:** Users feel the app is broken when their selections have no visible effect. Trust is damaged.
- **Fix:** Either implement bulk actions or hide the toolbar until functionality is ready
- **Location:** `Transactions.tsx:323-331`
- **Severity:** CRITICAL - Dead UI is worse than no UI
- **Code:**
  ```tsx
  <BulkActions
    selectedCount={selection.selectedCount}
    onClear={selection.clearSelection}
    onCategorize={() => {}}  // Dead
    onTag={() => {}}         // Dead
    onReview={() => {}}      // Dead
    onHide={() => {}}        // Dead
    onDelete={() => {}}      // Dead
  />
  ```

### UX-002: TransactionRow Uses Clickable Div Without Keyboard Support
- **Monarch does:** Transaction rows as proper interactive elements with keyboard navigation
- **We do:** `<div onClick={...} className="cursor-pointer">` without keyboard handler
- **User impact:** Screen readers don't announce rows as interactive; keyboard users can't activate
- **Fix:** Use `<button>` or add `role="button"`, `tabIndex={0}`, and `onKeyDown` handler
- **Location:** `TransactionRow.tsx:36-41`
- **Code:**
  ```tsx
  // Current (inaccessible)
  <div
    className={cn(
      "flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer ...",
    )}
    onClick={() => onClick(transaction)}
  >

  // Required
  <div
    role="button"
    tabIndex={0}
    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick(transaction)}
    onClick={() => onClick(transaction)}
    ...
  >
  ```

---

## Accessibility Violations (WCAG 2.1 AA)

### A11Y-001: Missing Keyboard Handler on Row Click
- **Criterion:** 2.1.1 Keyboard
- **Element:** Transaction rows in TransactionList
- **Current:** Only `onClick` handler, no `onKeyDown`
- **Required:** Add keyboard support for Enter/Space to activate row
- **Location:** `TransactionRow.tsx:41`
- **Impact:** Keyboard-only users cannot interact with transactions

### A11Y-002: Icon Buttons Missing aria-labels
- **Criterion:** 4.1.2 Name, Role, Value
- **Elements:** Review (Check) and Recurring (ArrowRight) buttons in TransactionDetailModal header
- **Current:** Only `title` attribute (not announced by screen readers)
- **Required:** Add `aria-label` to all icon-only buttons
- **Location:** `TransactionDetailModal.tsx:151-167`
- **Code:**
  ```tsx
  // Current
  <button
    className="p-2 hover:bg-muted rounded-md ..."
    title={transaction.reviewedAt ? "Mark as Unreviewed" : "Mark as Reviewed"}
    onClick={() => reviewMutation.mutate(...)}
  >
    <Check className={cn("w-4 h-4", ...)} />
  </button>

  // Required
  <button
    aria-label={transaction.reviewedAt ? "Mark as Unreviewed" : "Mark as Reviewed"}
    className="p-2 hover:bg-muted rounded-md ..."
    onClick={() => reviewMutation.mutate(...)}
  >
    <Check className={cn("w-4 h-4", ...)} />
  </button>
  ```

### A11Y-003: Filter Category Buttons Not Accessible
- **Criterion:** 4.1.2 Name, Role, Value
- **Element:** Sidebar filter category buttons in AdvancedFilterPopover
- **Current:** Plain `<button>` without role indication for selection state
- **Required:** Add `aria-pressed` for toggle buttons or use tabs/radiogroup pattern
- **Location:** `AdvancedFilterPopover.tsx:322-334`
- **Code:**
  ```tsx
  // Current
  <button
    onClick={() => setSelectedCategory(cat.id)}
    className={cn(
      "w-full text-left px-3 py-2 ...",
      selectedCategory === cat.id ? "bg-white shadow-sm ..." : "..."
    )}
  >
    {cat.label}
  </button>

  // Required
  <button
    role="tab"
    aria-selected={selectedCategory === cat.id}
    onClick={() => setSelectedCategory(cat.id)}
    ...
  >
  ```

### A11Y-004: Modal Focus Trap Not Implemented
- **Criterion:** 2.4.3 Focus Order
- **Element:** TransactionDetailModal
- **Current:** Uses plain div overlay without focus trap - focus can escape behind modal
- **Required:** Implement focus trap to keep focus within modal when open
- **Location:** `TransactionDetailModal.tsx:146`
- **Fix:** Use `@radix-ui/react-dialog` or implement manual focus trap
- **Code:**
  ```tsx
  // Current (no focus trap)
  <div className="fixed inset-0 bg-black/40 z-50 ...">
    <Card className="...">
      {/* Modal content */}
    </Card>
  </div>

  // Should use Dialog component or FocusTrap
  ```

### A11Y-005: Tag Remove Buttons Missing Labels
- **Criterion:** 4.1.2 Name, Role, Value
- **Element:** X buttons on tags in TransactionDetailModal
- **Current:** Just `<button><X /></button>` with no accessible name
- **Required:** Add `aria-label="Remove tag {tagName}"`
- **Location:** `TransactionDetailModal.tsx:262-267`
- **Code:**
  ```tsx
  // Current
  <button
    onClick={() => handleRemoveTag(tag.id)}
    className="ml-1 hover:text-destructive"
  >
    <X className="w-3 h-3" />
  </button>

  // Required
  <button
    aria-label={`Remove tag ${tag.name}`}
    onClick={() => handleRemoveTag(tag.id)}
    className="ml-1 hover:text-destructive"
  >
    <X className="w-3 h-3" />
  </button>
  ```

### A11Y-006: Checkbox in Row Has No Label
- **Criterion:** 1.3.1 Info and Relationships
- **Element:** Selection checkbox in TransactionRow
- **Current:** `<input type="checkbox">` without label
- **Required:** Add `aria-label` or associate with label element
- **Location:** `TransactionRow.tsx:45-53`
- **Code:**
  ```tsx
  // Current
  <input
    type="checkbox"
    checked={isSelected}
    onChange={(e) => { ... }}
    className="h-4 w-4 rounded border-border"
  />

  // Required
  <input
    type="checkbox"
    aria-label={`Select transaction ${displayName}`}
    checked={isSelected}
    onChange={(e) => { ... }}
    className="h-4 w-4 rounded border-border"
  />
  ```

### A11Y-007: Tag Input Disables Focus Ring
- **Criterion:** 2.4.7 Focus Visible
- **Element:** Tag input field in TransactionDetailModal
- **Current:** `focus-visible:ring-0` explicitly disables focus indicator
- **Required:** Remove `focus-visible:ring-0` to allow default focus ring
- **Location:** `TransactionDetailModal.tsx:271-278`
- **Code:**
  ```tsx
  // Current (inaccessible)
  <Input
    className="flex-1 min-w-[100px] h-7 border-0 shadow-none focus-visible:ring-0"
  />

  // Required (keep focus ring)
  <Input
    className="flex-1 min-w-[100px] h-7 border-0 shadow-none"
  />
  ```
- **Impact:** Keyboard users cannot see when tag input is focused

### A11Y-008: Loading Spinner Missing aria-live
- **Criterion:** 4.1.3 Status Messages
- **Element:** Loading spinner in TransactionList
- **Current:** Plain spinner icon with no screen reader announcement
- **Required:** Add `aria-live="polite"` or `role="status"` to announce loading
- **Location:** `TransactionList.tsx:105-110, 153-157`
- **Code:**
  ```tsx
  // Current
  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />

  // Required
  <div aria-live="polite" role="status">
    <span className="sr-only">Loading transactions</span>
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
  ```

---

## Monarch Pattern Gaps

### PATTERN-001: No Skeleton Loaders
- **Monarch feature:** Content-shaped skeleton placeholders during data fetch
- **Our gap:** Uses Loader2 spinner only
- **Priority:** P1
- **Location:** `TransactionList.tsx:153-156`
- **Code:**
  ```tsx
  // Current
  {loading && (
    <div className="flex justify-center py-4">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )}

  // Monarch pattern would show skeleton rows matching transaction row shape
  ```

### PATTERN-002: Split Transaction UI Missing
- **Monarch feature:** Easy interface to divide one transaction across multiple categories with visual amount allocation
- **Our gap:** No split functionality implemented at all
- **Priority:** P1
- **Monarch behavior:** Click "Split" → see original amount → allocate portions to categories

### PATTERN-003: No Swipe Actions on Mobile
- **Monarch feature:** Swipe left/right on transaction to quickly categorize, review, or delete
- **Our gap:** No swipe gesture support
- **Priority:** P2
- **Location:** `TransactionRow.tsx`, `TransactionCard.tsx`

### PATTERN-004: Single-Select Checkboxes Confusing
- **Monarch feature:** Multi-select filters with "Select all" option in filter panel
- **Our gap:** Shows checkboxes but only allows single selection (radio button behavior)
- **Priority:** P2
- **Location:** `AdvancedFilterPopover.tsx:117-143`
- **User confusion:** Checkboxes imply multi-select, but only one can be selected

### PATTERN-005: No Transaction Grouping by Date
- **Monarch feature:** Transactions grouped under date headers with sticky headers
- **Our gap:** Flat list without date group headers
- **Priority:** P2
- **Note:** AccountTransactions.tsx has grouping, but main Transactions page doesn't

---

## Visual Consistency Issues

### VIS-001: Dark Mode Color in Filter Sidebar
- **Issue:** Filter popover sidebar uses `bg-white` which doesn't respect dark mode
- **Location:** `AdvancedFilterPopover.tsx:328`
- **Fix:** Change to `bg-card` or `bg-background`
- **Code:**
  ```tsx
  // Current
  className={cn(
    "...",
    selectedCategory === cat.id
      ? "bg-white shadow-sm font-medium text-primary"  // ❌ Hardcoded white
      : "..."
  )}
  ```

### VIS-002: Bulk Actions Toolbar No Backdrop
- **Issue:** Fixed toolbar at bottom has no blur/backdrop, can overlap content awkwardly
- **Location:** `BulkActions.tsx:35`
- **Fix:** Add `backdrop-blur-sm` to container

### VIS-003: Tag Input Visually Disappears
- **Issue:** Tag input has `border-0 shadow-none` making it invisible until focused
- **Location:** `TransactionDetailModal.tsx:271-278`
- **Fix:** Keep subtle border or placeholder styling

### VIS-004: Inconsistent Button Variants in Header
- **Issue:** Import uses `variant="outline"`, Add uses default (primary)
- **Location:** `Transactions.tsx:263-270`
- **Status:** ✅ Intentional - Add is primary action

---

## Positive Observations

### What Works Well

1. **Virtualized List** ✅
   - Uses `@tanstack/react-virtual` for smooth scrolling with 1000+ transactions
   - `TransactionList.tsx:45-50`

2. **Recurring Badge** ✅
   - Clear visual indicator for recurring transactions
   - `TransactionRow.tsx:65-69` - Blue pill badge

3. **Review Status Icons** ✅
   - CheckCircle2 (green) for reviewed, AlertCircle (amber) for pending
   - `TransactionRow.tsx:102-107`

4. **Summary Panel Carousel** ✅
   - Multiple views (standard, detail, chart) with dot indicators
   - `TransactionSummaryPanel.tsx:87-127`

5. **Delete Confirmation** ✅
   - AlertDialog before destructive action
   - `AddTransactionModal.tsx:260-287`

6. **Search Debouncing** ✅
   - No jank during typing
   - Via `useTransactionFilters` hook

7. **Date Picker** ✅
   - Calendar popup with clear UX
   - `DateRangePopover.tsx`

8. **Empty State** ✅
   - Helpful message when no transactions match filters
   - `TransactionList.tsx:79-89`

9. **Infinite Scroll** ✅
   - Automatic loading at scroll threshold
   - `TransactionList.tsx:56-64`

10. **Tag Management** ✅
    - Add existing or create new tags inline
    - `TransactionDetailModal.tsx:101-143`

---

## Responsive Design Assessment

### Mobile (320px-768px)

| Feature | Status | Notes |
|---------|--------|-------|
| Transaction List | ✅ | Full width, scrollable |
| Transaction Row | ⚠️ | Amount may truncate |
| Summary Panel | ⚠️ | 72px fixed width when collapsed |
| Filter Popover | ⚠️ | 600px width may overflow |
| Detail Modal | ⚠️ | max-w-lg should fit |
| Add Transaction | ⚠️ | max-w-2xl may be too wide |
| Bulk Actions Bar | ✅ | Centered, responsive |

### Touch Targets

| Element | Size | Status |
|---------|------|--------|
| Transaction Row | Full width, 64px height | ✅ |
| Checkbox | 16px | ❌ Should be 44px |
| Review Icon | 32px | ⚠️ Borderline |
| Tag Remove X | 12px | ❌ Too small |
| Filter Buttons | 32px height | ⚠️ Should be 44px |

---

## Keyboard Navigation Audit

| Action | Key | Status |
|--------|-----|--------|
| Search focus | / or Cmd+K | ❌ Not implemented |
| Navigate list | Arrow Up/Down | ❌ Not implemented |
| Select transaction | Enter | ❌ Only mouse |
| Select/deselect | Space | ❌ Not implemented |
| Close modal | Escape | ✅ Works |
| Submit form | Enter | ✅ Works |
| Navigate filters | Tab | ⚠️ Works but awkward |
| Apply filters | Enter | ✅ Works |

---

## Screen Reader Testing Notes

### VoiceOver (macOS) Simulation

| Element | Announced As | Expected | Status |
|---------|--------------|----------|--------|
| Transaction Row | Nothing (div) | "Button, Transaction name, $amount" | ❌ |
| Checkbox | "Checkbox" | "Select Transaction name, checkbox" | ❌ |
| Review Button | Nothing (icon only) | "Mark as reviewed, button" | ❌ |
| Tag Remove | Nothing | "Remove tag Groceries, button" | ❌ |
| Filter Category | "Button" | "Categories tab, selected" | ⚠️ |

---

## Recommendations

### P0 (Accessibility - Must Fix for Compliance)
1. Add keyboard handlers to TransactionRow (Enter/Space to activate)
2. Add aria-labels to all icon-only buttons (Review, Recurring, Tag Remove)
3. Implement focus trap in TransactionDetailModal
4. Add aria-label to selection checkboxes
5. Add role="button" and tabIndex to TransactionRow

### P1 (Monarch Parity - Should Match)
6. Fix or remove bulk actions toolbar - dead UI damages trust
7. Add skeleton loaders for transaction list loading state
8. Implement split transaction UI
9. Fix dark mode color in filter popover sidebar (`bg-white` → `bg-card`)
10. Increase touch target sizes to 44px minimum

### P2 (Enhancement - Nice to Have)
11. Add swipe gestures for mobile
12. Consider multi-select for filters
13. Add backdrop blur to bulk actions toolbar
14. Add keyboard shortcuts (/ for search, arrow keys for navigation)
15. Add date grouping to transaction list

---

## Files Requiring Changes

| File | Line(s) | Issue | Priority |
|------|---------|-------|----------|
| `TransactionRow.tsx` | 36-41 | Add role, tabIndex, onKeyDown | P0 |
| `TransactionRow.tsx` | 45-53 | Add aria-label to checkbox | P0 |
| `TransactionDetailModal.tsx` | 151-167 | Add aria-labels to icon buttons | P0 |
| `TransactionDetailModal.tsx` | 146 | Implement focus trap | P0 |
| `TransactionDetailModal.tsx` | 262-267 | Add aria-label to tag remove | P0 |
| `TransactionDetailModal.tsx` | 271-278 | Remove focus-visible:ring-0 from tag input | P0 |
| `TransactionList.tsx` | 105-110 | Add aria-live to loading spinner | P0 |
| `Transactions.tsx` | 323-331 | Fix or remove bulk actions | P1 |
| `TransactionList.tsx` | 153-156 | Replace spinner with skeleton | P1 |
| `AdvancedFilterPopover.tsx` | 328 | Fix dark mode `bg-white` | P1 |
| `AdvancedFilterPopover.tsx` | 322-334 | Add aria-selected to filter tabs | P1 |

---

## Accessibility Checklist

### WCAG 2.1 AA Compliance Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1.1.1 Non-text Content | ⚠️ | Icon buttons need aria-labels |
| 1.3.1 Info and Relationships | ❌ | Checkboxes missing labels |
| 1.4.1 Use of Color | ✅ | Icons accompany color indicators |
| 1.4.3 Contrast (Minimum) | ✅ | Design system colors pass |
| 2.1.1 Keyboard | ❌ | Rows not keyboard accessible |
| 2.4.3 Focus Order | ❌ | Modal has no focus trap |
| 2.4.7 Focus Visible | ⚠️ | Some elements lack focus ring |
| 4.1.2 Name, Role, Value | ❌ | Multiple violations |

**Compliance Score: 62/100** - Multiple AA violations must be fixed

---

## Dark Mode Verification

| Component | Light | Dark | Status |
|-----------|-------|------|--------|
| TransactionList | ✅ | ✅ | CSS vars |
| TransactionRow | ✅ | ✅ | CSS vars |
| TransactionDetailModal | ✅ | ✅ | CSS vars |
| BulkActions | ✅ | ✅ | CSS vars |
| AdvancedFilterPopover | ✅ | ❌ | `bg-white` hardcoded |
| SummaryPanel | ✅ | ✅ | CSS vars |
| AddTransactionModal | ✅ | ✅ | CSS vars |

**Dark Mode Score: 90/100** - One hardcoded color found

---

## Performance UX Assessment

| Metric | Status | Notes |
|--------|--------|-------|
| Initial Load | ✅ | Fast with pagination |
| Scroll Performance | ✅ | Virtualized, smooth |
| Search Responsiveness | ✅ | Debounced, no jank |
| Filter Application | ✅ | Server-side, fast |
| Modal Open/Close | ✅ | Smooth animation |
| Infinite Scroll | ✅ | Seamless loading |

**Performance UX Score: 95/100** - Excellent

---

## References

- [Monarch Money](https://www.monarch.com/)
- [Monarch UI Examples - NicelyDone](https://nicelydone.club/apps/monarch)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Accessible Rich Internet Applications (ARIA)](https://www.w3.org/WAI/ARIA/apg/)
- [@tanstack/react-virtual](https://tanstack.com/virtual/latest)
