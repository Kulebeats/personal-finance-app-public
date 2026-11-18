# CashFlow Module - Manual Browser Test Plan

**Date:** 2026-01-23
**Module:** CashFlow
**Version:** 1.0
**Tester:** _____________
**Test Date:** _____________

---

## Overview

This document provides a comprehensive manual test plan for the CashFlow module. Each test includes step-by-step instructions, expected results, and pass/fail criteria. Complete all tests and document any issues found.

---

## Prerequisites

Before starting tests:
- [ ] Database has sample data (transactions, accounts, budgets, recurring rules)
- [ ] Test household has multi-currency transactions (at least one non-household currency)
- [ ] At least 3 months of historical transaction data exists
- [ ] Budget data exists for at least 2 categories
- [ ] At least one recurring rule is configured
- [ ] Browser console is open (F12) to check for errors

---

## Test 1: Forecast Toggle Interaction

**Priority:** P1
**Estimated Time:** 5 minutes

### Setup
1. Navigate to `/cashflow`
2. Verify page loads without console errors

### Test Steps

#### Step 1.1: Enable Forecast
1. Click the "Filters" button (top right)
2. Locate the "Include Forecast" toggle switch
3. Toggle it ON (should turn blue/active)
4. Verify the "Forecast Months" selector appears below the toggle
5. Click "Apply Filters"

**Expected Results:**
- [ ] Chart extends beyond current date with lighter-colored bars
- [ ] Legend shows "Actual" and "Forecast" labels
- [ ] Forecast bars are visually distinct (lighter opacity)
- [ ] Forecast metadata appears in console log (if logging enabled)

#### Step 1.2: Adjust Forecast Duration
1. Open Filters again
2. Change "Forecast Months" from 3 to 6
3. Apply filters

**Expected Results:**
- [ ] Chart extends 6 months into the future
- [ ] All forecast bars render correctly
- [ ] No console errors

#### Step 1.3: Disable Forecast
1. Open Filters
2. Toggle "Include Forecast" OFF
3. Apply filters

**Expected Results:**
- [ ] Forecast bars disappear from chart
- [ ] Chart returns to historical data only
- [ ] No visual artifacts remain

#### Step 1.4: Forecast with Non-Monthly Interval
1. Open Filters
2. Select "Weekly" interval
3. Attempt to enable "Include Forecast"

**Expected Results:**
- [ ] Toggle is disabled or grayed out
- [ ] Tooltip/hint explains forecast only works with monthly intervals
- [ ] No console errors

**Pass Criteria:** All substeps pass ✅

---

## Test 2: Budget Comparison Display

**Priority:** P1
**Estimated Time:** 7 minutes

### Setup
1. Ensure test household has budget data for at least 2 categories
2. Navigate to `/cashflow`
3. Set date range to current month

### Test Steps

#### Step 2.1: View Budget Comparison
1. Click "Budget" tab at the top
2. Verify the Budget Comparison table renders

**Expected Results:**
- [ ] Table shows columns: Category, Budget, Actual, Variance, % of Budget
- [ ] At least 2 category rows appear
- [ ] Variance values show correct arithmetic (Actual - Budget)
- [ ] Percentage values are accurate (Actual / Budget * 100)
- [ ] Color coding: green for under budget, red for over budget

#### Step 2.2: Multi-Category Budget Comparison
1. Scroll through all budget categories
2. Verify each row calculates correctly

**Expected Results:**
- [ ] All categories with budgets appear in the table
- [ ] No categories show `NaN` or undefined values
- [ ] Total row at bottom aggregates correctly
- [ ] Colors match variance (positive = green, negative = red)

#### Step 2.3: Period Normalization
1. Change date range to "Last 3 months"
2. Re-check budget comparison values

**Expected Results:**
- [ ] Budget values are normalized (e.g., quarterly budget / 3 for monthly comparison)
- [ ] Variance calculations still accurate
- [ ] Percentage calculations still accurate

#### Step 2.4: Empty Budget State
1. Navigate to a household with no budgets (or temporarily disable all)
2. Check Budget tab

**Expected Results:**
- [ ] Empty state message appears
- [ ] Message says "No budgets found. Create budgets to see comparison."
- [ ] No console errors

**Pass Criteria:** All substeps pass ✅

---

## Test 3: Multi-Currency Warning Visibility

**Priority:** P2
**Estimated Time:** 5 minutes

### Setup
1. Ensure test household has transactions in at least 2 currencies
2. Navigate to `/cashflow`

### Test Steps

#### Step 3.1: Trigger Multi-Currency Warning
1. Set date range to include transactions in multiple currencies
2. Verify the amber warning banner appears at the top of the report

