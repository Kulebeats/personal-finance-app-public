---
name: review-ux
description: UI/UX and Accessibility Review for usability, visual consistency, and WCAG 2.1 AA compliance. Use when reviewing client components for accessibility, dark mode, responsiveness, loading states, and Monarch Money pattern alignment.
---

# UI/UX and Accessibility Review

Review usability, visual consistency, and WCAG 2.1 AA compliance. Benchmark against Monarch Money.

## Context

$ARGUMENTS

## App Constraints

Manual-input finance app (no automatic bank sync). Skip Monarch features for: account sync, institution connections, Zillow integration.

## Process

1. Identify UI module(s) from Module Reference
2. Run anti-pattern scans
3. Test keyboard navigation, dark mode, mobile
4. Compare to Monarch patterns
5. Score and report

## UI Module Reference

| Module | Location | UX Focus |
|--------|----------|----------|
| Dashboard | `client/src/pages/Dashboard.tsx` | Information hierarchy |
| Accounts | `client/src/features/accounts/` | Balance display |
| Transactions | `client/src/features/transactions/` | Search/filter, pagination |
| Budgets | `client/src/features/budgets/` | Progress visualization |
| Goals | `client/src/features/goals/` | Multi-step forms |
| Recurring | `client/src/features/recurring/` | Calendar, status badges |
| Investments | `client/src/features/investments/` | Data-dense tables |
| Reports | `client/src/features/reports/` | Chart interaction |
| CashFlow | `client/src/features/cashflow/` | Chart tooltips |
| Settings | `client/src/pages/settings/` | Form UX |

**Module-specific checklists:** See [references/ux-modules.md](references/ux-modules.md)

## Anti-Pattern Scans

```bash
# Accessibility
rg -n "onClick" <path> | rg -v "onKeyDown"    # Click without keyboard
rg -n "<div.*onClick" <path>                   # Div as button
rg -n "aria-label" <path>                      # Check aria coverage

# Dark mode
rg -n "bg-white|text-black|border-gray-" <path>
rg -n "style={{" <path> | rg "color|background"

# Money formatting
rg -n "toFixed|parseFloat" <path>
```

## Scoring Rubric (100 Points)

| Category | Points | Criteria |
|----------|--------|----------|
| Accessibility | 25 | WCAG 2.1 AA, keyboard nav, screen reader |
| Visual Consistency | 20 | Design tokens, spacing, typography |
| Interaction Design | 20 | Loading, error, empty states |
| Monarch Alignment | 15 | Matches Monarch patterns |
| Dark Mode | 10 | Full coverage, proper contrast |
| Responsiveness | 10 | Mobile/tablet breakpoints |

**Interpretation:** 90+: Excellent | 80-89: Good | 70-79: Acceptable | 60-69: Needs work | <60: Poor

## Core Checklist

### Accessibility (WCAG 2.1 AA)

- [ ] Color contrast 4.5:1 ratio
- [ ] Focus indicators visible
- [ ] Full keyboard navigation
- [ ] Screen reader labels
- [ ] Form labels on inputs
- [ ] Skip link available

### Visual Hierarchy

- [ ] Primary action prominent
- [ ] Heading structure (H1 > H2 > H3)
- [ ] Adequate whitespace
- [ ] Icons have labels/tooltips
- [ ] Loading states match content shape
- [ ] Empty states with CTA

### Interaction

- [ ] Loading feedback during async
- [ ] Success/error feedback
- [ ] Destructive actions confirm
- [ ] Hover states clear

### Forms

- [ ] Required fields marked
- [ ] Correct input types
- [ ] First field focused
- [ ] Logical tab order
- [ ] Submit disabled during submission
- [ ] Errors below fields

### Responsiveness

- [ ] Works at 320px width
- [ ] Touch targets >= 44x44px
- [ ] No horizontal scroll
- [ ] Dialogs fit mobile

### Dark Mode

