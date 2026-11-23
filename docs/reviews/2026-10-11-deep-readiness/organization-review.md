# Organization features — bounded source review, 11 October 2026

Baseline: `381e9439afabe7c6cf829cb1cbded91d36da44ee`. Scope: categories/groups, tags, merchants/aliases/logos/merge, rules, saved filters. Updated user objective: fully functional existing application without the November deadline or reduced pilot scope. Completing advertised controls is required; feature removal/disablement does not satisfy completion. This follow-up inspected reachable client controls, route registration, controllers, services, repositories and relevant validation/schema. No app code changed, tests ran, databases were touched or external services were probed. Only this new report was created for the follow-up; the separately assigned operations report received the parent-requested provider lifecycle citation and scope update.

These modules have substantial working structure. The remaining work is not merely cosmetic: a role-check bypass, incomplete tag privacy filtering, unsafe rule reference validation, mutating rule previews and invalid rule splits need correction before household use. Merchant settings also expose several controls with no server route behind them.

## Coverage and verified positives

| Module | Reachable implementation | Source-verified protections | Limits of this assessment |
|---|---|---|---|
| Categories/groups | Settings create/update/archive/restore, reorder, seed; `categories.routes.ts` mounts these operations | Household-scoped lookup before updates; category group must belong to same household; schemas for money/budget flags; member mutation and admin seeding intent; archive preserves references | Role middleware has ORG-001; no new category-specific blocker established in this bounded pass. Concurrent duplicate-name/restore behavior and full browser persistence remain to exercise. |
| Tags | CRUD/search/defaults/archive/merge, transaction links, per-tag transactions/analytics | Direct transaction-tag operations call `findByIdWithVisibility`; all supplied tag IDs checked for household; duplicate additions use unique link/on-conflict semantics; replace-tag-set is transactional; merges check source/target household and run in a DB transaction | Tag transaction-list privacy ORG-002; counts ORG-009; private-transaction effects of household taxonomy merge need explicit policy/runtime coverage. |
| Merchants | CRUD, autocomplete, seed, duplicate grouping, merge/undo/history, details with aliases | Scoped merchant/category lookups; member mutation intent; merge rejects identical/missing cross-household endpoints and wraps writes/history atomically; history excludes raw moved transaction IDs | Missing routes ORG-006; deletion contract ORG-007; undo count correctness ORG-008. Uploaded logo storage also depends on operations storage packet if implemented. |
| Rules | CRUD/order/bulk-enable/disable, condition preview, per-transaction dry-run, apply-to-past | Regex safety checked on writes and execution; ordinary CRUD scoped to household; preview/apply-to-past read visible transactions; normal application wraps each transaction's effects atomically | ORG-001/003/004/005. Tests exist but this follow-up did not execute them. A condition-only `/preview` must be distinguished from mutating `/:id/dry-run`. |
| Saved filters | Transaction filter selector/save/shared/delete/default flag; context-aware API | User-owned or explicitly shared reads; only creator may update/delete; scoped default advisory lock and partial unique index; scoped name unique index mapped to 409 | Default hook is unused by the page (ORG-010); one role bypass affects writes; contexts beyond transactions are supported server-side but no other selector usage was found. |

Global routing checked in `server/routes.ts`: categories, merchants, tags, rules and presets are modular mounts. The comment at line 37 identifies their legacy routes as removed. Searches across server routes/modules for merchant aliases, logo, analytics and transaction routes found no alternate mounted implementation.

## Findings

### [CRITICAL] ORG-001 — Professional role falls through organization write checks

**Priority:** P0. **Confidence:** high, deterministic source path; consolidate with the main security assessment.

All five modules import `requireRole` from `server/middleware/validateEntity.ts`. Its hierarchy (`:266-271`) includes owner/admin/member/view_only but not the schema's `professional` role (`shared/schema.ts:33`). `householdGuard.ts:105` casts the stored role into the narrower type without runtime validation. The gate calculates `roleHierarchy[role]` and tests only `< requiredRoleLevel` (`validateEntity.ts:284-287`). For professional this is `undefined < number`, which is false, so `next()` executes at `:301`.

**Impact:** a legitimate professional membership can create/edit/delete these household catalog entities, rules and presets, and pass the supposed admin-only category seed gate. The TypeScript assertion does not change the runtime value.

