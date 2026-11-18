# UI/UX & Accessibility Review - Receipts Module

**Date:** 2026-01-21
**Last Updated:** 2026-01-21 (Post-fix assessment)
**Reviewer:** Maya Rodriguez (Senior UX Designer)
**Benchmark:** Manual entry personal finance applications
**App Context:** Manual input personal finance app

---

## UX Assessment Summary

| Metric | Original Score | After Fixes |
|--------|----------------|-------------|
| **Monarch Alignment Score** | 65/100 | **80/100** |
| **Accessibility Score** | 58/100 | **82/100** |
| **Overall UX Score** | 58/100 | **80/100** |
| **Dark Mode Support** | 85/100 | 85/100 |
| **Touch/Mobile UX** | 65/100 | **85/100** |

### Fixes Applied (2026-01-21)

- ✅ TASK-002: Receipt cards converted to buttons with keyboard support
- ✅ TASK-003: Transaction match items converted to buttons with aria-pressed
- ✅ TASK-004: aria-live regions added for loading/progress states
- ✅ TASK-008: Browser confirm() replaced with AlertDialog
- ✅ TASK-009: Remove file button sized to 44px (WCAG 2.5.5)
- ✅ TASK-010: Low-confidence warning banner added
- ✅ TASK-011: Improved image alt text with merchant/date context

---

## Module Scope

```
client/src/pages/
└── Receipts.tsx                    232 LOC

client/src/components/receipts/
├── ReceiptDetailModal.tsx          ⚠️ Browser confirm() dialog
├── ReceiptDetailHeader.tsx         ✅ OK
├── ReceiptDetailsTab.tsx           ✅ OK
├── ReceiptFooter.tsx               ✅ OK
├── ReceiptImagePanel.tsx           ⚠️ No zoom controls
├── ReceiptMatchTab.tsx             ❌ Interactive div
├── ReceiptReviewForm.tsx           ✅ OK (good form a11y)
└── ReceiptScanModal.tsx            ⚠️ Icon button too small
```

---

## Critical UX Issues (Blocks Release)

### UX-001: Receipt Cards Not Keyboard Accessible ✅ FIXED

- **Status:** ✅ **FIXED** in TASK-002 (2026-01-21)
- **Fix applied:** Replaced `<div onClick>` with `<button>` element
- **Added:** `focus-visible:ring-2 focus-visible:ring-ring` styles
- **Added:** `aria-label` with merchant name context
- **Location:** `Receipts.tsx`

### UX-002: Transaction Match Items Not Keyboard Accessible ✅ FIXED

- **Status:** ✅ **FIXED** in TASK-003 (2026-01-21)
- **Fix applied:** Replaced `<div onClick>` with `<button>` element
- **Added:** `aria-pressed` state for selection
- **Added:** Focus-visible ring styles
- **Location:** `ReceiptMatchTab.tsx`

---

## Accessibility Violations (WCAG 2.1 AA)

### A11Y-001: Missing Focus Indicators on Interactive Elements ✅ FIXED

- **Status:** ✅ **FIXED** in TASK-002, TASK-003 (2026-01-21)
- **Fix:** Added `focus-visible:ring-2 focus-visible:ring-ring` to receipt cards and transaction items
- **Location:** `Receipts.tsx`, `ReceiptMatchTab.tsx`

### A11Y-002: Loading States Not Announced ✅ FIXED

- **Status:** ✅ **FIXED** in TASK-004 (2026-01-21)
- **Fix:** Added `aria-live="polite"` region with sr-only loading text to Receipts.tsx
- **Location:** `Receipts.tsx`

### A11Y-003: Upload Progress Not Announced ✅ FIXED

- **Status:** ✅ **FIXED** in TASK-004 (2026-01-21)
- **Fix:** Added `aria-live="polite"` and `aria-atomic="true"` to progress region
- **Location:** `ReceiptScanModal.tsx`

### A11Y-004: Generic Image Alt Text ✅ FIXED

- **Status:** ✅ **FIXED** in TASK-011 (2026-01-21)
- **Fix:** Added descriptive alt text with merchant name and date context
- **Location:** `ReceiptScanModal.tsx`, `ReceiptImagePanel.tsx`

### A11Y-005: Dropzone Needs Better Description

- **Status:** ⚠️ **P2 - Future enhancement**
- **Gap:** Could add aria-describedby for supported formats

