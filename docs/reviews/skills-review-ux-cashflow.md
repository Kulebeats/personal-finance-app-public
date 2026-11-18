# UI/UX & Accessibility Review - CashFlow Module

**Date:** 2026-01-21
**Reviewer:** Maya Rodriguez (Senior UX Designer)
**Benchmark:** Manual entry personal finance applications
**App Context:** Manual input personal finance app

---

## UX Assessment Summary

| Metric | Score |
|--------|-------|
| **Monarch Alignment Score** | 72/100 |
| **Accessibility Score** | 58/100 |
| **Overall UX Score** | 68/100 |
| **Dark Mode Support** | 95/100 |
| **Touch/Mobile UX** | 65/100 |

---

## Module Scope

```
client/src/pages/
└── CashFlow.tsx                    ⚠️ View toggle missing aria-pressed

client/src/features/cashflow/
├── components/
│   ├── CashFlowChart.tsx           ❌ Charts not keyboard accessible
│   ├── CashFlowFilters.tsx         ✅ Good - proper labels and focus
│   ├── CashFlowSummary.tsx         ⚠️ Color-only info conveyance
│   ├── CashFlowTable.tsx           ⚠️ Loading state not announced
│   ├── IncomeBreakdown.tsx         ⚠️ Chart accessibility issues
│   └── ExpenseBreakdown.tsx        ⚠️ Chart accessibility issues
```

---

## Critical UX Issues (Blocks Release)

### UX-001: Charts Lack Keyboard Navigation
- **Best practice:** Charts should be keyboard navigable with arrow keys, values announced
- **Current state:** Nivo charts receive no keyboard focus
- **User impact:** Keyboard-only users cannot explore chart data
- **Fix:** Add keyboard navigation layer or data table alternative
- **Location:** `CashFlowChart.tsx:69-157`
- **WCAG Violation:** 2.1.1 Keyboard
- **Code:**
  ```tsx
  // Current (❌ no keyboard access)
  <ResponsiveBar
    data={barChartData}
    role="application"
    ariaLabel="Cash flow bar chart"
    // No keyboard handlers
  />

  // Required (✅ keyboard accessible)
  // Option 1: Add keyboard navigation overlay
  // Option 2: Provide data table alternative that IS keyboard accessible
  ```

### UX-002: Color-Only Information Conveyance
- **Best practice:** Icons + color + text labels for income/expense distinction
- **Current state:** Only colored squares (green/red) to distinguish income vs expenses
- **User impact:** Colorblind users cannot distinguish income from expenses in legend
- **Fix:** Add icons or patterns alongside colors
- **Location:** `CashFlowChart.tsx:31-37`
- **WCAG Violation:** 1.4.1 Use of Color
- **Code:**
  ```tsx
  // Current (❌ color alone)
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <span className="flex items-center gap-1">
      <div className="w-3 h-3 bg-emerald-500 rounded-sm"></div> Income
    </span>
    <span className="flex items-center gap-1">
      <div className="w-3 h-3 bg-rose-500 rounded-sm"></div> Expenses
    </span>
  </div>

  // Required (✅ color + icon)
  <span className="flex items-center gap-1">
    <ArrowUpRight className="w-3 h-3 text-emerald-500" aria-hidden="true" />
    <div className="w-3 h-3 bg-emerald-500 rounded-sm" aria-hidden="true"></div>
    Income
  </span>
  <span className="flex items-center gap-1">
    <ArrowDownRight className="w-3 h-3 text-rose-500" aria-hidden="true" />
    <div className="w-3 h-3 bg-rose-500 rounded-sm" aria-hidden="true"></div>
    Expenses
  </span>
  ```

### UX-003: View Toggle Buttons Missing aria-pressed
- **Best practice:** Toggle buttons should have proper ARIA states
- **Current state:** Custom buttons without ARIA attributes
- **User impact:** Screen readers don't announce which view is selected
- **Fix:** Add `aria-pressed` attribute to toggle buttons
- **Location:** `CashFlow.tsx:105-126`
- **WCAG Violation:** 4.1.2 Name, Role, Value
- **Code:**
  ```tsx
  // Current (❌ no ARIA state)
  <button
    onClick={() => setView("bar")}
    className={cn(
      "px-3 py-1.5 text-sm font-medium rounded-sm transition-all",
      view === "bar"
        ? "bg-background dark:bg-slate-800 shadow-sm text-foreground"
        : "text-muted-foreground hover:text-foreground"
    )}
  >
    Trends
  </button>

  // Required (✅ with ARIA)
  <button
    onClick={() => setView("bar")}
    aria-pressed={view === "bar"}
    className={cn(...)}
  >
    Trends
  </button>
  ```

---

## Accessibility Violations (WCAG 2.1 AA)

