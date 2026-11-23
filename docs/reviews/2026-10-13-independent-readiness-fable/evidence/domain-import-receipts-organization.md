# Domain evidence: import, receipts, organization (rules, tags, merchants, categories)

Verifier: `import-receipts-organization` (independent, read-only). Revision main @ 381e943. Audit server http://localhost:5055, audit DB `finance_app_audit_fable_20261013`. Fixture jar `a2` (user audit_a2_import, household "A2 Import Household" `6cfe9c37-433a-4d44-8935-d53c163bb1ee`, ZMW). Scratch: `.local/readiness-fable-2026-10-13/scratch-import-receipts-organization/` (`a.sh` = api.mjs with jar a2, `q.sh` = q.mjs against the audit DB, `up.mjs` = multipart helper).

Legend: Impl = PRESENT/PARTIAL/MISSING/UNKNOWN; Verif = SRC/TEST/HTTP/DB/BLOCKED.

## 1. CSV import

### Fixture and hand-computed expectations

Fresh account `A2 Import Repro` (`e5be69e2-eb6e-4e15-8061-edcd5df4d5b0`), initial balance 500.00, plus one manual expense 60.00 on 2026-08-05 (balance 440.00). `import2.csv`:

```
Date,Merchant,Description,Amount
2026-08-01,Shoprite,Groceries,-100.00
2026-08-02,Employer,Salary,1000.00
2026-08-03,Pick n Pay,"Milk, bread",-40.50
2026-08-03,Pick n Pay,"Milk, bread",-40.50      <- exact duplicate row
2026-08-04,Cafe A,Coffee,-25.00
2026-08-04,Cafe B,Coffee,-25.00                 <- distinct merchant, same day+amount
2026-02-30,Bad Date Store,Invalid date,-10.00   <- non-existent date
05/08/2026,Corner Shop,Slash date,-7.00         <- ambiguous slash date
2026-08-06,Hungry Lion,Lunch,abc                <- invalid amount
```

Hand expectation for a correct importer: 7 distinct real transactions (Cafe A and Cafe B are different purchases), the duplicate row skipped, 2026-02-30 and `abc` rejected with per-row errors. Net of the 6 rows the server actually imported = -100 +1000 -40.50 -25 -10 -7 = +817.50 -> 440 + 817.50 = 1257.50.

### Observed (HTTP + DB read-back)

| Step | Request | Response | DB / balance |
|---|---|---|---|
| parse | `POST /api/import/parse` (multipart) | 200, 9 rows, `"Milk, bread"` kept intact (quoted comma OK) | n/a |
| run 1 | execute `prioritize_coppercoin` | 200 `{"imported":6,"skipped":2,"deleted":0,"errors":[{"rowIndex":9,"field":"amount","reason":"Invalid money amount","value":"abc"}]}` | balance 1257.50 (matches hand sum). Rows: Bad Date Store dated **2026-03-02**, Corner Shop dated **2026-05-08**, Cafe B **absent**, `notes` NULL on every row |
| run 2 | same file, `prioritize_coppercoin` | 200 `{"imported":0,"skipped":8,...}` | balance unchanged 1257.50 (re-import is a no-op: GOOD) |
| run 3 | same file, `prioritize_csv` (UI "Overwrite & Import"; ReviewStep.tsx:133-139 promises it "replaces them with the CSV data") | 200 `{"imported":1,"skipped":7,"deleted":6,...}` | balance **415.00**; only Cafe B + the manual row are live; Shoprite, Employer 1000.00, Pick n Pay, Cafe A, Corner Shop, Bad Date Store all have `deleted_at` set |
| audit | `audit_logs` | 1 `transaction_import` CREATE per run (counts match response), 1 `transaction` CREATE per inserted row, 1 `transaction` DELETE per soft-deleted row (8 CREATE, 6 DELETE, 3 import rows in the window) | `data_imports` table: **0 rows** (no server code references `dataImports`) |