### A11Y-006: OCR Scanning State Not Announced

- **Status:** ⚠️ **P2 - Future enhancement**
- **Gap:** Could add aria-busy to OCR button

---

## Monarch Pattern Gaps

### PATTERN-001: No Zoom Controls for Receipt Image

- **Status:** ⚠️ **P2 - Future enhancement**
- **Monarch feature:** Zoom in/out buttons for receipt image review
- **Our gap:** No app-level zoom controls, only browser zoom

### PATTERN-002: Browser confirm() Dialog ✅ FIXED

- **Status:** ✅ **FIXED** in TASK-008 (2026-01-21)
- **Fix:** Replaced browser `confirm()` with styled AlertDialog component
- **Added:** Proper focus management and keyboard support
- **Location:** `ReceiptDetailModal.tsx`

### PATTERN-003: No Keyboard Shortcuts

- **Status:** ⚠️ **P2 - Future enhancement**
- **Monarch feature:** Keyboard shortcuts for common actions
- **Note:** Escape to close modal already works via Radix Dialog

---

## Visual Consistency Issues

### VIS-001: Badge Colors Hardcoded
- **Issue:** Status badges use hardcoded Tailwind colors instead of CSS variables
- **Location:** `Receipts.tsx:37-63`
- **Current:** `bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300`
- **Status:** Works but not using theme system
- **Impact:** Low - colors work in both modes

### VIS-002: Confidence Score No Visual Interpretation
- **Issue:** Shows raw percentage without visual indicator
- **Location:** `ReceiptDetailsTab.tsx:100`
- **Recommendation:** Add color-coded badge:
  - 90-100%: Green (High confidence)
  - 70-89%: Yellow (Medium)
  - <70%: Red (Low - review manually)

---

## Touch Target Issues

### TOUCH-001: Remove File Button Too Small
- **Element:** X button to remove uploaded file
- **Current size:** 24×24 pixels (h-6 w-6)
- **WCAG 2.5.5 (AAA):** Minimum 44×44 pixels
- **Location:** `ReceiptScanModal.tsx:137-145`
- **Fix:** Change to `h-11 w-11` (44px)
- **Code:**
  ```tsx
  // Current (too small)
  <Button
    variant="ghost"
    size="icon"
    className="absolute right-2 top-2 h-6 w-6 rounded-full"
  >

  // Required (44×44)
  <Button
    variant="ghost"
    size="icon"
    className="absolute right-2 top-2 h-11 w-11 rounded-full"
  >
  ```

---

## Positive Observations

### What Works Well

1. **Modal Focus Management** ✅
   - Uses Radix UI Dialog which handles focus trap
   - Focus restored on close
   - Escape key closes modal
   - Location: `ReceiptDetailModal.tsx`

2. **Form Accessibility** ✅
   - React Hook Form with proper Zod validation
   - Labels associated via FormLabel component
   - Error messages in FormMessage
   - aria-expanded on combobox
   - Location: `ReceiptReviewForm.tsx:68-225`

3. **Upload Progress Indicator** ✅
   - Visual progress bar shown
   - Percentage displayed
   - Location: `ReceiptScanModal.tsx:167-175`

4. **Responsive Grid** ✅
   - Mobile: 1 column
   - Tablet: 2 columns
   - Desktop: 3-4 columns
   - Location: `Receipts.tsx:125`

5. **Dark Mode Support** ✅
   - All components have dark mode variants
   - Badges include dark: classes
   - Location: Throughout

6. **Empty State** ✅
   - Clear messaging when no receipts
   - Action button to scan first receipt
   - Location: `Receipts.tsx` (implied)

---

## Responsive Design Assessment

### Mobile (320px-768px)

| Feature | Status | Notes |
|---------|--------|-------|
| Receipt grid | ✅ | 1 column on mobile |
| Upload modal | ✅ | Full width |
| Detail modal | ⚠️ | 85vh height, may need scroll |
| Tabs | ✅ | Stack properly |
| Touch targets | ⚠️ | Some buttons too small |

### Touch Targets

| Element | Size | Status |
|---------|------|--------|
| Receipt card | Full width | ✅ |
| Remove file button | 24px | ❌ Should be 44px |
| Filter badges | ~32px | ⚠️ Borderline |
| Form inputs | 40px | ✅ |
| Action buttons | 40px | ✅ |

---

## Keyboard Navigation Audit