### A11Y-001: Loading States Not Announced
- **Criterion:** 4.1.3 Status Messages
- **Elements:** Chart loading, table loading
- **Current:** Visual spinner shown, no screen reader announcement
- **Required:** Add `role="status"` and `aria-live="polite"`
- **Location:** `CashFlowChart.tsx:42-45`, `CashFlowTable.tsx:24-27`
- **Code:**
  ```tsx
  // Current (❌ not announced)
  {isLoading ? (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  ) : (

  // Required (✅ announced)
  {isLoading ? (
    <div
      className="flex items-center justify-center h-full"
      role="status"
      aria-live="polite"
      aria-label="Loading cash flow data. Please wait."
    >
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  ) : (
  ```

### A11Y-002: Chart aria-label Is Generic
- **Criterion:** 1.1.1 Non-text Content
- **Elements:** Bar chart, Sankey chart
- **Current:** `ariaLabel="Cash flow bar chart"` - doesn't describe content
- **Required:** Dynamic aria-label with data summary
- **Location:** `CashFlowChart.tsx:99`
- **Code:**
  ```tsx
  // Current (❌ generic)
  ariaLabel="Cash flow bar chart"

  // Required (✅ descriptive)
  ariaLabel={`Cash flow chart showing income of ${formatCurrency(totalIncome)} and expenses of ${formatCurrency(totalExpenses)} from ${dateRange}`}
  ```

### A11Y-003: Table Column Headers Need Scope
- **Criterion:** 1.3.1 Info and Relationships
- **Elements:** Monthly breakdown table headers
- **Current:** `<th>` without `scope` attribute
- **Required:** Add `scope="col"` to all header cells
- **Location:** `CashFlowTable.tsx:44-50`
- **Code:**
  ```tsx
  // Current (❌ no scope)
  <th className="px-6 py-3">Month</th>

  // Required (✅ with scope)
  <th scope="col" className="px-6 py-3">Month</th>
  ```

### A11Y-004: Summary Cards Missing Semantic Structure
- **Criterion:** 1.3.1 Info and Relationships
- **Elements:** Summary stat cards
- **Current:** Plain divs with no semantic meaning
- **Required:** Use `<dl>` (description list) for stat key-value pairs
- **Location:** `CashFlowSummary.tsx:22-62`
- **Code:**
  ```tsx
  // Current (❌ plain divs)
  <Card className="p-5">
    <div className="text-xs">Total Income</div>
    <div className="text-2xl font-bold">{formatCurrency(totals.income)}</div>
  </Card>

  // Required (✅ semantic)
  <Card className="p-5">
    <dl>
      <dt className="text-xs">Total Income</dt>
      <dd className="text-2xl font-bold">{formatCurrency(totals.income)}</dd>
    </dl>
  </Card>
  ```

### A11Y-005: Focus Not Visible on Filter Button
- **Criterion:** 2.4.7 Focus Visible
- **Elements:** Filter trigger button
- **Current:** Custom button may not show focus ring
- **Required:** Ensure visible focus indicator
- **Location:** `CashFlowFilters.tsx:98-106`

---

## Enhancement Opportunities

### PATTERN-001: No Drill-Down from Chart
- **Enhancement opportunity:** Click bar segment → see transactions for that period
- **Current state:** Chart is view-only, no interaction
- **Priority:** P1
- **Impact:** Users can't explore data sources

### PATTERN-002: No Comparison Mode
- **Enhancement opportunity:** Toggle to compare current vs previous period
- **Current state:** Only shows single time range
- **Priority:** P2
- **Impact:** Can't easily see trends

### PATTERN-003: Legend Not Interactive
- **Enhancement opportunity:** Click legend item to show/hide that series
- **Current state:** Legend is static display only
- **Priority:** P2
- **Impact:** Can't focus on single data series

---

## Positive Observations

### What Works Well

1. **Dark Mode Support** ✅
   - Excellent CSS variable usage throughout
   - Chart theme adapts to dark mode
   - All text remains readable
   - Location: `CashFlowChart.tsx:100-116`

2. **Filter Dialog UX** ✅
   - Proper label associations with `htmlFor`
   - Clear visual hierarchy
   - Reset to defaults option
   - Active filter count badge
   - Location: `CashFlowFilters.tsx`

3. **Error State Handling** ✅
   - Clear error message
   - Retry button available
   - Non-technical language
   - Location: `CashFlowChart.tsx:46-58`

4. **Empty State Messaging** ✅
   - Friendly icon + message
   - Explains why no data
   - Location: `CashFlowChart.tsx:59-68`

5. **Loading Feedback** ✅
   - Spinner animation
   - Consistent across components
   - Export button disabled during export

6. **Form Controls** ✅
   - Labels properly associated
   - Select dropdowns accessible
   - Switch toggles have labels

---

## Responsive Design Assessment

### Mobile (320px-768px)

| Feature | Status | Notes |
|---------|--------|-------|
| Summary cards | ✅ | Stack vertically |
| Charts | ⚠️ | Sankey may overflow |
| Filters dialog | ✅ | Full-width on mobile |
| Table | ✅ | Horizontal scroll |
| View toggle | ✅ | Stays in header |