The earlier (cut-off) attempt of this role left identical evidence on account `A2 Checking` (`8948f507-...`): its `transaction_import` audit rows read `imported 8 / skipped 2`, then `imported 0 / skipped 10`, then `prioritize_csv`: `deleted 9, skipped 9, imported 1`; that account now sits at 975.00 with only "Cafe B" live, having lost a 2000.00 salary row and a manual row dated 2026-09-04.

### Findings

| ID | Surface | Expected (source) | Observed | Impact | Repro | Sev | Conf | Action | Acceptance test |
|---|---|---|---|---|---|---|---|---|---|
| IMP-01 | `prioritize_csv` re-import of an already-imported file. Impl PRESENT, Verif HTTP+DB | Overwrite "replaces them with the CSV data" (client ReviewStep.tsx:136-139) | Soft-deletes every visible row in range, then the per-row idempotency probe (ImportService.ts `existingByIdempotency`, no `isNull(deletedAt)`) finds the **soft-deleted** rows and skips them; the global non-partial UNIQUE `transactions_idempotency_key_unique` would block re-insert anyway. Run 3: deleted 6, imported 1, balance 1257.50 -> 415.00; 817.50 of real ledger rows (incl. 1000.00 salary) vanish while the response reports success | Silent ledger data loss + wrong balance via the documented overwrite path on any previously imported statement | runs 1 and 3 (`exec2_prioritize_coppercoin.json`, `exec2_prioritize_csv.json` in scratch, posted with `a.sh POST /api/import/execute "$(cat ...)"`) | **P0** | High (HTTP+DB, reproduced on two accounts) | Exclude soft-deleted rows from the probe and make the unique index partial (`WHERE deleted_at IS NULL`), or clear the key on soft delete | Real-DB test: import file, re-import with `prioritize_csv`; live rows == CSV rows, balance == initial + CSV sum |
| IMP-02 | Same-day same-amount distinct transactions. Impl PRESENT (by design), Verif HTTP+DB | Distinct merchants are distinct purchases | `importRowKey` = date+type+amount only (services/import/dedupe.ts:27). Cafe B (2026-08-04, -25.00) skipped as "duplicate" of Cafe A; reported only as `skipped: 2`, no row index. Same rule skips a CSV row if ANY existing row in the account has that date+amount | Silent loss of legitimate transactions (two coffees/taxis/same-amount transfers in a day) | run 1 | **P1** | High | Dedupe on the idempotency key fields or flag instead of drop; return skipped row indexes | Two rows same date/amount, different merchant: both persisted |
| IMP-03 | Invalid date `2026-02-30`. Verif HTTP+DB | Reject non-existent dates (CLAUDE.md Rule 8; parse.ts header "reject rather than coerce") | `new Date("2026-02-30")` rolls over; persisted as **2026-03-02**, no error. It also widens the `prioritize_csv` delete window to March, so overwrite deletes manual rows months outside the statement (earlier attempt: manual 2026-09-04 row deleted) | Wrong-dated ledger rows; expanded destructive window | run 1, DB row `Bad Date Store` 2026-03-02 | **P1** | High | Y-M-D round-trip validation as in Rule 8 | 2026-02-30 row yields a per-row `date` error, not persisted |
| IMP-04 | Ambiguous slash dates. Verif HTTP+DB | Zambian statements are dd/MM | `05/08/2026` stored as **2026-05-08** (US); `15/09/2026` falls back to dd/MM (Sep 15, earlier attempt). Mixed interpretation in one file; documented at parse.ts:84-88 but never surfaced to the user | Mis-dated rows, wrong-month budgets/reports | run 1 | P2 | High | User-chosen date format in the mapping step | dd/MM file stores 2026-08-05 |
| IMP-05 | Notes column mapping. Verif HTTP+DB+SRC | Client maps `notes` (ColumnAssignmentStep.tsx:28, ImportWizardContext.tsx:17) | Server `importMappingSchema` (routes/import.ts:17-25) has `description` but not `notes`; Zod strips it; every imported row has `notes = NULL` | Description column silently lost for every UI import | run 1 read-back | P2 | High | Add `notes` to the schema | UI-shaped payload persists notes |
| IMP-06 | Per-row errors in UI. Verif SRC | Rejected rows shown | Server returns `errors[]` (works), but client `ImportExecutionResult` (importApi.ts:21-25) / ProgressModal read only imported/skipped | User sees success; rejected rows invisible | SRC | P2 | Medium | Render `errors` + skipped rows | Component test renders an error row |
| IMP-07 | `data_imports` history | Import record per run (schema `dataImports`, shared/schema.ts:929) | 0 rows after 6 executes; no server reference | No import history/undo | `select count(*) from data_imports` -> 0 | P3 | High | Write rows or drop table | |

