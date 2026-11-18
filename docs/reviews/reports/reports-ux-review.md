# Reports Module - UI/UX Review

## Metadata

| Field | Value |
|-------|-------|
| Date | 2026-01-23 |
| Reviewer | UI/UX Specialist |
| Scope | `client/src/features/reports/`, `client/src/components/reports/` |
| Score | 72/100 |
| Status | Needs Work |

---

## Accessibility Violations

### A11Y-001: Missing aria-labels on Interactive Elements

- **Criterion:** WCAG 2.1 SC 4.1.2 (Name, Role, Value)
- **Element:** Chart type switcher buttons, period selectors
- **Fix:** Add aria-label to all icon-only buttons
- **Location:** Multiple files

**Scan Results (Updated 2026-01-28):**

```
aria-label count: 2 (found in CashFlowSection.tsx and SpendingSection.tsx)
onClick handlers: 8
```

**Status:** **PARTIALLY FIXED** - Some aria-labels added, but coverage incomplete (2 out of 8+ interactive elements)

### A11Y-002: Chart Keyboard Navigation

- **Criterion:** WCAG 2.1 SC 2.1.1 (Keyboard)
- **Element:** Treemap, Sankey diagram segments
- **Fix:** Add keyboard focus and selection
- **Location:** TreemapChart.tsx, SankeyChart.tsx

### A11Y-003: Color-Only Indicators

- **Criterion:** WCAG 2.1 SC 1.4.1 (Use of Color)
- **Element:** Category colors in charts
- **Fix:** Add patterns or labels for colorblind users
- **Location:** All chart components

---

## Dark Mode Issues

### DARK-001: Hardcoded Chart Colors

- **Element:** Category pie chart, bar chart fills
- **Fix:** Use CSS variables with dark mode variants
- **Location:** chartTheme.ts, various widgets

**Scan Results:**

```bash
# Hardcoded colors found:
chartTheme.ts:15  - #6366f1 (indigo)
chartTheme.ts:16  - #22c55e (green)
chartTheme.ts:17  - #f59e0b (amber)
ComboChart.tsx:45 - stroke="#8884d8"
TreemapChart.tsx:38 - fill="#4f46e5"
```

### DARK-002: Tooltip Background

- **Element:** Nivo chart tooltips
- **Fix:** Use theme-aware background
- **Location:** NivoTooltip.tsx

---

## State Audit

| Component | Loading | Error | Empty |
|-----------|---------|-------|-------|
| SpendingSection | OK | OK | PARTIAL |
| CashFlowSection | OK | OK | PARTIAL |
| NetWorthSection | OK | OK | OK |
| SavingsSection | OK | OK | PARTIAL |
| SummaryCards | OK | OK | OK |
| AnnualDashboard | OK | OK | OK |
| TrendingWidget | SKELETON | OK | PARTIAL |
| ForecastWidget | SKELETON | OK | OK |

**Note:** PARTIAL = shows empty chart instead of helpful message

---

## Score Breakdown

| Category | Score | Max | Notes |
|----------|-------|-----|-------|
| Accessibility | 12 | 25 | No aria-labels, keyboard gaps |
| Visual Consistency | 18 | 20 | Good design system usage |
| Interaction Design | 15 | 20 | Loading states good |
| Monarch Alignment | 12 | 15 | Close to Monarch patterns |
| Dark Mode | 5 | 10 | Hardcoded colors |
| Responsiveness | 10 | 10 | Mobile layouts work |

**Total: 72/100**

---

## Visual Hierarchy: GOOD

- [x] Primary actions prominent (date range, export)
- [x] Heading structure (H1 > H2 > H3)
- [x] Adequate whitespace
- [x] Icons have labels/tooltips (mostly)
- [x] Loading states match content shape
- [ ] Empty states with CTA (partial)

---

## Interaction Design: GOOD

- [x] Loading feedback during async
- [x] Success/error feedback
- [ ] Destructive actions confirm (N/A for reports)
- [x] Hover states clear

---

## Responsiveness: EXCELLENT

- [x] Works at 320px width
- [x] Touch targets >= 44x44px
- [x] No horizontal scroll
- [x] Charts resize properly
- [x] Table scrolls horizontally on mobile

---

## Monarch Benchmark Comparison

| Pattern | Monarch | Our App | Gap |
|---------|---------|---------|-----|
| Period selector | Dropdown with presets | Dropdown with presets | None |
| Chart interactions | Click to drill down | Click to drill down | None |
| Export button | Top right | Top right | None |
| Widget customization | Drag to reorder | Modal with checkboxes | Minor |
| Empty states | Illustration + CTA | Text only | P2 |

---

## Recommendations

### P0 (Accessibility)

1. Add aria-labels to all icon-only buttons (8 instances)
2. Add keyboard navigation to chart segments
3. Add non-color indicators for categories

### P1 (UX)

1. Improve empty state messages with helpful CTAs
2. Add "What's this?" tooltips for complex metrics

### P2 (Polish)

1. Replace hardcoded colors with CSS variables
2. Add chart animation options (reduce motion preference)
3. Consider illustration-based empty states

---

## Files Reviewed

| File | LOC | Status |
|------|-----|--------|
| SpendingSection.tsx | 189 | OK |
| CashFlowSection.tsx | 156 | OK |
| NetWorthSection.tsx | 178 | OK |
| SavingsSection.tsx | 134 | OK |
| SummaryCards.tsx | 145 | OK |
| ReportHeader.tsx | 98 | OK |
| AnnualDashboard.tsx | 287 | OK |
| TreemapChart.tsx | 156 | OK |
| ComboChart.tsx | 198 | OK |
| WidgetCard.tsx | 89 | OK |

**All client components under 300 LOC limit.**