| Action | Key | Status |
|--------|-----|--------|
| Navigate receipt grid | Tab | ❌ Divs not focusable |
| Select receipt | Enter | ❌ Only mouse works |
| Close modal | Escape | ✅ Works |
| Navigate tabs | Tab | ✅ Works |
| Submit form | Enter | ✅ Works |
| Navigate transactions | Tab | ❌ Divs not focusable |
| Select transaction | Enter/Space | ❌ Only mouse works |
| Zoom image | Ctrl +/- | ❌ Not implemented |

---

## Screen Reader Testing Notes

### VoiceOver (macOS) Simulation

| Element | Announced As | Expected | Status |
|---------|--------------|----------|--------|
| Receipt card | "group" | "Button, receipt from Merchant" | ❌ |
| Transaction item | "group" | "Button, $25 on Jan 15" | ❌ |
| Loading spinner | Nothing | "Loading receipt details" | ❌ |
| Upload progress | Nothing | "Uploading... 50%" | ❌ |
| Remove file | "Remove file, button" | "Remove file, button" | ✅ |
| Form inputs | Labels read | Labels read | ✅ |

---

## Recommendations

### P0 (Accessibility - Must Fix for Compliance)
1. **Convert receipt cards to buttons** - Add keyboard support and focus indicators
2. **Convert transaction items to buttons** - Add keyboard support and focus indicators
3. **Add focus-visible styles** to all interactive elements
4. **Add aria-live regions** for loading and progress states

### P1 (Monarch Parity - Should Match)
5. **Add zoom controls** for receipt image review
6. **Replace browser confirm()** with styled AlertDialog
7. **Fix remove file button size** to 44×44px minimum
8. **Add descriptive image alt text**

### P2 (Enhancement - Nice to Have)
9. Add keyboard shortcuts for common actions
10. Add confidence score visual interpretation
11. Use CSS variables for badge colors

---

## Files Requiring Changes

| File | Line(s) | Issue | Priority |
|------|---------|-------|----------|
| `Receipts.tsx` | 127-158 | Convert cards to buttons, add focus styles | P0 |
| `ReceiptMatchTab.tsx` | 76-83 | Convert items to buttons, add keyboard handler | P0 |
| `ReceiptDetailModal.tsx` | 179-182 | Add aria-live to loading state | P0 |
| `ReceiptScanModal.tsx` | 167-175 | Add aria-live to progress | P0 |
| `ReceiptScanModal.tsx` | 137-145 | Fix button size to 44×44 | P1 |
| `ReceiptScanModal.tsx` | 150-154 | Fix alt text | P1 |
| `ReceiptImagePanel.tsx` | 25-29 | Fix alt text | P1 |
| `ReceiptImagePanel.tsx` | 24-29 | Add zoom controls | P1 |
| `ReceiptDetailModal.tsx` | 165-170 | Replace confirm() with AlertDialog | P1 |

---

## Accessibility Checklist

### WCAG 2.1 AA Compliance Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| 1.1.1 Non-text Content | ⚠️ | Generic alt text |
| 1.4.3 Contrast (Minimum) | ✅ | Design system colors pass |
| 2.1.1 Keyboard | ❌ | Interactive divs not accessible |
| 2.4.3 Focus Order | ✅ | Modal focus trap works |
| 2.4.7 Focus Visible | ❌ | Missing focus indicators |
| 2.5.5 Target Size (AAA) | ⚠️ | Remove button 24px |
| 4.1.2 Name, Role, Value | ❌ | Divs have no role |
| 4.1.3 Status Messages | ❌ | Loading/progress not announced |

**Compliance Score: 58/100** - Multiple AA violations

---

## Dark Mode Verification

| Component | Light | Dark | Status |
|-----------|-------|------|--------|
| Receipt grid | ✅ | ✅ | CSS vars |
| Status badges | ✅ | ✅ | Dark variants |
| Detail modal | ✅ | ✅ | CSS vars |
| Upload modal | ✅ | ✅ | CSS vars |
| Form inputs | ✅ | ✅ | CSS vars |
| Borders | ✅ | ✅ | CSS vars |

**Dark Mode Score: 85/100** - Well supported

---

## References

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Accessible Rich Internet Applications (ARIA)](https://www.w3.org/WAI/ARIA/apg/)
- [Radix UI Dialog](https://www.radix-ui.com/docs/primitives/components/dialog)