What works (import, HTTP+DB): quoted commas parsed; invalid amounts (`abc`, 3-dp `-10.005`) rejected per row with index; accounting `(12.50)` parsed as -12.50 (earlier attempt row); exact duplicate rows within a file skipped; re-running `prioritize_coppercoin` is a true no-op; balance deltas equal the hand sum; `targetAccountId` ownership checked; audit rows per created/deleted transaction plus a summary `transaction_import` row, inside the same DB transaction; idempotency keys present on every imported row; uploadLimiter + requireAuth + householdGuard on the router.

## 2. Receipts

Account `A2 Import Repro` balance before receipts: 415.00. Manual expense "Spar" 42.75 on 2026-10-10 (`00a632e6-...`) -> 372.25 (hand: 415 - 42.75).

| Step | Request | Observed (HTTP) | DB / file read-back |
|---|---|---|---|
| upload | `POST /api/receipts/upload` multipart PNG (sharp 120x160), `x-idempotency-key: a2-rcpt-key-0001` | 201 `receiptId 2518acda-...`, `isDuplicate:false` | `pending_receipts` row: household 6cfe9c37, `ocr_status pending`, `match_status pending`, idempotency key stored, sha256 `image_hash`; files `uploads/receipts/6cfe9c37-.../2518acda-....png` (57948 B) + `_thumb.jpg` (22624 B); audit `receipt CREATE` |
| idempotency replay | same file + same key | 201 `isDuplicate:true`, same receiptId | still 1 row |
| image-hash dedupe | same file, new key | 201 `isDuplicate:true, duplicateOf:2518acda-...` | still 1 row |
| thumbnail / ocr-image | `GET /:id/thumbnail`, `GET /:id/ocr-image` | 200 `image/jpeg` 22624 B; 200 `image/png` 57948 B | n/a |
| cross-tenant | jar a3 (other household) `GET /api/receipts/<id>/thumbnail`; `GET /uploads/receipts/<a2 household>/<file>` | 404 NOT_FOUND; 403 FORBIDDEN | n/a |
| static path guard | a2 `GET /uploads/receipts/11111111-2222-4333-8444-555555555555/<file>` (bogus household) | **403** `{"code":"FORBIDDEN","message":"Access denied"}`; anon -> 401; own household -> 200 | n/a |
| OCR results | `POST /:id/ocr-results` `{merchantName:"Spar",amount:"42.75",date:"2026-10-10",confidence:0.9}` | 200 `ocrStored:true, autoMatched:true, matchedTransactionId:00a632e6-...` | `ocr_status completed`, `match_status matched`, `ocr_data` jsonb stored; audit `receipt UPDATE` + `receipt LINK {method:auto}`; balance unchanged 372.25 |
| OCR validation | amount `42.755`; date `2026-02-30` | 400 "Invalid amount format"; 400 "Invalid date - the date does not exist" | nothing written |
| manual match | receipt3 OCR 99.00 -> txn Cafe B 25.00 | 400 AMOUNT_MISMATCH (tolerance 0.5); with `skipAmountValidation:true` 200 matched; re-match to another txn -> **409** "Receipt is already matched" | linked |
| create-transaction | receipt2 `{name:"Game Stores",amount:"88.40",date:"2026-10-11"}` | 201 txn `ccef3941-...` | balance 372.25 -> 283.85 (hand -88.40 OK); notes `[Receipt Scan] tv cable`, source `receipt_scan`, audit `transaction CREATE` + `receipt LINK` |
| delete | unmatched receipt4 `DELETE /:id` | 200 `deleted:true` | row gone, both files removed from disk, audit `receipt DELETE` |
| delete matched | receipt3 `DELETE /:id` | 400 "Cannot delete matched receipt" | row + files kept (deliberate) |
| type guard | CSV renamed `.png`; raw `.csv` | 400 "Invalid file type. Detected: unknown"; 400 "Allowed types: JPEG, PNG, WebP" | nothing written |

