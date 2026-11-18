# Recurring Module - UI/UX and Accessibility Review

**Reviewer:** UI/UX Specialist (Usability, Visual Consistency, WCAG 2.1 AA)
**Date:** 2026-01-23
**Score:** 75/100 | **Status:** Acceptable (Accessibility Improvements Needed)

---

## Executive Summary

The Recurring module provides a functional calendar/list view with proper dark mode support via CSS variables. Visual design is clean and follows the design system. However, several accessibility gaps exist: interactive calendar items lack keyboard support, icon buttons missing aria-labels, and form inputs missing explicit label associations. The loading/error/empty states are implemented but could be enhanced.

---

## Accessibility Assessment (16/25)

### WCAG 2.1 AA Compliance Check

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1.1.1 Non-text Content | PARTIAL | Icons have visual labels but no aria-labels |
| 1.4.3 Contrast | PASS | Uses design tokens with proper contrast |
| 2.1.1 Keyboard | PARTIAL | Calendar items not keyboard accessible |
| 2.4.7 Focus Visible | PASS | Uses Tailwind focus rings |
| 4.1.2 Name, Role, Value | PARTIAL | Some buttons missing accessible names |

### A11Y Violations Found

**STATUS UPDATE (2026-01-28):** Partial improvements detected. Found 6 aria-label instances across 3 files.

#### A11Y-001: Calendar Items Not Keyboard Accessible

- **Criterion:** WCAG 2.1.1 Keyboard
- **Element:** `<div onClick>` in RecurringCalendar.tsx:74-95
- **Status:** OPEN - No role="button" found in component
- **Fix:** Add `role="button"`, `tabIndex={0}`, and `onKeyDown` handler

```tsx
// Current
<div onClick={() => onItemClick(item.raw)} className="...">

// Should be
<div
  role="button"
  tabIndex={0}
  onClick={() => onItemClick(item.raw)}
  onKeyDown={(e) => e.key === 'Enter' && onItemClick(item.raw)}
  className="..."
>
```

#### A11Y-002: View Toggle Buttons Missing Labels

- **Criterion:** WCAG 4.1.2 Name, Role, Value
- **Element:** Calendar/List toggle buttons in RecurringPageHeader.tsx:48-69
- **Status:** **PARTIALLY FIXED** - Found 2 aria-labels in RecurringPageHeader.tsx
- **Fix:** Add aria-label to icon-only buttons

```tsx
// Current
<button onClick={() => setViewMode("calendar")} className="...">
  <CalendarIcon className="w-4 h-4" />
</button>

// Should be
<button
  onClick={() => setViewMode("calendar")}
  aria-label="Calendar view"
  aria-pressed={viewMode === "calendar"}
  className="..."
>
```

#### A11Y-003: Month Navigation Buttons Missing Labels

- **Criterion:** WCAG 4.1.2 Name, Role, Value
- **Element:** ChevronLeft/ChevronRight in Recurring.tsx:85-97
- **Fix:** Add aria-label

```tsx
<button aria-label="Previous month" className="...">
  <ChevronLeft />
</button>
```

#### A11Y-004: Form Input Labels Not Associated

- **Criterion:** WCAG 1.3.1 Info and Relationships
- **Element:** RecurringEditModal.tsx:56-72
- **Fix:** Use `htmlFor` to associate labels with inputs

```tsx
// Current
<Label>Name</Label>
<Input value={form.name} />

// Should be
<Label htmlFor="recurring-name">Name</Label>
<Input id="recurring-name" value={form.name} />
```

#### A11Y-005: Actions Dropdown Button Missing Label

- **Criterion:** WCAG 4.1.2 Name, Role, Value
- **Element:** RecurringItemActions.tsx:34-40
- **Fix:** Add aria-label to MoreHorizontal button

```tsx
<Button variant="ghost" aria-label={`Actions for ${item.name}`}>
  <MoreHorizontal className="h-4 w-4" />
</Button>
```