**Expected Results:**
- [ ] Warning banner appears with amber background
- [ ] Icon (AlertTriangle) is visible
- [ ] Title: "Multi-Currency Data Aggregated"
- [ ] Description mentions conversion to base currency
- [ ] Dark mode: banner has appropriate dark amber styling

#### Step 3.2: Single Currency (No Warning)
1. Filter date range to only include single-currency transactions
2. OR switch to a household with only one currency

**Expected Results:**
- [ ] Warning banner does NOT appear
- [ ] No console errors or metadata issues

#### Step 3.3: Dark Mode Toggle
1. Enable multi-currency warning (Step 3.1)
2. Toggle dark mode on/off

**Expected Results:**
- [ ] Warning banner adapts to dark mode (darker amber background, lighter text)
- [ ] Icon remains visible in both modes
- [ ] Text is readable in both modes (WCAG AA contrast)

**Pass Criteria:** All substeps pass ✅

---

## Test 4: Mobile Legend Responsiveness

**Priority:** P2
**Estimated Time:** 10 minutes

### Setup
1. Navigate to `/cashflow`
2. Open browser DevTools (F12)
3. Enable device emulation mode (Ctrl+Shift+M)

### Test Steps

#### Step 4.1: Desktop Legend Positioning
1. Set viewport to 1920x1080 (desktop)
2. Scroll to "Income Breakdown" pie chart
3. Observe legend position

**Expected Results:**
- [ ] Legend appears on the RIGHT side of the pie chart
- [ ] Legend orientation is VERTICAL (column)
- [ ] Legend items do not overlap chart
- [ ] All legend items are readable

#### Step 4.2: Tablet Legend Positioning
1. Set viewport to 768x1024 (tablet)
2. Observe Income/Expense Breakdown pie charts

**Expected Results:**
- [ ] Legend repositions to BOTTOM of chart
- [ ] Legend orientation changes to HORIZONTAL (row)
- [ ] Items wrap if needed
- [ ] No overlap with chart

#### Step 4.3: Mobile Legend Positioning
1. Set viewport to 375x667 (iPhone SE)
2. Observe pie chart legends

**Expected Results:**
- [ ] Legend appears at BOTTOM
- [ ] Legend uses horizontal row layout
- [ ] Items have smaller spacing (4px vs 8px)
- [ ] All items remain visible and readable
- [ ] No horizontal scroll required

#### Step 4.4: Resize Responsiveness
1. Slowly resize browser from 1920px down to 375px
2. Observe legend transitions

**Expected Results:**
- [ ] Legend smoothly transitions at breakpoint (~768px)
- [ ] No visual glitches during resize
- [ ] Chart + legend remain centered
- [ ] No React hydration errors in console

**Pass Criteria:** All substeps pass ✅

---

## Test 5: Sankey Mobile Warning

**Priority:** P2
**Estimated Time:** 5 minutes

### Setup
1. Navigate to `/cashflow`
2. Select "Sankey" view tab
3. Open DevTools device emulation

### Test Steps

#### Step 5.1: Desktop (No Warning)
1. Set viewport to 1920x1080
2. View Sankey diagram

**Expected Results:**
- [ ] Sankey diagram renders fully
- [ ] NO warning banner appears
- [ ] Diagram is readable and interactive

#### Step 5.2: Tablet Threshold (768px)
1. Set viewport to exactly 768px width
2. Observe Sankey view

**Expected Results:**
- [ ] Warning banner appears (mobile threshold is <768px)
- [ ] Banner has amber background
- [ ] Text: "Sankey diagrams are best viewed on larger screens..."
- [ ] Icon: Smartphone icon visible

#### Step 5.3: Mobile (375px)
1. Set viewport to 375px width (mobile)
2. Observe warning banner and diagram

**Expected Results:**
- [ ] Warning banner is prominently displayed
- [ ] Sankey still renders but with warning
- [ ] Banner text wraps appropriately on narrow screen
- [ ] Banner does not cover important UI elements

#### Step 5.4: Dark Mode Mobile
1. Keep viewport at 375px
2. Toggle dark mode

**Expected Results:**
- [ ] Warning banner adapts to dark mode (darker amber background)
- [ ] Text remains readable (WCAG AA contrast)
- [ ] Icon remains visible

**Pass Criteria:** All substeps pass ✅

---

## Test 6: Export Flow End-to-End

**Priority:** P1
**Estimated Time:** 8 minutes

### Setup
1. Navigate to `/cashflow`
2. Set specific filters (e.g., Last 6 months, Monthly, Household scope)

### Test Steps

#### Step 6.1: Basic Export
1. Click the "Export" button (top right)
2. Observe browser behavior

**Expected Results:**
- [ ] Button shows loading state briefly
- [ ] Success toast notification appears
- [ ] CSV file downloads automatically
- [ ] File name format: `cashflow-export-YYYY-MM-DD.csv`