### Findings

| ID | Surface | Expected (source) | Observed | Impact | Repro | Sev | Conf | Action | Acceptance test |
|---|---|---|---|---|---|---|---|---|---|
| RCP-01 | `POST /api/receipts/:id/create-transaction` retried. Impl PRESENT, Verif HTTP+DB | One receipt -> one ledger row; `/match` already refuses re-linking with 409 (transaction.service.ts:135) | `createTransactionFromReceipt` (services/receipt/transaction.service.ts:166-235) never checks `matchStatus`/`matchedTransactionId` and takes no idempotency key. Second identical call created a second 88.40 expense (`57aa8096-...`); balance 283.85 -> **195.45**; receipt now points at the second txn, first is orphaned. Same path also re-links receipt3 that was already matched to Cafe B (201) | Double-charge on double-click / network retry; orphaned match | `a.sh POST /api/receipts/9b83cf21-.../create-transaction '{"accountId":"e5be69e2-...","name":"Game Stores","amount":"88.40","date":"2026-10-11","notes":"tv cable"}'` twice | **P1** | High | `SELECT ... FOR UPDATE` the receipt inside the txn and 409 when already matched (mirror `linkReceiptToTransaction`) | Second call returns 409; exactly one transaction; balance moves once |
| RCP-02 | create-transaction with negative amount. Verif HTTP+DB | Expense amounts are positive; sign is carried by `type` (all other paths store positive amounts, e.g. import stores `abs()`) | `createTransactionSchema.amount` allows `-?` (receipts.validation.ts:90); `{"amount":"-30.00"}` stored as `amount -30.00, type expense`; balance **rose** 195.45 -> 225.45 | A receipt "expense" credits the account; negative expense rows corrupt spend totals/budgets | `a.sh POST /api/receipts/61386ac9-.../create-transaction '{"accountId":"e5be69e2-...","name":"Refund Shop","amount":"-30.00","date":"2026-10-12"}'` | **P1** | High | Use `positiveMoneyDtoSchema` / reject sign | Negative amount -> 400; no row |
| RCP-03 | Receipt detail payload | No server internals in API responses | `GET /api/receipts/:id` returns `storagePath`/`thumbnailPath` (`uploads\receipts\<household>\<file>`) | Minor information disclosure of server filesystem layout | `a.sh GET /api/receipts/2518acda-...` | P3 | High | Strip paths from DTO | |

What works (receipts, HTTP+DB): upload with magic-byte type check, household-scoped idempotency key replay, image-hash dedupe, files under `uploads/receipts/<householdId>/` with hardened extension, thumbnail and OCR-image routes, cross-household 404/403, static `/uploads/receipts/<other household>/` 403 and anon 401, OCR validation (2dp, real dates), auto-match on OCR within tolerance, amount-mismatch guard on manual match, 409 on re-match, delete of unmatched receipt removes row + files, audit rows for CREATE/UPDATE/LINK/DELETE and for the created transaction; balance deltas match hand sums.

## 3. Rules

Snapshot helper `snap.sh` = md5 of every `transactions` row of the household + `audit_logs` count + `transaction_tags` count + md5 of `rules` + merchant count.

