# Production Readiness 100 Percent Remediation Plan

**Date:** 2026-07-05  
**Repo:** `C:\Dev\personal-finance-app`  
**Source assessment:** `docs/reviews/production-readiness-closeout-assessment-2026-07-05.md`  
**Goal:** Make every module defensibly 100/100 production ready, with no stale-doc scoring and no unverified closure claims.

## Operating Rules

1. Use a clean branch or isolated worktree off latest `origin/main`.
2. Preserve unrelated dirty files. Stage only intentional files.
3. Fix P0/P1 issues before score polishing.
4. Add a failing real-path test before each security/money/privacy fix where practical.
5. A finding is closed only after local verification and CI pass.
6. Ask before destructive Git actions, branch deletion, force-pushes, production infra changes, or data-destructive DB operations.

## Wave 0 - Worktree And Documentation Hygiene

**Target score impact:** removes process ambiguity, not module risk.

Tasks:

1. Commit or shelve the existing intentional local changes:
   - `docs/reviews/module-assessment-status-report.md`
   - `docs/reviews/module-assessments-index.json`
   - `scripts/tools/generate-module-assessment-status-report.mjs`
   - `server/services/emailService.ts`
   - this assessment document
   - this remediation plan
2. Confirm branch, upstream, worktrees, and dirty files before starting code fixes.
3. Create a dedicated branch such as `codex/production-readiness-100-closeout`.

Verification:

```powershell
git status --short --branch
git worktree list --porcelain
git branch -vv --all
```

Definition of done:

- One branch owns the closeout work.
- No unrelated dirty files are staged.
- Assessment and plan are committed as docs-only or clearly separated from code fixes.

## Wave 1 - P0 Import Execute Hardening

**Modules lifted:** Transactions, Accounts, Budgets, Recurring, Tags, Reports, Audit  
**Current cap:** Transactions 78, Accounts 86, Receipts/Imports adjacent 82  
**Target:** all import-related modules eligible for 100 after dependency/staging gates.

### Requirements

1. Add member-or-higher role enforcement to `/api/import/execute`.
   - Route should reject `view_only` with 403.
   - Keep parse/upload read behavior separate if view-only should be allowed to parse only.
2. Cap JSON import rows.
   - Add a max to `executeImportSchema.rows`, aligned with product/import limits.
   - Return 400 with a clear error envelope when exceeded.
3. Validate target account with private visibility.
   - Replace `accountRepository.findById(...)` with `findByIdWithVisibility(targetAccountId, householdId, userId)`.
   - Reject another member's private account with 404 or 403 consistently with account APIs.
4. Rework `ImportService.executeImport` to use the normal financial write pipeline.
   - Prefer `AccountImportService` or `transactionService.createTransaction`.
   - Do not insert directly into `transactions` unless the same invariants are called centrally.
5. Fix overwrite delete semantics.
   - Delete only transactions visible to the caller and scoped by household/account/date.
   - Ensure delete is audited and balance side effects are correct.
   - Use one DB transaction for overwrite delete plus create batch.
6. Replace `parseFloat` money parsing.
   - Use strict money parsing that rejects partial strings such as `12abc`.
   - Preserve parenthesis-negative support if required.
7. Add business audit logging.
   - Log import execution as a batch operation.
   - Log created/deleted transaction ids or summarized counts with no sensitive values.

### Tests To Add

Create real HTTP + real Postgres tests, not mocked route tests:

1. `view_only` member cannot execute an import.
2. Member cannot import into another member's private account.
3. `prioritize_csv` cannot delete another member's private transactions in the target account/date range.
4. Malformed amount `12abc` is rejected, not imported as `12`.
5. Row cap returns 400 and does not persist rows.
6. Successful import creates expected transactions, updates any required balance state, and writes audit rows.
7. Overwrite import is atomic: injected mid-batch failure rolls back deletes and inserts.

Suggested file:

```text
server/routes/__tests__/import.execute.realdb.integration.test.ts
```

Verification:

```powershell
cd server
npx vitest run routes/__tests__/import.execute.realdb.integration.test.ts --reporter=dot
cd ..
npm run check
npm run test:server:run -- --reporter=dot
```

Definition of done:

