# Budget clear: atomic audit and proxy-safe provenance

The bounded NEW-32 budget-clear repair is prepared for canonical local integration from `4909526dc0cb1446046bf645a4974b2e1339936a`. Product `437bdf64c0e390fafb227f11abde1bafa9f0fd7c` and test-type descendant `966fb12735246943c709e16689db64d30f29418c` have independent source clearance. Final evidence/document review and the actual fast-forward must be verified separately. Full NEW-32, R08 and all101 master closure groups remain OPEN.

## Behavior

The signed clear controller supplies the actual actor, household and validated Express-resolved IP to the service. One transaction deletes only that household's non-flex budgets and writes one mandatory budget DELETE audit with a valid batch UUID, sorted actual deleted IDs and count. No-op clear returns zero without another audit. Audit failure rolls back deleted budgets and cascaded periods. Shared audit-service behavior, role gates, confirmation validation, response shape and flex/foreign-household exclusions are unchanged. IP validation follows the existing account-create path; it does not redefine deployment proxy trust.

## Sources and evidence

All paths below are under `C:/Users/USER/.codex/worktrees/`; these budget worktrees have no additional personal-finance-app child directory. Receipt paths are relative to the named checkout. All database targets use the previously approved marked owned PostgreSQL18.6 at127.0.0.1:55432,29 migrations and READ COMMITTED. Every listed DB PRE/POST has zero6 primary,9 scope and5 budget/fault counters, including other clients.

| Packet | Checkout / exact pin | Result and limits | Receipt manifest SHA256 |
|---|---|---|---|
| 47b | capital-r08-budget-clear-diagnostic-revised-nov10 / 2fc93f3b593f28d0651729901818546d04dc90ea | RED:1pass2fail; missing audit and successful deletion despite audit failure. Injected deferred fault unreached. OID1946991. | 849EAF1A63F1E660D649266E034340B562B1C219DB5B2A616289472774F3E176 |
| 47c | capital-r08-budget-clear-fix-nov10 / 027fd16881d935ee1d6ea8dd1183ee9ddb8a1ea3 | Four signed cases pass, including fault witness/rollback and repeat no-op. Subsequently held for proxy-header source finding. OID1950094. | 97B36CB60E224B80B1F8A4DF53DF8F470B4DF8B6BE65A9617994D2BC927A64EA |
| 47d | capital-r08-budget-clear-ip-red-nov10 / 0eff0a95af44edfe49bdd7d01885ac16019f9bd6 | RED:4pass2fail. Both multi-hop and malformed XFF cases receive500 instead of200; later persistence assertions in those two cases unreached. OID1953198. | 89D30FF580D46FC5D35F8C0DE457C6CFCC3DFAB3DF1E2B0D065AC0E2BC94EF57 |
| 47e | capital-r08-budget-clear-ip-fix-nov10 / 437bdf64c0e390fafb227f11abde1bafa9f0fd7c | Six signed cases pass: actual deletion/retained rows, one actor audit, no-op, both supplied IP headers, deferred fault witnessTRUE/500/full rollback and read-only403. OID1956299. | F35C8F993F6FFA91B6059B7C86ED6CC651049A30CDA1E543E0216DDBD4FF9FE7 |
| 47f | Same437 checkout | Two unchanged mocked settings-route caller cases pass; not signed clear coverage. | FEB7FC973C5A2260E0F0FE743D65B46C69474B70B6C6A7A3C768A25F8557D8BF |
| 47g | Same437 checkout | Preserved project failure: runtime passed, compiler reported four TS2345 fixture-array errors; later seven steps unrun. | C045D3AFADAFB31D80FDB06EBF6C5B7E09895CC9330B3CEF4B3F48A9B2D90158 |
| 47h | capital-r08-budget-clear-types-nov10 / 966fb12735246943c709e16689db64d30f29418c | All nine project checks pass with a fresh compiler cache. Sole delta from437 is retainedIds:string[] in the test fixture. | F58F38AEE9935D257BAE6F5E956373090F202A781C3462A6741AB1DFB1FEDE71 |

Raw directories are respectively `.local/astra-r08-budget-clear-red47b`, `astra-r08-budget-clear-green47c`, `astra-r08-budget-clear-ip-red47d`, `astra-r08-budget-clear-ip-green47e`, `astra-r08-budget-clear-callers47f`, `astra-r08-budget-clear-project47g` and `astra-r08-budget-clear-project47h` (all under `.local`). DB packets each seal20 artifacts;47f seals4,47g4 and47h11. Root verified every hash. Independent Astra accepted47b/c/d/e/f within the stated bounds and verified47g failure; final47h adjudication is required before integration.

Independent TypeScript and Astra review verified that966 changes only a TypeScript array annotation: generated IDs, fixture assertions and product source are unchanged from437. Thus47e/f are source-equivalent historical437 runtime evidence, not tests executed at966 or at a later documentation commit. No unchanged DB rerun is necessary. No new browser/build, staging or production evidence is claimed.

Preserve original held/unexecuted47a, every RED and failed receipt, all synthetic targets and original source pins. R08 retains other writer-audit work, including the reproduced recurring transaction audit/outbox gap; this bounded repair does not authorize the NEW-10 client route switch. No push, PR, main merge, shared/production DB change, real delivery, paid provider, deployment or release occurred or is authorized by this record.