#### Step 6.2: Verify CSV Contents
1. Open the downloaded CSV file in Excel/Sheets
2. Inspect contents

**Expected Results:**
- [ ] Headers: Date, Income, Expenses, Net Savings, Savings Rate
- [ ] Data matches what's visible in the chart
- [ ] Date format is consistent (YYYY-MM-DD or locale-appropriate)
- [ ] Currency values are formatted correctly (no floating-point errors)
- [ ] No empty rows or malformed data

#### Step 6.3: Export with Filters
1. Open Filters modal
2. Change to "Last Year", "Weekly" interval
3. Enable "Include Transfers"
4. Apply filters, then export

**Expected Results:**
- [ ] CSV reflects the filtered data (weekly intervals, full year)
- [ ] Transfer transactions are included if toggled on
- [ ] File size is appropriate for weekly data over 52 weeks

#### Step 6.4: Export with Forecast
1. Open Filters
2. Set to "Monthly" interval
3. Enable "Include Forecast" (6 months)
4. Apply filters, then export

**Expected Results:**
- [ ] CSV includes both actual and forecast periods
- [ ] Forecast rows are clearly marked (e.g., "Forecast" column or suffix)
- [ ] Forecast values are included
- [ ] No mixing of actual and forecast data without clear labels

#### Step 6.5: Export Error Handling
1. Open browser DevTools Network tab
2. Set network to "Offline" mode
3. Attempt to export

**Expected Results:**
- [ ] Error toast notification appears
- [ ] Message: "Failed to export cashflow data"
- [ ] No file downloads
- [ ] Button returns to normal state (not stuck in loading)

**Pass Criteria:** All substeps pass ✅

---

## Test 7: Dark Mode Visual Verification

**Priority:** P2
**Estimated Time:** 10 minutes

### Setup
1. Navigate to `/cashflow`
2. Ensure system is in light mode initially

### Test Steps

#### Step 7.1: Light Mode Baseline
1. View all chart types (Trends, Sankey, Income Breakdown, Expense Breakdown)
2. Document colors and contrast

**Expected Results:**
- [ ] All text is readable (dark on light)
- [ ] Chart colors are vibrant and distinct
- [ ] Legends use `hsl(var(--muted-foreground))`
- [ ] No hardcoded `#999` or similar colors

#### Step 7.2: Toggle to Dark Mode
1. Click theme toggle (usually in header or settings)
2. Switch to dark mode
3. Observe all components

**Expected Results:**
- [ ] Background changes to dark color
- [ ] All text inverts to light on dark
- [ ] Chart colors remain distinct (not washed out)
- [ ] Legends adapt to dark mode (lighter text)
- [ ] Buttons and UI elements adapt

#### Step 7.3: Dark Mode Chart Colors
1. Inspect bar chart colors
2. Inspect pie chart slices
3. Inspect Sankey flow colors

**Expected Results:**
- [ ] Colors remain accessible (WCAG AA contrast with dark background)
- [ ] No colors are invisible or too dim
- [ ] Forecast bars still distinguishable from actual bars
- [ ] Sankey flows remain readable

#### Step 7.4: Dark Mode Warnings and Alerts
1. Trigger multi-currency warning (Test 3 setup)
2. Trigger mobile Sankey warning (Test 5 setup)
3. Trigger any error state

**Expected Results:**
- [ ] Amber warning banners adapt to dark mode (darker amber, lighter text)
- [ ] Icons remain visible
- [ ] Text contrast meets WCAG AA (4.5:1 minimum)

#### Step 7.5: Dark Mode Transitions
1. Toggle dark mode on/off repeatedly (5 times)
2. Check for visual glitches

**Expected Results:**
- [ ] Smooth transition (no flash of unstyled content)
- [ ] No components fail to update
- [ ] No console errors related to theming

**Pass Criteria:** All substeps pass ✅

---

## Test 8: Keyboard Navigation Flow

**Priority:** P2 (Accessibility)
**Estimated Time:** 12 minutes

### Setup
1. Navigate to `/cashflow`
2. Close any open modals/dialogs
3. Put mouse aside (keyboard only)

### Test Steps

#### Step 8.1: Tab Order
1. Click in browser address bar, then press Tab
2. Continue pressing Tab through all interactive elements

**Expected Results:**
- [ ] Focus indicator is visible at all times (blue outline or custom style)
- [ ] Tab order is logical: Header → View toggles → Summary → Chart → Filters button → Table
- [ ] No focus traps (can always tab to next element)
- [ ] Skip to content link available (optional but recommended)

#### Step 8.2: View Toggle Navigation
1. Tab to the "Trends" / "Sankey" toggle group
2. Use Arrow keys (Left/Right) to switch views