| Step | Request | Observed | DB read-back |
|---|---|---|---|
| create | `POST /api/rules` merchant_name contains "Cafe" -> categorize Restaurants + add_tags `["coffee-rule"]` | 201 | rule row; audit `rule CREATE` |
| preview | `POST /api/rules/preview` same condition | 200 `count:2,totalChecked:7` (both live "Cafe B" rows; 7 = live visible txns, hand-counted) | nothing written |
| dry-run | `POST /api/rules/:id/dry-run {transactionId: Cafe B}` | 200 `matches:true, proposedUpdates:{categoryId:3e15...}` | snapshot before == after (`tx_md5 583b2705...`, ttags 5, rules md5 equal, audits unchanged): **writes nothing** |
| apply-to-past (bad tag ref) | `PUT /api/rules/:id {"applyToPast":true}` with the action `add_tags:["coffee-rule"]` (a name, not a tag id) | **200** | `tx_md5` unchanged: NEITHER Cafe B row categorized; no error to the caller |
| apply-to-past (valid) | `PUT` with `add_tags:[<tag uuid>]`, `applyToPast:true` | 200 | both Cafe B rows -> category Restaurants, tag "Coffee" linked, tag `usage_count` 2; audits +1 (rule UPDATE) and **0** transaction UPDATE rows |
| reorder | `PUT /api/rules/reorder {"rules":[{id:R2,priority:0},{id:R1,priority:1}]}` | 200 | priorities 0/1 persisted; bogus id -> also 200 (silently ignored) |
| bulk | `POST /api/rules/bulk-disable` (2 ids) / `bulk-enable` (1 real + 1 bogus id) | 200, returns only rules actually changed | `enabled` flags persisted; audit `rule UPDATE` per rule |
| ReDoS | create with regex `(a+)+$` | **400** "Pattern nests one unbounded repetition inside another" | not stored. `POST /preview` with the same pattern returns 200 `count:0` quickly (execution-time recheck in matching.ts), no hang |
| client test | `POST /api/rules/:id/test` (client `use-settings.ts:1768-1773`, wired to the Test button in `RulesSection/index.tsx:229`) | **404** Express HTML `Cannot POST /api/rules/<id>/test` | n/a |

### Findings

| ID | Surface | Expected | Observed | Impact | Repro | Sev | Conf | Action | Acceptance test |
|---|---|---|---|---|---|---|---|---|---|
| RUL-01 | "Test rule" button. Impl MISSING server route, Verif HTTP+SRC | Client-called endpoint exists | `POST /api/rules/:id/test` -> 404 HTML; `ruleService.testRule` exists (services/rule/service.ts:212) but no route in rules.routes.ts | Settings > Rules "Test" button always errors | `a.sh POST /api/rules/0da0d13a-.../test '{}'` | **P1** (client-called endpoint missing, per guide) | High | Add route + controller or remove the button | POST returns 200 `{matchingCount}` |
| RUL-02 | Action references not validated; apply-to-past fails silently. Verif HTTP+DB+SRC | Invalid rule actions rejected at create; batch failures reported | `actionValueSchema` is `string | string[]` with no uuid/household check (rules.validation.ts:63-66). A rule with `add_tags:["coffee-rule"]` is accepted; apply-to-past then rolls back every transaction (services/rule/service.ts:181-190 logs and continues) and the API returns 200; nothing applied. The same rule will also silently no-op on every new transaction | Rules that look saved never fire; user cannot tell | create rule above, `PUT {"applyToPast":true}`, snapshot unchanged | P2 | High | Validate action values (uuid + exists in household) in Zod/superRefine; return a per-batch failure count | Creating a rule with a non-existent tag id -> 400 |
| RUL-03 | Cross-household tag id in a rule (SRC only, not exercised) | Tag ids scoped to household | `TagRepository.addTagToTransaction` (TagRepository.ts:135-147) and `incrementUsageCount` take a bare `tagId` with no household predicate; combined with RUL-02 a rule could link another household's tag id | Cross-tenant integrity (link + usageCount bump on a foreign tag), requires knowing a foreign UUID | SRC | P2 | Medium | Scope tag lookups by household | Rule with foreign tag id -> 400 |
| RUL-04 | Audit for rule-driven transaction edits. Verif DB | Rule 9: financial updates logged | apply-to-past changed category + tags on 2 transactions; audit delta was only the rule UPDATE row | No DPA trail of bulk categorisation changes | snapshot audits 63 -> 67 (3 tag CREATE + 1 rule UPDATE) | P2 | High | Log a transaction UPDATE (or one batch row with ids) | Apply-to-past writes audit rows naming the changed transactions |
| RUL-05 | dry-run completeness | Shows every action | `proposedUpdates` shows `categoryId` only; the `add_tags` action is not previewed | Preview understates effect | dry-run above | P3 | High | Include tag/alias/split actions in preview | |
| RUL-06 | reorder input | Validate ids | No Zod schema; unknown ids return 200 | Cosmetic | bogus-id reorder | P3 | High | Zod + 404 on unknown ids | |