- Import no longer bypasses role, visibility, money parsing, audit, balance, idempotency, or transaction service invariants.
- Tests fail on the old code path and pass on the fixed code.

## Wave 2 - P0 Tags Transaction Visibility

**Modules lifted:** Tags, Transactions, Privacy  
**Current cap:** Tags 72, Transactions 78  
**Target:** Tags and related transaction privacy eligible for 100.

### Requirements

1. Pass `userId` and `offset` through the tag transaction read stack:
   - controller to service
   - service to repository
2. Apply transaction visibility in SQL:
   - `transactions.isPrivate = false OR transactions.ownerUserId = userId`
3. Apply pagination in SQL:
   - `limit`
   - `offset`
   - deterministic order, likely date desc plus id desc for stable pagination.
4. Return a count that matches visibility.
   - Either visible count for that tag, or document that the endpoint returns page length only.
5. Add audit/rate review.
   - Read endpoint likely does not need business audit, but confirm no sensitive export behavior.

### Tests To Add

Use real HTTP + real Postgres:

1. Same-household member cannot see another user's private transaction through `GET /api/tags/:id/transactions`.
2. Owner can see their own private transaction through the same endpoint.
3. Shared/public transactions remain visible to household members.
4. `offset` changes the returned page.
5. Count/page metadata matches visible rows.

Suggested file:

```text
server/modules/tags/__tests__/tags.transactions.visibility.realdb.integration.test.ts
```

Verification:

```powershell
cd server
npx vitest run modules/tags/__tests__/tags.transactions.visibility.realdb.integration.test.ts --reporter=dot
npx vitest run modules/tags/__tests__/tags-security.integration.test.ts modules/tags/__tests__/tags.integration.test.ts --reporter=dot
cd ..
npm run check
```

Definition of done:

- A private transaction cannot be discovered through tag reads by another household member.
- Offset is no longer accepted and ignored.

## Wave 3 - P0 Production Dependency Audit

**Modules lifted:** cross-cutting, Auth, Uploads, Email, DB, Reports, AI, all routes  
**Current cap:** true production readiness 78  
**Target:** `npm audit --omit=dev` clean or only documented accepted exceptions with compensating controls.

### Upgrade Groups

1. Safe patch/minor batch:
   - `express-rate-limit` to 8.5.2
   - `multer` to 2.2.0
   - `file-type` to 21.3.4 or compatible safe version
   - `express` to 4.22.2
   - lockfile fixes for `qs`, `path-to-regexp`, `body-parser`, `brace-expansion`, `bn.js`, `minimatch`, `lodash`, `ws`
2. Drizzle major batch:
   - `drizzle-orm` 0.45.2
   - compatible `drizzle-kit` and `drizzle-zod`
   - migration generation/drift verification
   - all query/type compile failures fixed
3. Nodemailer major batch:
   - `nodemailer` 9.0.3
   - update types as needed
   - set `disableFileAccess` and `disableUrlAccess` where supported
   - sanitize/validate any transport names, headers, and envelope-like options
4. Geo/IP batch:
   - upgrade or replace `geoip-lite` if audit requires a downgrade or incompatible major path.
   - ensure IP strings are never rendered through vulnerable HTML helpers.

### Rate Limit Code Change

When upgrading `express-rate-limit`, stop suppressing IP validation without normalization:

- Prefer the package-provided `ipKeyGenerator` if available.
- Normalize IPv4-mapped IPv6 addresses.
- Keep user-id keying where authenticated, but use normalized IP fallback.

### Tests To Add Or Update

1. Rate limiter treats `::ffff:127.0.0.1` and `127.0.0.1` as the same client where applicable.
2. Upload tests still pass after `multer` upgrade.
3. Email tests prove missing SMTP is no-op in test/dev and fails closed in production.
4. Migration/drizzle tests prove schema/migrations still apply.

Verification:

```powershell
npm audit --omit=dev
npm run check
npm run build
npm run test:server:run -- --reporter=dot
npm run test:run:split -- --reporter=dot
npm run deploy:verify
```

Definition of done:

- `npm audit --omit=dev` exits 0, or any remaining finding has a written accepted-risk entry with exploitability analysis and compensating controls.

## Wave 4 - Canonical Module Assessment Refresh