---

## Visual Consistency (17/20)

### Design System Compliance

| Check | Status | Notes |
|-------|--------|-------|
| Uses design tokens | PASS | Tailwind CSS variables |
| Consistent spacing | PASS | gap-4, gap-6, p-4, p-6 |
| Typography scale | PASS | text-sm, text-lg, text-2xl |
| Color usage | PASS | text-foreground, bg-muted, etc. |
| Border radius | PASS | rounded-md, rounded-lg |
| Shadow usage | PASS | shadow-sm consistently |

### Hardcoded Colors Found

| File | Line | Color | Issue |
|------|------|-------|-------|
| RecurringCalendar.tsx | 86 | `bg-gray-400` | Should use `bg-muted-foreground` |
| RecurringStateComponents.tsx | 40 | `bg-orange-500` | Inline - should use Button component |
| RecurringPageHeader.tsx | 43 | `bg-orange-500` | Custom button - should use variant |
| RecurringSummary.tsx | 115-128 | `bg-emerald-50/50`, `text-emerald-900` | Hardcoded success colors |

**Dark Mode Impact:** The emerald status card (RecurringSummary:114-130) may have poor contrast in dark mode due to hardcoded light colors.

---

## Interaction Design (17/20)

### State Coverage

| Component | Loading | Error | Empty |
|-----------|---------|-------|-------|
| Recurring Page | OK | OK | OK |
| Calendar | N/A | N/A | Shows blank days |
| List | N/A | N/A | Not handled |
| Summary | N/A | N/A | "No upcoming bills" |

### Interaction Patterns

| Pattern | Status | Notes |
|---------|--------|-------|
| Loading spinner | OK | RecurringLoadingState |
| Error with retry | OK | RecurringErrorState |
| Destructive confirm | OK | AlertDialog for delete |
| Hover states | OK | hover:bg-muted/20 |
| Focus states | PARTIAL | Visible but could be stronger |
| Success feedback | OK | Toast notifications |
| Disabled states | OK | Button disabled during save |

### Issues Found

#### INT-001: List View Empty State Missing

- **Location:** RecurringList.tsx
- **Issue:** No empty state when items array is empty
- **Fix:** Add empty state with CTA

```tsx
{sortedItems.length === 0 && (
  <div className="p-8 text-center">
    <p className="text-muted-foreground">No recurring transactions</p>
    <Button variant="outline" className="mt-4">Add First Recurring</Button>
  </div>
)}
```

#### INT-002: Calendar Item Click Affordance Weak

- **Location:** RecurringCalendar.tsx:73-95
- **Issue:** Items are clickable but cursor:pointer only, no visual affordance
- **Fix:** Add hover scale or elevation

---

## Monarch Money Comparison (12/15)

| Feature | Monarch | Our App | Status |
|---------|---------|---------|--------|
| Calendar view | Month grid, colored dots | Month grid, colored dots | MATCH |
| List view | Sortable table | Grid-based list | MATCH |
| View toggle | Icon buttons | Icon buttons | MATCH |
| Status badges | "Paid", "Due" | Colors only | PARTIAL |
| Upcoming panel | Right sidebar | Right sidebar | MATCH |
| Add button | Top right | Top right | MATCH |
| Edit modal | Full form | Limited fields | PARTIAL |
| Pause indicator | Clear badge | Opacity + badge | MATCH |
| Month navigation | Arrows | Arrows | MATCH |
| Pattern detection UI | Suggestions panel | Not visible in page | GAP |

**Gaps:**
- Edit modal only has Name/Amount/Frequency (Monarch has all fields)
- Pattern detection not surfaced in main UI
- No visual "Paid" status badge (only color)

---

## Dark Mode (8/10)

### Coverage

| Component | Dark Mode | Notes |
|-----------|-----------|-------|
| Calendar grid | OK | Uses bg-card, border-border |
| List view | OK | Uses semantic colors |
| Summary cards | PARTIAL | Status card uses hardcoded emerald |
| Edit modal | OK | Dialog uses dark variants |
| Buttons | OK | shadcn Button component |