What works (rules): CRUD with audit rows; preview is visibility-filtered and read-only; dry-run provably writes nothing (row-hash identical); apply-to-past with valid references categorises and tags correctly and is idempotent on usage count; reorder and bulk enable/disable persist and are household-scoped (foreign/bogus ids ignored, not mutated); ReDoS pattern rejected at create with an actionable message.

## 4. Tags and merchants

| Step | Request | Observed | DB read-back |
|---|---|---|---|
| tag create | `POST /api/tags {"name":"Coffee"}`; again same name; `"coffee "` | 201; **409** "A tag with this name already exists"; **201** for `"coffee "` | `tags` has both `Coffee` and `coffee ` (case- and whitespace-distinct duplicate, name not trimmed) |
| attach | `POST /api/tags/transaction/<Spar> {"tagIds":[coffee, Snacks]}`, `.../<Cafe B> {"tagIds":[coffee]}` | 200 | `transaction_tags` rows present; audit `transaction LINK {operation:add_tags}` |
| merge | `POST /api/tags/merge {"sourceTagIds":[coffee,Snacks],"targetTagId":Coffee}`; also with an EMPTY source tag; also single source Snacks | **500** INTERNAL_ERROR every time | no change (rolled back). Root cause proven with a non-executing `EXPLAIN` of the service SQL (tags.service.ts:357-363): `ERROR: column "tag_id" is of type uuid but expression is of type text` (untyped param inside `SELECT DISTINCT`) |
| merge self | source == target | 400 "No source tags to merge" | n/a |
| archive | `POST /api/tags/<Snacks>/archive` | 200 | `is_archived true`; hidden from `GET /api/tags`; existing link kept |
| merchant create | `POST /api/merchants` "Cafe A" (exists), "CAFE B" (case variant), "Cafe B." | 409, 409 (case-insensitive guard), 201 | row |
| duplicates | `GET /api/merchants/duplicates` | 200 one group {Cafe B, Cafe B.} similarity 100 | n/a |
| merge | `POST /api/merchants/merge {"sourceId":Cafe B,"targetId":Cafe B.}` | 200 `mergedTransactionCount:2, mergeHistoryId` | both "Cafe B" transactions now `merchant_id = Cafe B.`; source `is_active false`; audit `merchant MERGE` |
| undo | `POST /api/merchants/merge/<historyId>/undo`; repeat | 200 `restoredMerchant`; repeat **409** "already been undone" | both transactions back on the source, `is_active true`; audit `merchant RESTORE` |
| client sub-routes | `GET /:id/analytics`, `GET /:id/transactions`, `POST /:id/aliases`, `DELETE /:id/aliases/:aliasId`, `POST /:id/logo` (multipart), `DELETE /:id/logo` | **404** Express HTML "Cannot GET/POST/DELETE ..." for all six | n/a |

### Findings