- [ ] Complete coverage
- [ ] Text readable
- [ ] No hardcoded colors
- [ ] Charts have dark variants

## Monarch Benchmark

Reference: https://www.monarch.com/

| Pattern | Monarch | Verify |
|---------|---------|--------|
| Widgets | Drag-drop customizable | User can rearrange? |
| Net worth | Prominent + trend line | Shows assets/liabilities? |
| Charts | Clean Sankey, progress bars | Readable? |
| Empty states | Illustration + CTA | Guides user? |
| Forms | Wizard + progress indicator | Step indicator? |
| Amount input | Currency prefix, 2 decimals | Formatted as typed? |

## Output Format

```markdown
## Module: [Name] UI Review
Score: XX/100 | Status: Excellent / Good / Needs Work / Poor

## Findings (by Severity)

### CRIT-001: [Description]
- Monarch does: [Pattern]
- We do: [Current]
- User impact: [Effect]
- Location: [file:line]

## Score Breakdown

| Category | Score | Max | Notes |
|----------|-------|-----|-------|
| Accessibility | X | 25 | |
| Visual Consistency | X | 20 | |
| Interaction Design | X | 20 | |
| Monarch Alignment | X | 15 | |
| Dark Mode | X | 10 | |
| Responsiveness | X | 10 | |

## Accessibility Violations

### A11Y-001: [Type]
- Criterion: [WCAG ref]
- Element: [What fails]
- Fix: [Solution]
- Location: [file:line]

## Dark Mode Issues

### DARK-001: [Issue]
- Element: [What breaks]
- Fix: [Replace with CSS var]
- Location: [file:line]

## State Audit

| Component | Loading | Error | Empty |
|-----------|---------|-------|-------|
| [Name] | OK/FAIL | OK/FAIL | OK/FAIL |

## Recommendations

P0 (Accessibility): [Issues]
P1 (UX): [Issues]
P2 (Polish): [Issues]
```

## Red Flags

**Accessibility:**
- `onClick` without `onKeyDown`
- `<div onClick>` instead of `<button>`
- Missing `aria-label` on icon buttons
- Form inputs without `<label>`
- Color-only indicators

**Dark mode:**
- Hardcoded `bg-white`, `text-black`, `#333`
- Inline styles with colors
- Charts with light-only colors

**Responsiveness:**
- Fixed widths that overflow
- Touch targets < 44px
- Modals taller than viewport

**Performance UX:**
- No skeleton loaders
- Layout shift on load
- No debouncing on search

## Design System

```
Components: client/src/components/ui/     (Radix + shadcn)
Tokens:     client/src/index.css          (CSS variables)
Config:     tailwind.config.ts            (Tailwind theme)
```

Libraries: Radix UI, shadcn/ui, Tailwind, Nivo, Recharts, React Hook Form

## Quick Reference

| Module | Assessment | Score |
|--------|------------|-------|
| CashFlow | `docs/reviews/CASHFLOW_MODULE_ASSESSMENT.md` | 82/100 |
| Recurring | `docs/reviews/RECURRING_MODULE_ASSESSMENT.md` | 72/100 |
| Goals | `docs/reviews/GOALS_MODULE_ASSESSMENT.md` | 68/100 |
| Receipts | `docs/reviews/RECEIPTS_MODULE_ASSESSMENT.md` | 65/100 |
| Reports | `docs/reviews/REPORTS_MODULE_ASSESSMENT.md` | 52/100 |
| Investments | `docs/reviews/INVESTMENTS_MODULE_ASSESSMENT.md` | 45/100 |

Cross-reference: `docs/issues/KNOWN_ISSUES.md`

## Testing Tools

| Tool | Purpose |
|------|---------|
| Chrome Lighthouse | Accessibility audit |
| axe DevTools | WCAG violations |
| Chrome Device Mode | Responsive testing |
| Network Throttling | Loading states |
| Contrast Checker | webaim.org/resources/contrastchecker |
