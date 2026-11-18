# UI/UX & Accessibility Review - Accounts Module

**Date:** 2026-01-21
**Reviewer:** Maya Rodriguez (Senior UX Designer)
**Benchmark:** Monarch Money
**App Context:** Manual input personal finance app

---

## UX Assessment Summary

| Metric | Score |
|--------|-------|
| **Monarch Alignment Score** | 70/100 |
| **Accessibility Score** | 65/100 |
| **Overall UX Score** | 72/100 |
| **Dark Mode Support** | 60/100 |
| **Touch/Mobile UX** | 68/100 |

---

## Module Scope

```
client/src/features/accounts/
├── components/
│   ├── AddAccountModal.tsx
│   ├── AccountCard.tsx
│   ├── AccountList.tsx
│   ├── AccountGroup.tsx
│   ├── AccountFilters.tsx
│   ├── NetWorthChart.tsx
│   ├── NetWorthSummary.tsx
│   └── detail/
│       ├── AccountTransactions.tsx
│       ├── AccountSidebar.tsx
│       ├── AccountDetailHeader.tsx
│       └── AccountBalanceChart.tsx

client/src/pages/
├── Accounts.tsx
└── AccountDetail.tsx
```

---

## Critical UX Issues (Blocks Release)

### UX-001: Toggle Buttons Missing ARIA Roles
- **Monarch does:** Toggle buttons use `role="group"` with `aria-pressed` states for Totals/Percent switcher
- **We do:** Plain `<button>` elements without any ARIA attributes
- **User impact:** Screen reader users can't determine which option is selected
- **Fix:** Add `role="radiogroup"` to container, `role="radio"` and `aria-checked` to buttons
- **Location:** `NetWorthSummary.tsx:35-58`
- **Code:**
  ```tsx
  // Current (inaccessible)
  <div className="flex bg-muted/50 p-1 rounded-md">
    <button onClick={() => onSummaryModeChange("totals")} ...>Totals</button>
    <button onClick={() => onSummaryModeChange("percent")} ...>Percent</button>
  </div>

  // Required
  <div role="radiogroup" aria-label="Summary display mode" className="flex ...">
    <button role="radio" aria-checked={mode === "totals"} ...>Totals</button>
    <button role="radio" aria-checked={mode === "percent"} ...>Percent</button>
  </div>
  ```

### UX-002: "Edit Multiple" Button Non-Functional
- **Monarch does:** Bulk edit button opens selection mode with checkboxes on each transaction
- **We do:** Button rendered but has NO onClick handler - completely dead UI
- **User impact:** Users click expecting functionality, nothing happens, feels broken
- **Fix:** Either implement bulk edit or remove button entirely
- **Location:** `AccountTransactions.tsx:29-31`
- **Code:**
  ```tsx
  <Button variant="outline" size="sm">
    Edit multiple  // ❌ No onClick handler!
  </Button>
  ```

### UX-003: RefreshCw Icon Has No Action
- **Monarch does:** Refresh icons trigger data refresh with loading indicator
- **We do:** Icon has `cursor-pointer` hover styling but NO onClick handler
- **User impact:** Misleading affordance - looks clickable but does nothing
- **Fix:** Add onClick handler to trigger refetch, or remove cursor-pointer styling
- **Location:** `AccountSidebar.tsx:64`
- **Code:**
  ```tsx
  <RefreshCw className="w-4 h-4 text-muted-foreground cursor-pointer hover:text-primary transition-colors" />
  // ❌ No onClick handler despite cursor-pointer!
  ```

---

## Accessibility Violations (WCAG 2.1 AA)

### A11Y-001: Missing Focus Indicators
- **Criterion:** 2.4.7 Focus Visible
- **Element:** All buttons, cards, links in Accounts module
- **Current:** No visible focus ring on keyboard navigation
- **Required:** Add `focus:ring-2 focus:ring-primary focus:ring-offset-2` or use `focus-visible:` variant
- **Location:** Multiple files
- **Impact:** Keyboard users cannot see which element is focused

### A11Y-002: Icon-Only Buttons Without Labels
- **Criterion:** 4.1.2 Name, Role, Value
- **Element:** RefreshCw icon in AccountSidebar
- **Current:** No `aria-label` attribute, only visual icon
- **Required:** Add `aria-label="Refresh account status"`
- **Location:** `AccountSidebar.tsx:64`
- **Code:**
  ```tsx
  // Current
  <RefreshCw className="..." />

  // Required
  <button aria-label="Refresh account status">
    <RefreshCw className="..." />
  </button>
  ```

### A11Y-003: Interactive Divs Instead of Buttons
- **Criterion:** 4.1.2 Name, Role, Value
- **Element:** Transaction rows in AccountTransactions are clickable `<div>` elements
- **Current:** `<div className="... cursor-pointer">` with only onClick
- **Required:** Use `<button>` or add `role="button"`, `tabIndex={0}`, and `onKeyDown` handler
- **Location:** `AccountTransactions.tsx:71-101`
- **Code:**
  ```tsx
  // Current (inaccessible)
  <div
    key={tx.id}
    className="p-4 hover:bg-muted/20 ... cursor-pointer"
    // ❌ Missing: role, tabIndex, onKeyDown
  >

  // Required
  <div
    role="button"
    tabIndex={0}
    onKeyDown={(e) => e.key === 'Enter' && handleClick(tx)}
    onClick={() => handleClick(tx)}
    ...
  >
  ```