**Acceptance:** every public role has explicit permissions; unknown values fail closed. Real HTTP tests for professional and view_only must reject mutations/seed while preserving permitted reads; owner/admin/member behavior matches an approved matrix. Route-by-route coverage is required because the app has multiple role helpers.

### [CRITICAL] ORG-002 — Tag transaction lists omit private-account visibility

**Priority:** P0. **Confidence:** high source evidence; consolidate with the global privacy packet.

`server/repositories/TagRepository.ts:240-267` filters household, deletion and `transactions.isPrivate`/owner for both rows and count. It does not join accounts or require the account to be shared/owned by the caller. `tags.service.ts:291-321` delegates `/api/tags/:id/transactions` to this query after confirming the tag's household. Direct transaction tagging uses the stronger `findByIdWithVisibility` path, so the module's two read paths differ.

**Reproduction to execute:** A owns a private account, with a transaction whose transaction-level `isPrivate` is false and which carries a household tag. B in that household requests that tag's transactions. Check row and count for A's name/date/amount. Repeat both private flags independently and together.

**Acceptance:** reuse the common account-and-transaction visibility predicate for both count and list, before pagination. B receives no row/count contribution from A's private account; A retains access; separate-household IDs remain 404/empty as appropriate.

### [CRITICAL] ORG-003 — Rule actions can reference entities outside the household

**Priority:** P0. **Confidence:** high source path; runtime boundary probe still required.

`rules.validation.ts:63-79` validates action types but treats values as generic strings/string arrays. `services/rule/actions.ts:51,62-68,143-145,192` directly uses supplied category, tag, owner and split-category IDs. In contrast, `set_merchant` resolves the merchant with household context. No equivalent household/entity validation is performed for those other action references.

Normal rule application sends the updates to `TransactionRepository.update` (`services/rule/service.ts:88-95`); that repository locks/scopes the parent transaction and writes `data` without validating its category/owner reference (`TransactionRepository.ts:410-465`). Tag insertion accepts the tag ID directly (`TagRepository.ts:136-164`), and split insertion only scopes the parent (`TransactionRepository.ts:683-735`). Schema references are ordinary foreign keys to entity IDs, not household-bound composite constraints.

**Impact:** a member who supplies a real entity ID from another household can create cross-household category/tag links or inappropriate ownership assignments, bypassing protections on ordinary transaction/tag APIs. Cross-household tags can then surface through joined tag reads. This is an authorization boundary failure, not merely an invalid-UUID error.

**Acceptance:** validate required action values by action type and resolve all references against the actor's household/visibility before saving and again before execution. Reject foreign/archived/unavailable category/tag/member/goal references with no writes. Test crafted APIs and legacy stored rules, not only the UI's constrained selectors. Use defence-in-depth constraints where practical.

### [HIGH] ORG-004 — Rule dry-run performs database writes

**Priority:** P1, required before rule previews are exposed. **Confidence:** high.

`rules.routes.ts:21` mounts `POST /:id/dry-run`; `rules.controller.ts:409-426` calls `ruleService.dryRunRule`. That method verifies visible transaction access, then calls `evaluateActions` without a transaction at `services/rule/service.ts:286-291`. The evaluator still writes tags/usage counts (`actions.ts:62-68`), merchant aliases (`:120`) and replacement splits (`:204-209`). Without a supplied transaction, those repositories use the default DB or open their own transaction. `previewRules` uses the same evaluator at `service.ts:134-139`.

**Impact:** a preview can change actual tags/aliases or replace financial splits although it claims only proposed changes. Condition-only `/rules/preview` is a separate path and is not accused of this behavior.

**Acceptance:** split pure planning from command execution or require an explicit no-write evaluation mode. Given each mutating action, snapshot DB state, call both dry-run entry paths, and assert zero changes to transactions, splits, tags, aliases, usage counters, goals and audit effects. Apply after preview must produce exactly the approved changes once.

### [HIGH] ORG-005 — Rule split allocations can exceed the parent transaction amount

**Priority:** P1 financial-integrity gate. **Confidence:** high.

`rules.validation.ts:47-53` checks individual positive amounts/0–100 percentages but no aggregate invariant. `actions.ts:164-198` allocates configured early splits, subtracts them from the remainder, assigns the final remainder, then silently drops non-positive splits. `TransactionRepository.addSplits:683-735` replaces rows without checking their sum against the parent's amount.