**Modules lifted:** AI Assistant, Filter Presets, all generated reports  
**Current cap:** generated report covers 20 modules and contains stale metadata.

Tasks:

1. Add canonical assessments for missing generated modules:
   - AI Assistant
   - Filter Presets
2. Refresh stale module metadata in:
   - `docs/reviews/module-assessments-index.json`
   - `docs/reviews/module-assessments-metadata.json`
3. Regenerate:
   - `docs/reviews/module-assessment-status-report.md`
4. Ensure generated scores match live code after Waves 1-3.

Verification:

```powershell
npm run report:modules
git diff -- docs/reviews/module-assessment-status-report.md docs/reviews/module-assessments-index.json docs/reviews/module-assessments-metadata.json
```

Definition of done:

- Generated score table has all 22 modules.
- No stale critical/open items remain for work already closed.
- Remaining items in generated docs match this plan or are empty after completion.

## Wave 5 - UI/A11y/Test Noise Cleanup

**Modules lifted:** Tags, Merchants, Cashflow, Dashboard, Settings, overall UX confidence  
**Current cap:** several modules remain under 100 because warnings are ignored.

Tasks:

1. Add Radix dialog descriptions or `aria-describedby={undefined}` intentionally where descriptions are not appropriate.
2. Fix `TagsMultiSelect` invalid nested button structure.
3. Fix `TagColorPicker` test `act(...)` warnings or component update timing.
4. Remove noisy debug stdout from settings tests.
5. Fix mocked query functions that return `undefined`.
6. Add a warning budget policy for client tests: no unexpected console warnings.

Verification:

```powershell
npm run test:run:split -- --reporter=dot
```

Definition of done:

- Client tests pass with no unexpected accessibility/React warning noise.

## Wave 6 - Bundle And Performance Gate

**Modules lifted:** Dashboard, Cashflow, Reports, Receipts, overall UX/performance  
**Current cap:** build passes, but large chart/UI chunks remain.

Tasks:

1. Confirm current app-page gzip budget and target pages.
2. Evaluate whether both Recharts and Nivo Sankey are still needed.
3. Lazy-load heavy report/chart/OCR surfaces more aggressively.
4. Add bundle analysis output to CI or a documented local release gate.
5. Add Lighthouse or Playwright smoke for authenticated app shell if environment allows.

Verification:

```powershell
npm run build
# plus bundle analyzer command if added
```

Definition of done:

- The bundle budget is either met or explicitly accepted with current performance evidence.

## Wave 7 - Staging Smoke And Release Candidate

**Modules lifted:** Health, Auth, Accounts, Transactions, Investments, Weekly Recap, Deploy  
**Current cap:** deploy verify passes locally, but staging smoke still needs real target proof.

Tasks:

1. Provision or confirm Render deployment from `render.yaml`.
2. Apply migrations with versioned migrate path.
3. Run staging smoke:
   - login/session persistence
   - create account
   - create transaction
   - transfer between accounts
   - import CSV into owned account
   - reject import into private account from another member
   - tag transaction visibility
   - GRZ purchase or representative investment write
   - receipt upload and authenticated `/uploads` access
   - weekly recap consent/audit path
4. Exercise rollback.
5. Check production-like env:
   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `REDIS_URL`
   - SMTP settings
   - VAPID keys
   - Gemini key if AI enabled
   - trust proxy
   - DB SSL

Verification:

```powershell
npm run deploy:verify
gh run list --branch main --limit 10
```

Definition of done:

- Staging smoke passes on the deployed artifact.
- Rollback is tested.
- Final SHA has green GitHub Actions.

## Final 100 Percent Gate

Only mark all modules 100/100 after this full command set passes on the final branch/SHA:

```powershell
npm audit --omit=dev
npm run check
npm run build
npm run test:run:split -- --reporter=dot
npm run test:server:run -- --reporter=dot
npm run deploy:verify
npm run report:modules
gh run list --branch main --limit 10 --json databaseId,workflowName,status,conclusion,headSha,url
```

Final required artifacts:

1. Updated production readiness closeout assessment.
2. Updated module score report with all 22 modules.
3. Release notes with closed P0/P1 findings.
4. Staging smoke evidence.
5. Clean Git status or explicitly documented intentional release artifacts.