### Issues Found

#### DARK-001: Status Card Hardcoded Colors

- **Element:** RecurringSummary.tsx:115-128
- **Issue:** `bg-emerald-50/50`, `text-emerald-900` don't adapt to dark mode
- **Fix:** Use semantic success colors or conditional classes

```tsx
// Current
<Card className="p-4 shadow-sm bg-emerald-50/50 border-emerald-100">

// Should be
<Card className="p-4 shadow-sm bg-success/10 border-success/20 dark:bg-success/20">
```

---

## Responsiveness (5/10)

### Mobile Testing

| Breakpoint | Status | Issues |
|------------|--------|--------|
| 320px | PARTIAL | Calendar items truncate |
| 375px | PARTIAL | Calendar cramped |
| 768px (tablet) | OK | Grid adapts |
| 1024px+ | OK | Full layout |

### Issues Found

#### RESP-001: Calendar Not Mobile-Friendly

- **Location:** RecurringCalendar.tsx
- **Issue:** 7-column grid doesn't collapse on mobile
- **Impact:** Calendar cells very small on phones
- **Fix:** Consider week view or horizontal scroll on mobile

#### RESP-002: Touch Targets Too Small

- **Element:** Calendar item click areas, action buttons
- **Issue:** Some targets < 44px
- **Fix:** Ensure minimum 44x44px touch targets

---

## Score Breakdown

| Category | Score | Max | Notes |
|----------|-------|-----|-------|
| Accessibility | 16 | 25 | Missing aria-labels, keyboard nav |
| Visual Consistency | 17 | 20 | Some hardcoded colors |
| Interaction Design | 17 | 20 | Good states, list empty missing |
| Monarch Alignment | 12 | 15 | Edit modal limited, no pattern UI |
| Dark Mode | 8 | 10 | Status card hardcoded |
| Responsiveness | 5 | 10 | Calendar not mobile-friendly |
| **TOTAL** | **75** | **100** | |

---

## Recommendations

### P0 (Accessibility - Critical)

1. **Add keyboard support to calendar items** - Users relying on keyboard cannot interact with calendar
2. **Add aria-labels to icon-only buttons** - Screen reader users cannot identify buttons
3. **Associate form labels with inputs** - Required for assistive technology

### P1 (UX - Important)

4. **Add empty state to list view** - Users see blank space when no items
5. **Expand edit modal fields** - Match Monarch's full edit capability
6. **Surface pattern detection** - Users can't discover detected patterns

### P2 (Polish)

7. **Fix status card dark mode** - Use semantic colors
8. **Improve calendar mobile UX** - Consider alternative layout
9. **Enhance touch targets** - Ensure 44px minimum

---

## Component Audit Summary

| Component | LOC | A11y | Dark Mode | Mobile |
|-----------|-----|------|-----------|--------|
| RecurringCalendar.tsx | 103 | PARTIAL | OK | POOR |
| RecurringList.tsx | 116 | OK | OK | OK |
| RecurringSummary.tsx | 133 | OK | PARTIAL | OK |
| RecurringEditModal.tsx | 110 | PARTIAL | OK | OK |
| RecurringPageHeader.tsx | 74 | PARTIAL | OK | OK |
| RecurringStateComponents.tsx | 47 | OK | OK | OK |
| RecurringItemActions.tsx | 67 | PARTIAL | OK | OK |
| Recurring.tsx (page) | 226 | PARTIAL | OK | PARTIAL |

---

## Verdict

**ACCEPTABLE** - The Recurring module provides a functional and visually consistent UI with proper loading/error states. However, accessibility gaps (keyboard navigation, aria-labels) need to be addressed before the module can be considered fully accessible. The calendar's mobile experience also needs improvement. The module aligns well with Monarch Money patterns but could benefit from a more complete edit modal.
