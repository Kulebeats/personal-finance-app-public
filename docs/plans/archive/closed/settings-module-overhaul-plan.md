# Settings Module Overhaul Implementation Plan

**Date:** 2026-01-26
**Status:** Closed (Re-audited 2026-02-07)
**Scope:** `server/modules/settings/`, `server/modules/categories/`, `server/modules/rules/`, `server/modules/merchants/`, `client/src/pages/settings/`, `client/src/features/settings/`
**Inputs:** settings-module-assessment.md, settings-senior-dev-review.md, settings-qa-review.md, settings-fintech-review.md, settings-functionality-review.md, settings-ux-review.md

---
## Re-Audit 2026-02-07

This plan is no longer an active execution plan.

- Core items in this plan are implemented in code:
- Rate limiting on settings/rules/merchants routes.
- Audit logging on settings/rules/merchants mutations.
- Notification preference persistence and merchant merge atomicity fixes.
- Settings integration tests are active and passing.
- Remaining references in this file are historical checklist items from the original assessment.

For remaining open work across modules, see `docs/backlog/open-plan-backlog-2026-02-07.md`.

---

## Goals

1.  **Compliance (P0):** eliminate regulatory gaps (audit logging, rate limiting).
2.  **Correctness (P0):** Fix critical bugs (notification persistence, merchant merge atomicity).
3.  **Code Quality (P1):** Enforce CLAUDE.md (LOC limits, no `any`, type safety).
4.  **UX & Stability (P1/P2):** Improve accessibility, mobile responsiveness, and rule editor safeguards.
5.  **Testing (P0/P1):** Establish server-side integration testing baseline.

---

## Phase 0 - Compliance & Critical Fixes (P0)

> [!IMPORTANT]
> These items address regulatory risks and broken core functionality.

### 1. Rate Limiting

Add `generalLimiter` middleware to all routes in:

- [ ] `server/modules/settings/settings.routes.ts`
- [ ] `server/modules/rules/rules.routes.ts`
- [ ] `server/modules/merchants/merchants.routes.ts`

### 2. Audit Logging

Add `businessAuditService` log calls for all mutations:

- [ ] **Settings Core:** Profile update, password change, session revoke, **revoke all sessions**, account deletion.
- [ ] **Rules:** Create, update, delete, reorder, apply-to-past.
- [ ] **Merchants:** Create, update, delete, merge.

### 3. Functional Fixes

- [ ] **Notification Persistence:** Fix `settings.controller.ts` `updateNotificationPreferences` to actually persist changes.
- [ ] **Merchant Merge Atomicity:** Wrap `merchants.controller.ts` merge in `withTransaction()` to prevent data loss.

---

## Phase 1 - Architecture & Type Safety (P1)

> [!NOTE]
> Improving maintainability and adhering to project standards.

### 1. LOC Compliance (Client)

Split oversized components (>300 LOC):

- [ ] `ProfileForm.tsx` → `ProfileBasicInfo.tsx`, `ProfileAddress.tsx`, `ProfileFinancial.tsx`
- [ ] `MembersSection/index.tsx` → `MembersList.tsx`, `InviteMemberModal.tsx`
- [ ] `HouseholdSection/index.tsx` → `HouseholdForm.tsx`, `HouseholdMembers.tsx`
- [ ] `PreferencesSection/index.tsx` → `DisplayPrefs.tsx`, `RegionalPrefs.tsx`

### 2. Type Safety

- [ ] **Remove `as any` (Server):** Fix `settings.controller.ts` validation result casting.
- [ ] **Remove `as any` (Client):** Fix `RulesSection`, `GroupDialog`, `CategoryList`, `AddressFields` using proper Zod inference types.

### 3. Error Handling

- [ ] **Standardize Rules:** Update `rules.controller.ts` to use `core/errors` and `core/http` helpers instead of custom ones.

---

## Phase 2 - UX, Accessibility & Reliability (P1/P2)

### 1. Rules Editor Improvements (P1)

- [ ] **Advanced Fields:** Expose `applyToPast`, `priority`, and `isEnabled` in the UI.
- [ ] **Shared Owner:** Fix `ActionCard.tsx` `set_owner` to include "Shared (No Owner)" option (matching `QuickRuleActionBuilder`).
- [ ] **Guards:** Add unsaved changes warning to modal and disable save if conditions/actions are empty.

### 2. Accessibility & Design (P1)

- [ ] **Aria Labels:** Add `aria-label` to icon-only buttons in `CategoryItem`, `RuleCard`, `MerchantCard`.
- [ ] **Dark Mode:** Replace hardcoded `dark:bg-[#161b22]` and `bg-gray-50` with semantic tokens (`bg-card`, `bg-muted`).

### 3. Mobile Responsiveness (P2)

- [ ] **Rules:** Stack conditions/actions vertically on mobile breakpoints.
- [ ] **Layout:** Collapse Settings sidebar to hamburger menu on mobile.
- [ ] **Merchants:** Move actions to overflow menu on small screens.

---

## Phase 3 - Testing & Verification (P0/P1)

### 1. Server Integration Tests (P0)

- [ ] **Rules:** CRUD, reorder, apply-to-past (`rules.integration.test.ts`).
- [ ] **Merchants:** CRUD, merge (`merchants.integration.test.ts`).
- [ ] **Settings Core:** Profile, preferences, sessions, account deletion.

### 2. Additional Tests (P1)

- [ ] **Categories:** Integration tests for groups, categories, reorder.
- [ ] **Authorization:** Verify household isolation across all modules.

---

## Verification Checklist

### Manual Validation

1.  **Audit:** Perform Profile Update, Password Change, Rule Create, Merchant Merge. Check DB `audit_logs` table.
2.  **Rate Limit:** spam endpoint (curl/Postman) -> verify 429 Too Many Requests.
3.  **Notifications:** Toggle settings -> Refresh -> Verify persistence.
4.  **Merge:** Merge Merchant A into B -> Check transactions moved -> Check A deleted -> Check no orphan data.
5.  **Rules:** Create Rule -> Set Owner "Shared" -> Verify in DB `ownerUserId` is NULL.
6.  **Mobile:** Resize browser < 768px -> Check Rules/Merchant cards stack.

### Automated Verification

```bash
npm run test:server:run -- settings.integration.test.ts
npm run test:server:run -- rules.integration.test.ts
npm run test:server:run -- merchants.integration.test.ts
npm run lint # Verify no LOC violations or 'as any'
```