| ID | Surface | Expected | Observed | Impact | Repro | Sev | Conf | Action | Acceptance test |
|---|---|---|---|---|---|---|---|---|---|
| ORG-01 | Tag merge (client `lib/api.ts:1163`). Impl PRESENT but broken, Verif HTTP+DB+EXPLAIN | Merge moves links and deletes sources | Always 500; SQL type error `tag_id uuid vs text` in `INSERT ... SELECT DISTINCT transaction_id, ${targetTagId}` | Feature 100% non-functional | `a.sh POST /api/tags/merge '{"sourceTagIds":["0eb893ee-..."],"targetTagId":"7e5fe0ae-..."}'` -> 500 | **P1** | High | Cast `${targetTagId}::uuid`; add a real-DB test | Merge two tags with overlapping transactions: 200, target linked once per txn, sources deleted, usage_count correct |
| ORG-02 | Merchant detail endpoints used by `components/merchants/detail/useMerchantDetailState.ts` and MerchantsSection handlers (hooks at `use-settings.ts:1241-1375`). Impl MISSING, Verif HTTP | Client-called endpoints exist | analytics, transactions, aliases add/delete, logo upload/delete all 404 (not in merchants.routes.ts:15-26) | Merchant detail panel analytics, transaction list, alias management, logo upload all fail | 6 requests above | **P1** | High | Implement routes or remove the UI | Each call returns 200 envelope |
| ORG-03 | Tag name uniqueness | Case-/whitespace-insensitive per household (merchants already are) | "Coffee" and "coffee " both accepted; name not trimmed | Duplicate tags that later can't be merged (ORG-01) | create both | P3 | High | Trim + `lower()` unique index | 409 on `coffee ` |
| ORG-04 | Counters | `usage_count` / `transactionCount` reflect links | "Receipt Import" tag `usage_count 0` while linked to 6 txns (receipt path never increments); merchant `transactionCount 0` for a merchant with 2 live txns | Misleading analytics/sorting | DB read-back | P3 | High | Derive counts or increment in all paths | |

What works: tag create/attach/archive with audit; same-name tag 409; tag merge validation (self-merge 400) and atomic rollback on failure; merchant case-insensitive duplicate guard, duplicate detection, merge moves transactions with history, undo restores exactly and is single-use; all audited (CREATE/MERGE/RESTORE).

## 5. Categories

| Step | Request | Observed | DB read-back |
|---|---|---|---|
| group create | `POST /api/categories/groups {"name":"Audit Group","type":"expense"}` | 201 | row |
| category create | `POST /api/categories` x2 in group; duplicate name | 201, 201; **409** "Category "Audit Cat 1" already exists" | rows, audit `category CREATE` |
| attach | `PUT /api/transactions/<Spar>` and `<Game Stores>` `{"categoryId":Cat1}` | 200 | `category_id` set on both |
| archive / restore | `PATCH /:id/archive`, `PUT /:id/restore` | 200 / 200 | `is_archived` true -> false; hidden from default `GET /api/categories`, shown with `includeArchived=true` |
| reorder | `PUT /api/categories/reorder {"categoryIds":[Cat2,Cat1]}` | 204 | `display_order` 0/1 |
| delete with transactions | `DELETE /api/categories/<Cat1>` (2 txns attached) | 200 | category **archived** (`is_archived true`, not removed); both transactions keep `category_id` -> no data loss; audit `category DELETE` |
| delete group | `DELETE /api/categories/groups/<G>`, then `PUT /groups/<G>/restore` | 200 / 200 | group `is_archived` toggles; child categories are **not** archived with the group: after restoring Cat1 and re-archiving the group, Cat1 stays active and still appears in the default category list under an archived group |
| query flag | `GET /api/categories?includeArchived=false` | archived categories **included** | `categoryQuerySchema.includeArchived = z.coerce.boolean()` (categories.validation.ts:68) turns the string "false" into `true` |

### Findings

