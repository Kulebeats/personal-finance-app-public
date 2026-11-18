# Module-Specific UI Checklists

Reference file for `/review-ux`. Load when reviewing specific UI modules.

## Table of Contents

- [Dashboard UI](#dashboard-ui)
- [Transactions UI](#transactions-ui)
- [Accounts UI](#accounts-ui)
- [Goals UI](#goals-ui)
- [Recurring UI](#recurring-ui)
- [Investments UI](#investments-ui)
- [Reports UI](#reports-ui)
- [Budgets UI](#budgets-ui)
- [Receipts UI](#receipts-ui)
- [Settings UI](#settings-ui)

---

## Dashboard UI

- [ ] Net worth widget shows totals and breakdown clearly
- [ ] Quick actions are prominent and accessible
- [ ] Recent transactions list is scannable, amounts right-aligned
- [ ] Budget progress bars show remaining amount
- [ ] Widget loading states match widget shape
- [ ] Empty dashboard guides new users to add data

## Transactions UI

- [ ] Search/filter bar always visible
- [ ] Active filters shown as removable chips
- [ ] Bulk selection with checkbox column and "select all"
- [ ] Bulk actions bar appears with item count
- [ ] Split transaction modal shows amount breakdown
- [ ] Recurring badge consistent across app
- [ ] Category icons are recognizable and consistent
- [ ] Pagination shows page, total count, page size selector
- [ ] Empty state includes add CTA

## Accounts UI

- [ ] Assets and liabilities grouped separately
- [ ] Account card shows balance and type icon
- [ ] Balance uses `formatCurrency()` and right alignment
- [ ] Add account modal leads with type selection
- [ ] CSV import has drag-drop, preview, column mapping
- [ ] Account detail filters transactions to account
- [ ] Delete confirmation warns about transaction impact

## Goals UI

- [ ] Progress ring/bar shows percentage and status color
- [ ] Target amount formatted with currency
- [ ] Target date shows relative and absolute time
- [ ] Creation wizard has step indicator and validation
- [ ] Account assignment dropdown is searchable
- [ ] Contribution history is visible
- [ ] Projected completion indicator exists

## Recurring UI

- [ ] Calendar view shows correct dates
- [ ] List view is sortable with status column
- [ ] Status badges consistent (active, paused, ended)
- [ ] Pattern detection UI allows confirm/reject
- [ ] Next due date highlighted with relative time
- [ ] Amount display shows expected amount and variance

## Investments UI

- [ ] Portfolio summary shows total value and gain/loss
- [ ] Holdings table is sortable with quantity/price/value columns
- [ ] Performance chart has time range selector and tooltips
- [ ] Add holding modal supports security search
- [ ] Transaction record supports Buy/Sell/Dividend
- [ ] FX indicator shown when conversion applied

## Reports UI

- [ ] Date range picker has presets and custom
- [ ] Sankey diagram labels readable with tooltips
- [ ] Chart legends are interactive
- [ ] Export button is labeled with format options
- [ ] Loading state shown during fetch
- [ ] Drill-down modal shows transactions for segment

## Budgets UI

- [ ] Progress bar color changes at thresholds
- [ ] Remaining amount shows left/over budget
- [ ] Period selector supports month/year
- [ ] Category list expandable with groups
- [ ] Add budget modal supports category search
- [ ] Rollover indicator shown when applicable

## Receipts UI

- [ ] Upload zone shows file type hints
- [ ] OCR status shows processing and outcomes
- [ ] Match suggestions show confidence
- [ ] Receipt preview available
- [ ] Create transaction pre-fills from OCR data

## Settings UI

- [ ] Sections grouped logically
- [ ] Save feedback toast on success
- [ ] Unsaved changes warning on navigation
- [ ] Inline validation with disabled submit when invalid
- [ ] Currency selector shows symbol and name

---

## Monarch Benchmark Patterns

Reference: https://www.monarch.com/

### Visual Design System

| Element | Monarch Pattern |
|---------|-----------------|
| Color palette | Green primary (#10B981), blue secondary, yellow warning, red error |
| Typography | Clear hierarchy, min 14px body |
| Spacing | 4px/8px grid |
| Cards | Rounded corners (8-12px), subtle shadows |
| Dark mode | Full support with proper contrast |

### Dashboard Patterns

| Component | Monarch Implementation |
|-----------|------------------------|
| Widgets | Drag-and-drop customizable |
| Net worth | Prominent with trend line |
| Transactions | Quick actions, bulk edit, split |
| Charts | Clean Sankey, progress bars |
| Empty states | Illustration + message + CTA |

### Navigation Patterns

| Pattern | Monarch Implementation |
|---------|------------------------|
| Sidebar | Collapsible, icon + label |
| Breadcrumbs | Hierarchical trail |
| Search | Universal (Cmd+K) |
| Mobile nav | Bottom tab bar |

### Form Patterns

| Pattern | Monarch Implementation |
|---------|------------------------|
| Multi-step | Wizard with progress indicator |
| Validation | Inline errors below fields |
| Dropdowns | Searchable with icons |
| Amount input | Currency prefix, 2 decimals |
| Date picker | Calendar with presets |

---

## Cross-Module UI Consistency

### Consistent Patterns

| Pattern | Implementation |
|---------|----------------|
| Card headers | `<CardHeader><CardTitle>` from shadcn/ui |
| Modal/dialog | Radix Dialog with X close |
| Loading | Skeleton or Spinner |
| Empty state | Illustration + message + CTA |
| Error toast | Sonner red variant |
| Success toast | Sonner green variant |
| Delete confirm | AlertDialog red confirm |
| Amount display | `formatCurrency(amount, currency)` |
| Date display | `format(date, 'MMM d, yyyy')` |

### Module Coordination

| Module | Should Match | Shared Elements |
|--------|--------------|-----------------|
| Transactions | Accounts, Receipts | Row format, amounts |
| Goals | Budgets, Accounts | Progress bars, cards |
| Recurring | Transactions, Calendar | Status badges |
| Reports | CashFlow, Dashboard | Charts, date pickers |
| Investments | Accounts, Reports | Balance display |

---

## Testing Instructions

### Keyboard Testing

```
Tab        -> Move forward
Shift+Tab  -> Move backward
Enter      -> Activate buttons, submit
Space      -> Toggle checkboxes
Escape     -> Close modals
Arrow keys -> Navigate dropdowns
```

Checklist:
- [ ] Reach all interactive elements
- [ ] Focus indicator visible
- [ ] Activate buttons with Enter/Space
- [ ] Close modals with Escape
- [ ] Logical tab order

### Dark Mode Testing

1. Toggle theme in Settings
2. Navigate through module
3. Check:
   - [ ] Text readable
   - [ ] No white flashes
   - [ ] Charts have dark variants
   - [ ] Borders visible

### Mobile Testing (Breakpoints)

| Width | Device |
|-------|--------|
| 320px | iPhone SE |
| 375px | iPhone 12/13 |
| 768px | iPad portrait |

Checklist:
- [ ] No horizontal scroll
- [ ] Touch targets >= 44px
- [ ] Text readable
- [ ] Modals scrollable

### Loading/Error Testing

1. Enable Network throttling (Slow 3G)
2. Refresh and verify:
   - [ ] Skeleton loaders appear
   - [ ] Smooth content replacement
3. Disconnect network:
   - [ ] Error message shows
   - [ ] Retry button available

---

## Common Fixes

| Issue | Fix |
|-------|-----|
| Click without keyboard | Add `onKeyDown` |
| Div as button | Use `<Button>` |
| Missing aria-label | Add `aria-label` |
| Hardcoded bg-white | Use `bg-background` |
| Hardcoded text-black | Use `text-foreground` |
| No loading state | `{isLoading ? <Skeleton /> : content}` |
| No empty state | `{data.length === 0 && <Empty />}` |

## Design Tokens

```css
/* Colors */
--background, --foreground, --card, --primary, --secondary, --muted, --destructive

/* Spacing (Tailwind) */
p-1=4px, p-2=8px, p-4=16px, p-6=24px, p-8=32px

/* Border radius */
rounded-sm=2px, rounded=4px, rounded-md=6px, rounded-lg=8px
```