**Expected Results:**
- [ ] Arrow keys change active view
- [ ] Active button has `aria-pressed="true"`
- [ ] Screen reader announces view change (test with NVDA/JAWS if possible)
- [ ] Enter/Space also toggle the view

#### Step 8.3: Filters Modal Keyboard Access
1. Tab to "Filters" button
2. Press Enter or Space to open modal
3. Tab through all filter controls

**Expected Results:**
- [ ] Modal opens
- [ ] Focus moves into modal (focus trap within modal)
- [ ] All controls are keyboard accessible (date pickers, toggles, selects)
- [ ] Tab order within modal is logical
- [ ] Escape key closes modal and returns focus to Filters button

#### Step 8.4: Date Picker Keyboard Navigation
1. Open Filters modal
2. Tab to "From" date picker
3. Press Enter to open date picker
4. Use Arrow keys to navigate dates

**Expected Results:**
- [ ] Date picker opens
- [ ] Arrow keys navigate calendar grid
- [ ] Enter selects a date
- [ ] Escape closes picker without selecting

#### Step 8.5: Toggle Switch Keyboard Interaction
1. In Filters modal, Tab to "Include Pending" toggle
2. Press Space to toggle

**Expected Results:**
- [ ] Toggle switches state (on/off)
- [ ] Visual change is immediate
- [ ] Screen reader announces state change
- [ ] No mouse required

#### Step 8.6: Export Button Keyboard Access
1. Tab to "Export" button
2. Press Enter

**Expected Results:**
- [ ] Export initiates
- [ ] Focus remains on button (or moves to toast notification)
- [ ] Loading state is announced to screen readers

#### Step 8.7: Table Keyboard Navigation
1. Tab into the CashFlow data table
2. Use Arrow keys to navigate cells (if supported)

**Expected Results:**
- [ ] Table is keyboard accessible
- [ ] Screen reader announces column headers
- [ ] Row data is read in logical order

#### Step 8.8: Focus Visibility (WCAG Requirement)
1. Tab through entire page
2. Verify focus indicator on every focusable element

**Expected Results:**
- [ ] All buttons have visible focus indicator (2px outline minimum)
- [ ] Focus indicator has 3:1 contrast with background
- [ ] Custom focus styles (if any) meet WCAG 2.1 AA

**Pass Criteria:** All substeps pass ✅

---

## Test Summary

| Test | Status | Issues Found | Notes |
|------|--------|--------------|-------|
| 1. Forecast Toggle | ⬜ PASS / ⬜ FAIL | | |
| 2. Budget Comparison | ⬜ PASS / ⬜ FAIL | | |
| 3. Multi-Currency Warning | ⬜ PASS / ⬜ FAIL | | |
| 4. Mobile Legend Responsiveness | ⬜ PASS / ⬜ FAIL | | |
| 5. Sankey Mobile Warning | ⬜ PASS / ⬜ FAIL | | |
| 6. Export Flow | ⬜ PASS / ⬜ FAIL | | |
| 7. Dark Mode | ⬜ PASS / ⬜ FAIL | | |
| 8. Keyboard Navigation | ⬜ PASS / ⬜ FAIL | | |

---

## Overall Assessment

**Total Tests Passed:** ___ / 8

**Overall Status:** ⬜ PASS (8/8) | ⬜ PARTIAL (5-7/8) | ⬜ FAIL (<5/8)

---

## Issues Found

Document any bugs, visual issues, or accessibility problems found during testing:

### Issue 1
**Severity:** ⬜ Critical | ⬜ High | ⬜ Medium | ⬜ Low
**Test:** ___________
**Description:**

**Steps to Reproduce:**
1.
2.
3.

**Expected:**
**Actual:**

---

### Issue 2
**Severity:** ⬜ Critical | ⬜ High | ⬜ Medium | ⬜ Low
**Test:** ___________
**Description:**

**Steps to Reproduce:**
1.
2.
3.

**Expected:**
**Actual:**

---

## Sign-Off

**Tester Name:** _____________
**Date Completed:** _____________
**Signature:** _____________

**Reviewed By:** _____________
**Date Reviewed:** _____________
**Approval:** ⬜ Approved | ⬜ Approved with Issues | ⬜ Rejected

---

## Appendix: Browser/Device Matrix

Test on the following browsers/devices for comprehensive coverage:

| Browser | Version | OS | Status |
|---------|---------|----|----|
| Chrome | Latest | Windows 11 | ⬜ |
| Firefox | Latest | Windows 11 | ⬜ |
| Safari | Latest | macOS | ⬜ |
| Edge | Latest | Windows 11 | ⬜ |
| Chrome Mobile | Latest | Android | ⬜ |
| Safari Mobile | Latest | iOS | ⬜ |

---

**End of Manual Test Plan**