| ID | Surface | Expected | Observed | Impact | Repro | Sev | Conf | Action | Acceptance test |
|---|---|---|---|---|---|---|---|---|---|
| CAT-01 | Archive group | Archiving a group hides its categories (or is blocked while active categories exist) | Group archived, active child category still listed and selectable | Orphaned categories in pickers/budgets under a hidden group | delete group with an active category, `GET /api/categories` | P3 | High | Cascade archive or 409 | Archived group's categories absent from default list |
| CAT-02 | `includeArchived=false` | Excludes archived | Includes them (`z.coerce.boolean("false") === true`) | Latent: the current client only ever sends `true` (use-settings.ts:794, useCategories.ts:40) | `a.sh GET "/api/categories?includeArchived=false"` | P3 | High | `z.enum(["true","false"]).transform` | `=false` excludes archived |

What works: group/category CRUD with audit, per-household duplicate-name 409, archive/restore, reorder, and "delete" of a category in use is a non-destructive archive (transactions keep their category; nothing silently re-categorised or lost).

## 6. Cross-cutting observations (outside strict scope, noted once)

| ID | Observation | Evidence | Sev |
|---|---|---|---|
| X-01 | Imported transactions are stored with `currency = NULL` (import passes no currency; receipt path likewise), so any per-currency logic must fall back to the account currency | dry-run payload for Cafe B shows `"currency":null`; DB rows | P3 |
| X-02 | `POST /api/accounts` writes two `account CREATE` audit rows per account | audit rows for `e5be69e2-...` (two CREATE with different payloads) | P3 |
| X-03 | Timestamps written from JS `new Date()` (e.g. `deleted_at`, account `updatedAt`) are 2 h behind `defaultNow()` columns on this Lusaka-time server (e.g. account `createdAt 22:58Z`, `updatedAt 21:00Z`; transaction `created_at 21:00:09`, `deleted_at 19:00:09`) - suggests `timestamp without time zone` mixed with session-TZ defaults | DB read-back | P2 (ordering/audit-time integrity; belongs to the schema/infra verifier) |

## 7. Not exercised / limits

- Server log not readable: root causes for the 500s were proven with a non-executing `EXPLAIN` (tag merge) and source reading, not log lines.
- Member/view_only role gating on import/receipts/rules/tags: only one fixture user (owner) was used; role gates verified at SRC only (`requireRole("member")` on all mutations; import route checks `view_only` explicitly).
- `POST /api/receipts/:id/retry-match`, receipt line-item split, rule `split_transaction`/`link_goal` actions, merchant `seed`/`autocomplete`, tag `analytics`/`suggest`, category `seed` (admin) were not exercised.
- Account-level balance-history import (`server/modules/accounts/accounts.import.controller.ts`) is a separate path and was not exercised.
- 10 MB / 5000-row limits and CSV with unbalanced quotes not exercised (time).

## 8. Severity roll-up

| Sev | IDs |
|---|---|
| P0 | IMP-01 (overwrite re-import silently deletes ledger rows; -817.50 on the repro account, -2000 salary on the earlier one) |
| P1 | IMP-02 (same-day same-amount rows dropped), IMP-03 (2026-02-30 -> 2026-03-02, widens destructive window), RCP-01 (create-transaction double-charges on retry / re-links matched receipt), RCP-02 (negative receipt expense credits the account), RUL-01 (`/rules/:id/test` 404), ORG-01 (tag merge always 500), ORG-02 (6 merchant detail endpoints 404) |
| P2 | IMP-04, IMP-05, IMP-06, RUL-02, RUL-03, RUL-04, X-03 |
| P3 | IMP-07, RCP-03, RUL-05, RUL-06, ORG-03, ORG-04, CAT-01, CAT-02, X-01, X-02 |

Fixture state left behind (audit DB only): household 6cfe9c37 has accounts `A2 Checking` (975.00) and `A2 Import Repro` (225.45), 2 rules, tags Coffee/coffee/Snacks(archived)/EmptyTag, merchant "Cafe B.", category group "Audit Group" (archived) with 2 categories, 4 receipts (3 matched, 1 unmatched `87eee321-...`). Files under `uploads/receipts/6cfe9c37-.../`.
