# Accessibility Audit Report

**Last Updated:** 2026-02-06  
**Standard:** WCAG 2.1 Level AA  
**Audit Status:** Static review complete with targeted code checks. Automated and manual testing pending.

---

## Scope

- Public/auth flows: login, register, password reset, logout
- Core app: dashboard, accounts, transactions, budgets, goals, reports, recurring
- Settings: profile, security, notifications, categories, merchants
- Shared UI: navigation, dialogs, menus, toasts, tables, charts, drag-and-drop widgets

---

## Methodology

- Static code review for common accessibility risks and baseline compliance.
- Targeted searches for language attributes, focus styles, skip links, image alt usage, and chart components.
- Automated scans (axe DevTools, Lighthouse) planned but not run in this environment.
- Manual checks (keyboard navigation, screen reader, zoom 200%, high-contrast) planned but not run in this environment.

---

## Summary

| Category | Status | Notes |
| --- | --- | --- |
| Confirmed compliant items | Verified | Language attribute, no autoplay media, focus-visible styles in core UI components |
| Confirmed issues | Open | Missing skip-to-content link |
| Pending verification | In progress | Chart text alternatives, drag-and-drop keyboard access, form label association, focus contrast in dark mode |

---

## Confirmed Compliant Items

1. `<html lang="en">` is set in `client/index.html`.
2. No audio/video autoplay elements found in the client codebase.
3. Core UI primitives use `focus-visible` rings for keyboard focus visibility in most components.

---

## Static Review Evidence

1. Language attribute present: `client/index.html`.
2. No `<video>` or `<audio>` tags found in client sources.
3. Focus ring styles present in shared UI components, including `client/src/components/ui/button.tsx`, `client/src/components/ui/input.tsx`, `client/src/components/ui/select.tsx`, and `client/src/components/ui/tabs.tsx`.
4. Image usage spot-check shows `alt` attributes in `client/src/components/BankLogo.tsx`, `client/src/components/layout/Sidebar.tsx`, and `client/src/components/layout/ProfileMenu.tsx`. Full inventory review pending to confirm all dynamic images have appropriate alt text.

---

## Findings and Recommendations

| ID | WCAG Reference | Severity | Status | Evidence | Recommendation |
| --- | --- | --- | --- | --- | --- |
| A11Y-001 | 2.4.1 Bypass Blocks | Medium | Open | No skip-to-content link found in layout components | Add a skip link that targets the main content container. |
| A11Y-002 | 1.1.1 Non-text Content | Medium | Pending verification | Charts use Recharts via `client/src/components/ui/chart.tsx` without explicit text alternatives | Add `aria-label` or `aria-describedby`, and provide a data table or summary for each chart. |
| A11Y-003 | 2.1.1 Keyboard | Medium | Pending verification | Drag-and-drop widgets (categories, dashboard customization) rely on pointer interaction | Provide keyboard controls and announce state changes. |
| A11Y-004 | 1.3.1 Info and Relationships | Medium | Pending verification | Form label association varies across modules | Ensure all inputs have programmatic labels and link error text with `aria-describedby`. |
| A11Y-005 | 1.4.11 Non-text Contrast | Medium | Pending verification | Focus rings exist but contrast in dark mode is unverified | Run contrast checks in both themes; adjust ring and border colors as needed. |
| A11Y-006 | 1.3.1 Info and Relationships | Low | Pending verification | Custom tables and cards may lack header associations | Ensure headers use `<th>` and `scope`, or add ARIA roles for grid layouts. |

---

## Test Matrix

| Area | Automated Scan | Manual Keyboard | Screen Reader | Zoom 200% |
| --- | --- | --- | --- | --- |
| Auth pages | Planned | Planned | Planned | Planned |
| Dashboard | Planned | Planned | Planned | Planned |
| Accounts | Planned | Planned | Planned | Planned |
| Transactions | Planned | Planned | Planned | Planned |
| Budgets | Planned | Planned | Planned | Planned |
| Goals | Planned | Planned | Planned | Planned |
| Reports | Planned | Planned | Planned | Planned |
| Recurring | Planned | Planned | Planned | Planned |
| Settings | Planned | Planned | Planned | Planned |

---

## Remediation Plan

1. Implement skip-to-content link and verify focus management.
2. Add accessible chart summaries and confirm with screen reader tests.
3. Provide keyboard-accessible drag-and-drop alternatives.
4. Audit forms for label and error message associations.
5. Complete automated and manual testing and record results in this report.

---

## Tools

- axe DevTools (browser extension)
- Lighthouse Accessibility Audit
- WAVE Evaluation Tool
- NVDA and VoiceOver