**Concrete case:** parent amount 100; first split fixed amount 150; final split receives remainder -50 and is discarded. The persisted rows can total 150 while the parent remains 100. Multiple earlier percentages can similarly exceed 100. This is source-derived, not a performed DB mutation.

**Acceptance:** validate complete allocation using Money before any write; reject over-allocation, missing required amounts, invalid combined percentage/fixed semantics and cross-household categories. Persisted split sum must equal the parent's signed/absolute amount per the documented split contract. Tests need independent 100/150 expectations, rounding-remainder cases and failure rollback.

### [HIGH] ORG-006 — Reachable merchant controls have no corresponding server routes

**Priority:** P1; complete the advertised merchant interface. **Confidence:** high, global route checks complete for this scope.

`client/src/hooks/use-settings.ts` calls:

| Client operation | Expected route | Source |
|---|---|---|
| Add/delete alias | POST `/:id/aliases`, DELETE `/:id/aliases/:aliasId` | `:1242,1253` |
| Merchant analytics | GET `/:id/analytics` | `:1304` |
| Merchant transactions | GET `/:id/transactions` | `:1346` |
| Upload/remove logo | POST/DELETE `/:id/logo` | `:1370,1376` |

The complete mounted `server/modules/merchants/merchants.routes.ts:15-26` defines none of these. `server/routes.ts:133` mounts only this module. The paths are reached by `MerchantDetailView.tsx:169-202`, `detail/useMerchantDetailState.ts:34-96`, and `MerchantsSection/hooks/useMerchantHandlers.ts:122-152`. Merchant create/update and logo URL fields do exist; local file upload is the missing operation. Alias data may be created through other services/rule actions, but there is no route servicing these client mutations.

**Impact:** charts/transaction details and alias/logo operations fail or show empty fallbacks. A create-with-file can persist the merchant and then fail the logo request, leaving a partially completed save. In production unmatched GET requests may reach the SPA fallback rather than a JSON 404, causing JSON parsing failure; exact runtime response needs verification.

**Acceptance:** implement the contracts with existing scoped report/transaction services, authenticated durable uploads, role checks and validation. Test every visible action against the actual router without mocking the endpoints. Failed analytics must show an error/retry, not pretend there is no activity. Remove/disable was an earlier pilot option and is not a completion criterion now.

### [MEDIUM] ORG-007 — Merchant deletion options disagree with server behavior

**Priority:** P1 contract completion for all advertised deletion choices. **Confidence:** high.

`MerchantDeleteSection.tsx:35-47` offers archive while retaining transactions, permanent deletion, and merge into another merchant. `use-settings.ts:1277-1289` sends `action`/`mergeTargetId` query options. `merchants.controller.ts:177-182` ignores those options and calls `MerchantService.delete`, which rejects any transaction references (`:311-326`) and otherwise only sets `isActive:false` (`:329-334`). Thus hard-delete/merge are not performed, and even the stated archive-with-transactions behavior is rejected. A distinct working merge endpoint exists, but this control does not route through it.

**Acceptance:** define supported archive/delete/merge semantics once. Archive must preserve history as promised; permanent deletion must never silently mean archive; merge selection must call the merge operation. Response DTO and client message must describe actual affected rows. Test zero and nonzero transaction counts.

### [MEDIUM] ORG-008 — Merchant undo adjusts counts using the original snapshot, not rows actually restored

**Priority:** P2 correctness issue; must close for full merge/undo completion. **Confidence:** high for the stated edit-after-merge case.

Undo only restores transactions still pointing at the target (`MerchantService.ts:480-492`), which appropriately avoids overwriting intervening merchant edits. It then sets source count to the entire historical ID array length (`:498`) and subtracts that same length from target (`:516`). If a merged transaction was deleted or subsequently moved to a third merchant, those cached counts no longer reflect the rows restored. Source/target/count and `canUndo` reads also occur before the transactional writes; replay/concurrency is not protected by a locked history claim.

**Acceptance:** recompute counts from current nondeleted relationships or use actual returned changed rows and a consistent count definition; claim/lock the history atomically. Test edit-to-third-merchant, delete, chained merge and simultaneous undo. Check aliases explicitly: this module's merge never moves `merchantAliases`, unlike the separate repository helper; define retained/moved alias semantics before declaring merge complete.

### [MEDIUM] ORG-009 — Repeating tag removal incorrectly decrements usage count