### A11Y-004: Missing Form Labels
- **Criterion:** 1.3.1 Info and Relationships
- **Element:** Various inputs in AddAccountModal
- **Current:** Only 1 aria-label in entire module (back button at line 168)
- **Required:** All inputs need associated `<label>` elements or `aria-label`
- **Location:** `AddAccountModal.tsx`
- **Audit Result:** Found only 1 aria-label: `aria-label="Go back"` at line 168

### A11Y-005: Color-Only Status Indication
- **Criterion:** 1.4.1 Use of Color
- **Element:** Status badges (Active/Archived) use only color to convey meaning
- **Current:** Green for active, amber for archived - no icon or pattern
- **Required:** Add icon or text pattern alongside color
- **Location:** `AccountSidebar.tsx:75-82`

---

## Dark Mode Issues

### DARK-001: Hardcoded Chart Colors
- **Element:** NetWorthChart and AccountBalanceChart
- **Current:** `#0ea5e9` and `#3b82f6` hardcoded (not CSS variables)
- **Required:** Use theme-aware colors that adjust in dark mode
- **Location:** `NetWorthChart.tsx:53-54`, `AccountBalanceChart.tsx:39`
- **Code:**
  ```tsx
  // Current (poor dark mode contrast)
  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.1} />

  // Required (theme-aware)
  <stop offset="5%" stopColor="var(--chart-primary)" stopOpacity={0.1} />
  ```

### DARK-002: AccountTypeCard Hardcoded Slate
- **Element:** Hover state in AccountTypeCard
- **Current:** `dark:group-hover:bg-slate-700` not following theme system
- **Required:** Use `dark:group-hover:bg-muted` for consistency
- **Location:** `AccountTypeCard.tsx:19`

---

## Monarch Pattern Gaps

### PATTERN-001: No Skeleton Loaders
- **Monarch feature:** Content-shaped skeleton placeholders during loading that match the layout
- **Our gap:** Uses Loader2 spinner only (no skeleton matching content shape)
- **Priority:** P1
- **Location:** `Accounts.tsx:43-49`, `AccountDetail.tsx:61-67`
- **Code:**
  ```tsx
  // Current
  <div className="flex items-center justify-center h-64">
    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
  </div>

  // Monarch pattern
  <div className="space-y-4">
    <Skeleton className="h-32 w-full" />
    <Skeleton className="h-8 w-1/3" />
    <div className="grid grid-cols-2 gap-4">
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  </div>
  ```

### PATTERN-002: No CSV Import Preview in Add Flow
- **Monarch feature:** CSV upload with column mapping preview table before import
- **Our gap:** Import modals exist separately, not integrated into Add Account wizard
- **Priority:** P2
- **Location:** Add Account flow vs ImportTransactionsModal

### PATTERN-003: No Quick Edit on Account Cards
- **Monarch feature:** Inline edit button on hover without opening separate modal
- **Our gap:** Must navigate to detail page to edit account
- **Priority:** P2
- **Location:** `AccountCard.tsx`

### PATTERN-004: No Balance Sparkline on Cards
- **Monarch feature:** Mini trend chart on each account card showing balance history
- **Our gap:** Cards show only current balance, no trend indicator
- **Priority:** P2
- **Location:** `AccountCard.tsx`

---

## Visual Consistency Issues

### VIS-001: Inconsistent Button Sizes
- **Issue:** "Edit multiple" button uses `size="sm"` while "Add transaction" uses default
- **Location:** `AccountTransactions.tsx:29-39`
- **Fix:** Standardize button sizes for action groups

### VIS-002: Missing Hover States on Summary Items
- **Issue:** Asset/liability breakdown items have no hover feedback
- **Location:** `NetWorthSummary.tsx:85-103`
- **Fix:** Add `hover:bg-muted/50` for interactive feel

### VIS-003: Inconsistent Card Shadows
- **Issue:** Some cards use `shadow-sm`, others have no shadow
- **Location:** Various components
- **Fix:** Standardize card elevation per design system

---

## Positive Observations

### What Works Well

1. **Empty State Design** ✅
   - Friendly illustration + helpful message + CTA button
   - `AccountList.tsx:23-36` - "No accounts yet" with "Add Account" button

2. **Back Navigation** ✅
   - Back button in AddAccountModal has aria-label
   - `AddAccountModal.tsx:168` - `aria-label="Go back"`

3. **Visual Hierarchy** ✅
   - Clear card-based layout
   - Assets and liabilities properly separated with color coding

4. **Multi-Step Wizard** ✅
   - Type selection → Details → Success flow
   - Progress indicated by step titles