### Touch Targets

| Element | Size | Status |
|---------|------|--------|
| View toggle buttons | 38px height | ⚠️ Should be 44px |
| Filter button | 40px | ⚠️ Should be 44px |
| Export button | 40px | ⚠️ Should be 44px |
| Date picker | 44px | ✅ |
| Select dropdowns | 40px | ⚠️ Should be 44px |

---

## Keyboard Navigation Audit

| Action | Key | Status |
|--------|-----|--------|
| Open filter dialog | Tab + Enter | ✅ Works |
| Navigate filter fields | Tab | ✅ Works |
| Close filter dialog | Escape | ✅ Works |
| Toggle view | Tab + Enter | ✅ Works |
| Navigate chart data | Arrow keys | ❌ Not supported |
| Navigate table rows | Tab | ⚠️ Works but no row focus |
| Trigger export | Tab + Enter | ✅ Works |

---

## Screen Reader Testing Notes

### VoiceOver (macOS) Simulation

| Element | Announced As | Expected | Status |
|---------|--------------|----------|--------|
| Summary cards | "Total Income, $10,000" | Same | ⚠️ No semantic structure |
| View toggle | "button, Trends" | "toggle button, Trends, selected" | ❌ |
| Bar chart | "Cash flow bar chart" | Dynamic description | ⚠️ |
| Loading state | Nothing | "Loading..." | ❌ |
| Table headers | "Month" | "Month, column header" | ⚠️ |

---

## Recommendations

### P0 (Accessibility - Must Fix for Compliance)
1. **Add aria-pressed to view toggle buttons** - `CashFlow.tsx:105-126`
2. **Add role="status" to loading states** - `CashFlowChart.tsx:42-45`, `CashFlowTable.tsx:24-27`
3. **Add icons to legend** alongside colors - `CashFlowChart.tsx:31-37`

### P1 (Monarch Parity - Should Match)
4. **Add scope to table headers** - `CashFlowTable.tsx:44-50`
5. **Increase touch targets** to 44px minimum
6. **Add keyboard navigation** to charts or provide data table alternative

### P2 (Enhancement - Nice to Have)
7. **Use semantic `<dl>` structure** for summary cards
8. **Make legend interactive** for filtering series
9. **Add drill-down** from chart bars
10. **Add dynamic aria-label** to charts with data summary

---

## Files Requiring Changes

| File | Line(s) | Issue | Priority |
|------|---------|-------|----------|
| `CashFlow.tsx` | 105-126 | Add aria-pressed to toggle buttons | P0 |
| `CashFlowChart.tsx` | 31-37 | Add icons to legend | P0 |
| `CashFlowChart.tsx` | 42-45 | Add role="status" to loading | P0 |
| `CashFlowTable.tsx` | 24-27 | Add role="status" to loading | P0 |
| `CashFlowTable.tsx` | 44-50 | Add scope="col" to headers | P1 |
| `CashFlowChart.tsx` | 69-157 | Add keyboard navigation | P1 |
| `CashFlowSummary.tsx` | 22-62 | Use `<dl>` for stats | P2 |
| `CashFlowFilters.tsx` | 98-106 | Verify focus visible | P1 |

---

## Accessibility Checklist

### WCAG 2.1 AA Compliance Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1.1.1 Non-text Content | ⚠️ | Chart aria-label is generic |
| 1.3.1 Info and Relationships | ⚠️ | Table headers need scope, cards need dl |
| 1.4.1 Use of Color | ❌ | Legend uses color alone |
| 1.4.3 Contrast | ⚠️ | Legend text (#999) may fail |
| 2.1.1 Keyboard | ❌ | Charts not keyboard accessible |
| 2.4.3 Focus Order | ✅ | Logical focus order |
| 2.4.7 Focus Visible | ⚠️ | Verify on custom buttons |
| 2.5.5 Target Size | ⚠️ | Several buttons under 44px |
| 3.3.1 Error Identification | ✅ | Error states clear |
| 4.1.2 Name, Role, Value | ❌ | Toggle missing aria-pressed |
| 4.1.3 Status Messages | ❌ | Loading not announced |

**Compliance Score: 58/100** - Multiple AA violations

---

## Dark Mode Verification

| Component | Light | Dark | Status |
|-----------|-------|------|--------|
| Summary cards | ✅ | ✅ | CSS vars |
| Charts | ✅ | ✅ | Theme object |
| Filters dialog | ✅ | ✅ | CSS vars |
| Table | ✅ | ✅ | CSS vars |
| Buttons | ✅ | ✅ | CSS vars |
| Tooltips | ✅ | ✅ | Explicit theming |

**Dark Mode Score: 95/100** - Excellent support

---

## References

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Accessible Rich Internet Applications (ARIA)](https://www.w3.org/WAI/ARIA/apg/)
- [WAI-ARIA Practices - Button Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)
- [Accessible Data Visualization](https://www.smashingmagazine.com/2022/07/accessible-data-visualizations/)