**Priority:** P2 data-quality defect. **Confidence:** high.

`tags.service.ts:237-239` ignores whether `TagRepository.removeTagFromTransaction` returned a removed link, then decrements usage unconditionally. Removing the same link twice therefore reduces the count twice, potentially hiding legitimate uses elsewhere. Additions already use the correct `inserted` result. Replace-tag links are atomic, but its later usage-count updates (`tags.service.ts:270-283`) are outside that transaction.

**Acceptance:** update counters only for rows actually added/removed and within the same transaction, or derive counts instead. With a tag on two transactions, remove one link twice; count must remain one. Test failed counter writes and repeated/concurrent replace requests against the real DB.

### [MEDIUM] ORG-010 — Saved default preset is stored but never applied on entry

**Priority:** P2, small completion item. **Confidence:** high for absence of caller; product meaning of default should be confirmed.

The save dialog exposes “Set as default preset” (`FilterPresetSelector.tsx:202-207`) and the API persists/enforces the flag. `useDefaultFilterPreset` exists (`hooks/useFilterPresets.ts:76`) but a global client search finds only its definition and barrel export, with no consumer. `useTransactionFilters` derives the initial filters from the URL/default constants; the selector manually applies a chosen preset. The star badge therefore does not currently change page-entry behavior.

**Acceptance:** implement the advertised default-on-entry contract. Explicit deep-link filters must take precedence, reset behavior must be defined, deleted/inaccessible presets must fail safely, and a shared preset must never bypass underlying transaction authorization. Test reload, link navigation and user switch. Renaming the control to a favorite was an earlier scope-reduction option and does not satisfy current completion.

## Completion packets

| Packet | Findings | Concrete work and acceptance | Planning estimate |
|---|---|---|---|
| **ORG-W1 Common organization authorization** | 001–003 | Centralize fail-closed role map; reuse account+transaction visibility for tags; typed rule actions plus reference authorization on save and execution. Real-DB two-user/two-household and professional-role matrix. No new product behavior required. | 1.5–3 engineer-days, shared with security/finance packet |
| **ORG-W2 Safe rule planning and application** | 004–005 | Separate pure evaluation from writes; enforce Money split totals and rollback; expose accurate apply-to-past successes/failures rather than silently swallowing per-transaction failures (`rule/service.ts:179-190`). Preview DB state unchanged; apply matches preview and reconciles parent/splits. | 1–2.5 days |
| **ORG-W3 Complete merchant surface** | 006–008 | Implement aliases, local-logo, analytics and transaction detail contracts; align deletion selector, merge alias/count/undo semantics, errors and refresh. Retain existing URL-logo and basic CRUD. Persistent logo work depends on OPS-W2. | 2–4 days |
| **ORG-W4 Catalog and saved-filter polish** | 009–010 | Make tag counters idempotent/atomic; wire default preset with URL precedence; role-aware controls hide forbidden writes while server remains authoritative. Verify category/group/archive restore and duplicate-name cases without changing existing historical transactions unexpectedly. | 0.5–1.5 days |

Do not count the same global role/privacy defect twice in the completion plan. All four packets contribute to full existing functionality; severity determines implementation order, not permission to leave advertised controls unfinished. Required repair is not permission to alter app code during this assessment.

## Historical and evidence reconciliation

- The July W10 worksheet's Rules `100/100` is not supported as a current unconditional readiness statement: regex hardening, visible transaction reads and normal per-transaction atomicity are present, but ORG-003/004/005 show distinct unresolved paths.
- Tags' newer real-DB visibility tests are valuable; their existence does not establish private-account exclusion. Verify both privacy flags independently before closing ORG-002.
- Merchant basic CRUD/merge implementation does not prove every control in its expanded settings/detail UI is wired. The missing route family is established by current global route inventory, not an inference from old documents.
- Preset default/name concurrency guards are real implementation improvements. The remaining default-on-entry UI gap is separate from backend persistence correctness.
- Parent's broader suite results may be referenced in the main evidence register. This report adds source findings and exact pending reproductions; it does not claim new executable test coverage.

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 3 | block |
| HIGH | 3 | warn |
| MEDIUM | 4 | info |
| LOW | 0 | pass |

Verdict: **BLOCK for the affected organization/rule features pending authorization, privacy and financial-integrity fixes.** Basic catalog work is substantially implemented, but a green general smoke suite does not close these specific paths.