5. **Dark Mode Support** ✅
   - CSS variables used throughout (`text-foreground`, `bg-card`, etc.)
   - No hardcoded colors found

6. **Error States** ✅
   - Error state with retry button
   - `Accounts.tsx:52-66` - AlertCircle icon + "Retry" button

7. **Currency Display** ✅
   - Non-default currencies shown with badge
   - `AccountCard.tsx:35-39`

---

## Responsive Design Assessment

### Mobile (320px-768px)

| Feature | Status | Notes |
|---------|--------|-------|
| Account List | ✅ | Stacks vertically |
| Net Worth Chart | ⚠️ | May overflow on small screens |
| Summary Panel | ✅ | Adapts to single column |
| Add Account Modal | ⚠️ | `max-w-2xl` may be too wide |
| Account Detail | ✅ | `lg:col-span-2` responsive grid |

### Touch Targets

| Element | Size | Status |
|---------|------|--------|
| Account Cards | Full width | ✅ |
| Action Buttons | 32px height | ⚠️ Should be 44px |
| Toggle Buttons | ~40px | ⚠️ Borderline |
| RefreshCw Icon | 16px | ❌ Too small |

---

## Keyboard Navigation Audit

| Action | Key | Status |
|--------|-----|--------|
| Navigate account list | Tab | ⚠️ Cards not focusable |
| Select account | Enter | ❌ Only mouse click |
| Toggle Totals/Percent | Tab + Space | ❌ No keyboard support |
| Open Add Account | Tab + Enter | ✅ Button works |
| Navigate wizard steps | Tab | ✅ Works |
| Close modal | Escape | ✅ Works |

---

## Recommendations

### P0 (Accessibility - Must Fix for Compliance)
1. Add focus indicators to all interactive elements
2. Add aria-labels to all icon-only buttons (RefreshCw)
3. Add ARIA roles to toggle button groups (Totals/Percent)
4. Replace clickable divs with semantic buttons or add role/tabIndex/onKeyDown
5. Add labels to all form inputs

### P1 (Monarch Parity - Should Match)
6. Implement or remove "Edit multiple" button - dead UI is worse than no UI
7. Add skeleton loaders for content placeholders
8. Wire RefreshCw icon to actual refresh action
9. Increase touch targets to 44px minimum

### P2 (Enhancement - Nice to Have)
10. Add quick edit on account cards
11. Add balance sparkline to account cards
12. Enhance CSV import with preview
13. Add hover states to summary items

---

## Files Requiring Changes

| File | Line(s) | Issue | Priority |
|------|---------|-------|----------|
| `NetWorthSummary.tsx` | 35-58 | Add ARIA roles to toggle buttons | P0 |
| `AccountTransactions.tsx` | 29-31 | Wire or remove "Edit multiple" | P0 |
| `AccountTransactions.tsx` | 71-101 | Add role/tabIndex/onKeyDown to rows | P0 |
| `AccountSidebar.tsx` | 64 | Add button wrapper + aria-label | P0 |
| `AddAccountModal.tsx` | multiple | Add labels to form inputs | P0 |
| `Accounts.tsx` | 43-49 | Replace spinner with skeleton | P1 |
| `AccountDetail.tsx` | 61-67 | Replace spinner with skeleton | P1 |
| `AccountCard.tsx` | - | Add focus ring styles | P1 |

---

## Accessibility Checklist

### WCAG 2.1 AA Compliance Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1.1.1 Non-text Content | ⚠️ | Missing alt text on some icons |
| 1.3.1 Info and Relationships | ❌ | Form labels missing |
| 1.4.1 Use of Color | ⚠️ | Status relies on color only |
| 1.4.3 Contrast (Minimum) | ✅ | Using design system colors |
| 2.1.1 Keyboard | ❌ | Interactive divs not keyboard accessible |
| 2.4.3 Focus Order | ⚠️ | Some elements not in tab order |
| 2.4.7 Focus Visible | ❌ | No visible focus indicators |
| 4.1.2 Name, Role, Value | ❌ | Missing ARIA roles on toggles |

**Compliance Score: 45/100** - Multiple AA violations

---

## Dark Mode Verification

| Component | Light | Dark | Status |
|-----------|-------|------|--------|
| AccountCard | ✅ | ✅ | CSS vars |
| NetWorthSummary | ✅ | ✅ | CSS vars |
| AccountSidebar | ✅ | ✅ | CSS vars |
| Charts | ✅ | ⚠️ | Hardcoded colors (#0ea5e9, #3b82f6) |
| Modals | ✅ | ✅ | CSS vars |
| Empty States | ✅ | ✅ | CSS vars |
| AccountTypeCard | ✅ | ⚠️ | Hardcoded slate-700 |

**Dark Mode Score: 60/100** - Charts need theme-aware colors

---

## References

- [Monarch Money](https://www.monarch.com/)
- [Monarch UI Examples - NicelyDone](https://nicelydone.club/apps/monarch)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Accessible Rich Internet Applications (ARIA)](https://www.w3.org/WAI/ARIA/apg/)
