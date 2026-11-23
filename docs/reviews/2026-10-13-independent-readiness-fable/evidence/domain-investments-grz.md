# Domain evidence: Investments + GRZ securities (verifier `investments-grz`)

Revision: main @ 381e943. Audit DB `finance_app_audit_fable_20261013`, server http://localhost:5055, fixture jar `a3` (household "A3 Investments Household", id e5718f9c-…). Server TZ Africa/Lusaka (UTC+2); DB session TZ Africa/Johannesburg.
Fresh fixtures created by this run (prefix `F2`): cash account `F2 Cash ZMW` a06976a0-0696-4836-8617-44b07a494882 (initial 100000.00 ZMW), `F2 Brokerage` 057c8cd2-0778-4224-bb5d-a119c916ade8. Data left by the earlier cut-off attempt (prefix `A3`) is cited only where noted.
Helper used for every command below: `A(){ MSYS_NO_PATHCONV=1 node .local/readiness-fable-2026-10-13/api.mjs a3 "$@"; }` and `Q(){ node .local/readiness-fable-2026-10-13/q.mjs finance_app_audit_fable_20261013 "$1"; }`.
All expected numbers are hand-computed (shown inline), never produced by calling the production function.

**Verdict: NOT production-ready.** The arithmetic engines are right to the cent (bond schedule, coupon WHT, T-bill maturity, all four calculators, FIFO lots). The ledger and reporting wiring around them is wrong: 2 × P0 (GRZ principal booked as income; payments still accepted after a bond is sold) and 13 × P1 (input validation, cost basis, tax-lot gaps, FX/ZMW, tax-report coverage and year boundary, pension, stranded SIPs, global price/FX writes). Findings table is §8.

## 1. GRZ bonds

### 1.1 Schedule generation — WORKS (impl PRESENT, verified HTTP+DB)
`POST /api/grz/bonds` {faceValue 250000.00, couponRate 0.1325, couponFrequency 2, purchaseDate 2026-04-10, maturityDate 2029-04-10, accountId F2 Cash} → 201, bond c80c548f-7ae0-42d3-8d44-4dd4791aedbf.
Hand: annual coupon 250000 × 0.1325 = 33125.00; per period /2 = **16562.50**; WHT 15% = 2484.375 → **2484.38** (half-up); net = 16562.50 − 2484.38 = **14078.12**. Coupon dates anchored to purchase date + 6 m: 2026-10-10, 2027-04-10, 2027-10-10, 2028-04-10, 2028-10-10, 2029-04-10 = **6 coupons** + principal 250000.00 (WHT 0).
DB read-back (`grz_bond_payments`): exactly 6 coupon rows 16562.50 / 2484.38 / 14078.12 on those dates + 1 principal 250000.00/0.00/250000.00. **Matches to the cent.** Audit row `CREATE grz_bond` with user id and `scheduledPayments: 7` written in the same txn.
**WHT rate applied: 15% flat (`WHT_RATE_FRACTION = 0.15`, server/services/grz-service.ts:14; T-bill maturity uses the same 15% at server/services/investment/processTBillMaturities.ts:13).** The code applies one rate to all GRZ coupon and discount income regardless of tenor or holder type. FLAG FOR A QUALIFIED OWNER: confirm the current ZRA WHT rate(s) on GRZ bond coupons and T-bill discount (rates have differed by instrument/tenor/holder in Zambian practice); this verifier does not adjudicate tax law.

### 1.2 Purchase does NOT mutate cash — CONFIRMED (documented product decision)
After the bond POST, `F2 Cash ZMW` balance stayed **100000.00**; zero rows in `transactions` and zero rows in `investment_transactions` for the purchase. What is posted on purchase: one `grz_bonds` row, 7 `grz_bond_payments` rows, one `audit_logs` CREATE row. Nothing reaches the ledger. (This is the stated "holdings-only creation" decision; its consequence is GRZ-01 below.)

### 1.3 Coupon pay — ledger write WORKS, idempotency WORKS
`POST /api/grz/payments/88b0391c-…/pay {"accountId":F2 Cash,"date":"2026-10-10"}` → 200, payment status `paid`, `incomeTransactionId` 18730931-…. Ledger row: `transactions` amount **14078.12** (= net, matches hand), type income, account F2 Cash, date 2026-10-10, idempotency_key = uuidv5(payment id), notes "Gross: 16562.50, WHT: 2484.38". Balance 100000.00 → **114078.12** (+14078.12 exactly). Audit: `CREATE transaction` (user id, amount 14078.12) **and** `PROCESS grz_bond_payment` (gross/WHT/net/income tx id). Second identical call → **409 CONFLICT "Payment is already marked as paid"**, no second ledger row (count stayed 1).
Minor: ledger `name` is stored as "GRZ Coupon F2 GRZ 3Y" (colon and "13.25" stripped by name sanitisation; the `notes` keep the full name) — P3 cosmetic. `category_id` is null (comment at grz-securities.ts:490 admits no "Interest Income" category) — P3.

### 1.4 Sell — state change WORKS, money effects MISSING
`PUT /api/grz/bonds/c80c548f-…/sell {"soldDate":"2026-10-14","soldPrice":"251000.00","soldYield":"0.13"}` → 200; bond `status=sold`, sold_price 251000.00, sold_yield 0.1300; one `investment_transactions` row type `sell`, amount 251000.00, **security_id NULL, holding_id NULL, quantity NULL**; audit `UPDATE grz_bond` with `investmentTransactionId`. Second sell → 409 "Bond is already sold" (FOR UPDATE guard works).
Gain/loss: hand = 251000.00 − 247500.00 = **+3500.00** (ignoring accrued interest). The code computes **no gain/loss anywhere** (no field, no tax-lot disposal, not in tax summary). Cash: balance unchanged (114078.12 before and after) — sale proceeds are never credited to any ledger account. Remaining 5 scheduled payments stay `scheduled` (not cancelled). See GRZ-02/GRZ-03.

## 2. T-bills (create, yield, maturity cron)

| Check | Hand value | Observed | Verdict |
|---|---|---|---|
| `POST /api/grz/tbills` face 50000.00, price 48000.00, tenor 182, purchase 2026-04-14, maturity 2026-10-13 (id 37b436ff-…) | discount 2000.00; yield (365 basis) = 2000/48000 × 365/182 = 0.083562 → 4dp 0.0836 | discount_amount 2000.00, purchase_yield 0.0836 | WORKS |
| Cash on purchase | unchanged | F2 Cash unchanged (364078.12 before and after) | holdings-only, as documented |
| `POST /api/cron/investment-automation` (maturity) | interest 2000; WHT 15% = 300.00; net interest 1700.00; net proceeds 50000 − 300 = 49700.00 | bill `matured`, matured_date 2026-10-13; `investment_transactions` type maturity amount 49700.00, WHT 300.00; ledger `transactions` income **1700.00**, idempotency key uuidv5(bill); balance +1700.00 exactly; audit rows written in-txn (SRC processTBillMaturities.ts:124-189) | WORKS |
| Re-run cron | no second payout | `matured:0`, no new ledger row | idempotent |
| Rollover | n/a | Only via a recurring plan whose security type is `tbill` (processDueInvestments.ts:148); not exercised end-to-end. Source: face value uses the latest auction yield and **silently falls back to a hard-coded 15% yield** when no auction row exists (processDueInvestments.ts:163-171) | SRC only |
| Tenor vs maturity consistency | reject 91-day bill maturing 2030 | `POST /tbills` tenor 91, maturity 2030-01-01 → **201** (3cc5a16b-…) | GRZ-09 |
| Missing tenorDays | 400 | 400 VALIDATION_ERROR "tenorDays Required" | WORKS |

Ledger posture on maturity: only the **net interest** is credited (principal not credited, consistent with purchase never debiting). Coherent for T-bills; contrast bond principal (GRZ-01).

## 3. GRZ calculators (`/api/investments/grz/calculate/*`) — all WORK

Independent formulas in `.local/readiness-fable-2026-10-13/scratch-investments-grz/hand.mjs`.

| Endpoint / input | Formula and day count | Hand | API |
|---|---|---|---|
| bond-price F=100000, c=14%, 5y, y=16%, f=2 | PV = C·(1−(1+y/f)^−n)/(y/f) + F·(1+y/f)^−n, n=10 | clean 93289.92, current yield 0.150070 | 93289.92 / 0.15007 |
| ytm, same bond at 93289.92 | bisection on the same price function | 0.160000 | 0.16 |
| accrued 2026-07-15 → 2026-10-14, ACT/365 (default) | F·c·days/365, days = 91 | 3490.41 | 91 days, 3490.41 |
| accrued, same dates, 30/360 | 30/360 US: 360Δy+30Δm+Δd = 89 | 3461.11 | 89, 3461.11 |
| tbill-yield F=100000, d=12%, 91d | price = F(1−d·t/360); eff = gross/price·360/t; net = 0.85·gross/price·360/t | 96966.67 / 3033.33 / 0.123754 / 0.105191 | identical |
| tbill-yield discountRate=12 (percent form) | normalised (>1 means percent) | same | same |

GRZ-08 (P2): the **calculator** annualises T-bill yield on a **360**-day basis (grz-service.ts:351) while the **persisted** T-bill `purchase_yield` uses **365** (grz-service.ts:111). Same bill 50000/48000/182: 365-basis 0.083562 (stored) vs 360-basis 0.082418. Owner to confirm which basis BoZ quotes.

## 4. Equities, FX, tax lots, portfolio

Fixtures: securities `F2ZCCM` (ZMW, price 25.00) 7ee4b9ca-…, `F2AAPL` (USD, price 200.00) 9811cf95-…; holding HZ 87baceb5-… (opened at qty 0, cost 0), holding HU 979a5c35-… (opened at qty 10, cost 2000.00 USD / 52000.00 ZMW, acquisition FX 26.00).

| Step | Hand | Observed (DB) | Verdict |
|---|---|---|---|
| buy 100 @ 20.00, amount 2005.00, `fees` 5.00 | lot qty 100 cost 2005.00; fee recorded | tax lot 100 / 2005.00; **`fees` stored 0.00** (field not in the Zod schema, silently dropped) | lot OK, fee lost (INV-05) |
| buy 50 @ 22.00, amount 1100.00 | holding qty 150, **cost basis 3105.00** | holdings.quantity 150 ✓, **holdings.cost_basis 0.00** ✗ | INV-01 |
| sell 120 @ 30.00, amount 3600.00 (FIFO) | lot1 100: proceeds 3000, cost 2005, gain 995.00; lot2 20: proceeds 600, cost 1100×20/50 = 440.00, gain 160.00 | disposals 3000/2005/995.00 and 600/440/160.00; lot remainings 0 and 30; holding qty 30 | WORKS |
| oversell 31 (30 left) | reject | 409 "Insufficient shares to sell. Available: 30.00, Requested: 31.00" | WORKS |
| sell **−10** @ 30, amount −300 | reject | **201**; holding qty 30 → **40**; disposal qty −10, gain **−80.00** (flows into tax summary) | INV-02 |
| sell 5 of HU (holding opened with qty 10 via `POST /holdings`) | allowed (10 held) | **409 "Insufficient tax lot quantity. Available: 0.00000000"** | INV-03 |
| `POST /api/investments/fx-rates` USD→ZMW 26.5000 (2026-10-13), then USD buy 4 @ 205 with no amountZmw | amount_zmw 820×26.5 = 21730.00 | 201; buy `amount_zmw` **NULL**, `fx_rate` NULL; lot cost_basis_zmw NULL | INV-04 |
| USD sell 4 @ 250 = 1000 USD | gain 180 USD = **4770.00 ZMW** at 26.5 | disposal realized_gain 180.00, realized_gain_zmw NULL; tax summary adds **180.00 as ZMW** | INV-04 |
| `GET /holdings?accountId=F2 Brokerage` | F2AAPL 10×200×26.5 = 53000 vs cost 52000 → +1000; F2ZCCM 30 legit shares, remaining-lot cost 30×22 = 660, value 750, gain +90 | F2AAPL cv 53000 cb 52000 gl 1000 ✓ (coincidental: the bought lot was fully sold); **F2ZCCM cv 1000 cb 0 gl 1000** ✗ (stale cost basis plus 10 phantom shares from INV-02) | INV-01 |
| `GET /portfolio/summary` | n/a | 200; totals returned as JS numbers (55500, 53000, …) not MoneyDto strings; T-bills valued at face (12000) | P3 |
| `GET /performance?timeframe=1M` | n/a | `[]` (no snapshots in this DB) | NOT EXERCISABLE |
| Cash effect of buys/sells | product decision: none | F2 Brokerage balance unchanged by all buys/sells | consistent with holdings-only design |

INV-06 (tenancy, SRC + schema): `securities` and `fx_rates` have **no household_id**; any household `member` can `POST /securities`, `PUT /securities/:id/price` and `POST /fx-rates`, and the latest price/rate is read by every household's valuation (`getLatestFxRates`, PortfolioValuationService). One tenant can move another tenant's portfolio value and gains. Not probed cross-tenant here; the security agent should confirm.

## 5. Tax summary and ZRA export

`GET /api/investments/tax/summary?year=2026` → realizedGains 1285.00 (reconciled row by row: 30.00 [earlier attempt] + 995 + 160 − 80 + 180 USD-as-ZMW), interestIncome **0.00**, totalWht **525.00** (= T-bill maturity WHT 300 + 225), netIncome 760.00.
Hand view of 2026 GRZ income actually received in this household: F2 coupons paid 2026-10-10 and 2026-10-13 (gross 16562.50 each, WHT 2484.38 each), earlier A3 coupons, T-bill discount 2000 + 1500. **None of it appears as interest income**, yet T-bill WHT is subtracted, so net income is understated and WHT is incomplete (INV-07). Root cause: coupons are written only to `transactions` (grz-securities.ts:482) and T-bill maturities as type `maturity`, while the tax service reads `investment_transactions` of type interest/dividend/coupon only (InvestmentTaxService.ts:104-108, 193-197).
`GET /tax/zra-export?year=2026&format=json` → **`[]`**: the ZRA WHT export has zero rows although GRZ coupon WHT (≥ 4968.76 for F2 alone) and T-bill WHT 525.00 were withheld in 2026 (INV-07). Audit row `PROCESS data_export {exportType: investment_tax_zra, recordCount: 0}` IS written (WORKS).
INV-08 tax-year boundary: a dividend dated **2025-12-31** (123.45) appears in **both** the `year=2025` and `year=2026` summaries and in the **2026** ZRA export. Cause: `startOfYear(new Date(year,0,1)).toISOString()` on a UTC+2 server yields "2025-12-31" (InvestmentTaxService.ts:49-54, 158-163).

## 6. Pension and recurring investments

| Check | Observed | Verdict |
|---|---|---|
| `POST /api/investments/pension` F2 NAPSA, balance 10000.00 (id 8cbf3269-…) | 200 | WORKS |
| contribution employee 500 + employer 500, **total 5000** | 200; balance 10000 → 15000 (mismatched total accepted) | PEN-01 |
| contribution total **−500.00** | 200; balance → **14500.00** | PEN-01 |
| audit rows for pension holding and contributions | **0 rows** | PEN-02 |
| atomicity | insert + balance update are separate statements, no txn, no lock (PensionService.ts:82-95): lost-update race on concurrent contributions | PEN-02 (SRC) |
| SIP plan due today (server UTC date 2026-10-13), 1000.00 into F2ZCCM @ 25.00 | cron → executions success 1; buy qty **40** (= 1000/25 ✓) price 25, linked to holding; next_execution_date 2026-11-13 ✓; execution log success | WORKS |
| re-run cron | success 0, skipped 0, no double buy | idempotent |
| SIP side effects | holding cost_basis 0 → 1000.00 (SIP path updates cost; manual buy path does not, INV-01); **no tax lot** created, so SIP shares cannot be sold past lot quantity (INV-03); **0 audit rows** for the SIP buy and for plan create (INV-09) | PARTIAL |
| plan with past nextExecutionDate 2026-10-01 | not executed, not advanced, not logged: `getDuePlans` matches `= today` only (processDueInvestments.ts:36), so one missed cron day strands a plan forever | INV-10 |
| "today" basis | cron uses the UTC date (`toISOString`), so between 00:00 and 02:00 Lusaka a plan dated "today" is not yet due | P3 |

## 7. Precision sweep

Grep over grz-service, grz routes, services/investment, modules/investments, investment-* routes and the Pension/Tax/Automation/PortfolioValuation services: money arithmetic is Decimal/Money throughout. Residual float uses: `String(1 + (rate*tenor)/36500)` (processDueInvestments.ts:172), `quantityMoney.toNumber()` (:247), `Number(holding.acquisitionFxRate)` (PortfolioValuationService.ts:85), `parseFloat` in a positivity refine (investment-recurring.ts:33), API outputs via `.toNumber()` (PortfolioValuationService.ts:102-188).
**No concrete wrong-cent input found:** an exhaustive scan of the rollover formula (amounts 123456.78 to 5,000,000.00 × yields 10.0–30.0% step 0.1 × tenors 91/182/273/364) produced **0** cent differences between the float multiplier and exact Decimal. These are Rule 1 style violations, not live cent errors.
Real precision defect instead: **`Money.isPositive()` returns true for zero** (decimal.js semantics; money.ts:154). Proven: `new Decimal(0).isPositive() === true`. Live consequence (GRZ-06): a T-bill whose purchase price ≥ face (net interest 0) makes the maturity cron insert a 0.00 income row, violating `chk_transaction_amount_nonzero`; bill 94af1d3b-… (face 1000, price 1100, created by the earlier attempt) **fails on every cron run** and stays `active`, and the cron HTTP response echoes the full SQL with household/account ids. Same guard misuse at processDueInvestments.ts:241 (price 0 would pass, then divide by zero).
GRZ-07 rate/schedule mismatch: the schedule is computed from the **unrounded request rate** while `coupon_rate` is stored at 4 dp. Earlier-attempt bond "A3 GRZ 5dp rate": stored 0.1235 implies coupon 100000×0.1235/2 = 6175.00, but schedule rows are **6172.50** (from 0.12345).

## 8. Findings

Impl = PRESENT/PARTIAL/MISSING; Verif = SRC/TEST/HTTP/DB. Repro uses the helpers in the header; ids are from this run.

| ID | Surface | Expected (source) | Observed | Impact | Repro | Sev | Conf | Impl / Verif | Action | Acceptance test |
|---|---|---|---|---|---|---|---|---|---|---|
| GRZ-01 | `POST /grz/payments/:id/pay` on a **principal** row | Principal repayment is return of capital, not income; purchase never debited cash (holdings-only decision), so crediting face value creates money | Principal 783971ea-… paid → ledger `transactions` **income 250000.00**, F2 Cash +250000 (balance 114078.12 → 364078.12 incl. one coupon). Earlier attempt shows the same (100000.00 income) | Income reports, cash balance and net worth inflated by the full face value; it is also treated as taxable-looking income | `A POST /api/grz/payments/<principalId>/pay '{"accountId":"<cash>","date":"2029-04-10"}'`; `Q "select amount,type from transactions where name like 'GRZ Coupon%' and amount='250000.00'"` | **P0** | High | PRESENT-wrong / HTTP+DB | Book principal as a transfer/asset conversion (or reject principal pay while purchase is holdings-only); product + accounting decision needed | Paying a principal row changes cash by 0 net of the purchase leg and creates no `income` row |
| GRZ-02 | pay after sell | A sold bond's remaining coupons/principal must be cancelled or unpayable (grz-securities.ts sell path) | After `PUT /bonds/:id/sell` (status sold), coupon 2027-04-10 → 200, income **14078.12**; principal → 200, income **250000.00**; 4 rows still `scheduled` | Income booked for a bond no longer held; double counts with sale proceeds | sell, then `A POST /api/grz/payments/0a00426d-…/pay '{"accountId":"<brokerage>"}'` | **P0** | High | MISSING guard / HTTP+DB | On sell, mark unpaid rows `cancelled`; pay must 409 when bond.status ≠ active | pay after sell → 409, zero new `transactions` rows |
| GRZ-03 | `PUT /bonds/:id/sell` money effects | Sale proceeds and realised gain/loss recorded (Rule 1/9) | Only an `investment_transactions` sell row (251000.00, security/holding/quantity NULL); **no gain/loss** (hand +3500.00), no ledger credit, not in tax summary | GRZ disposals invisible to gains reporting; sale proceeds never reach cash | sell as in §1.4; `Q "select * from tax_lot_disposals where transaction_id='7740bd68-…'"` → 0 rows | P1 | High | MISSING / HTTP+DB | Compute gain (soldPrice − purchasePrice, accrued handled) and surface it; decide cash posting consistently with purchase | gain row 3500.00 for the fixture; tax summary includes it |
| GRZ-04 | pay before due date / any account | Coupon payable on/after its date to the bond's account | 2027-04-10 coupon paid on 2026-10-13 into **F2 Brokerage** (not the bond's account); future-dated principal (2029) posted | Early/future-dated income; wrong-account postings | as GRZ-02 | P2 | High | MISSING / HTTP+DB | Validate date ≥ payment_date (or explicit override) and default to bond.accountId | early pay → 400 |
| GRZ-05 | `POST /grz/bonds` validation | Positive face, rate in (0,1), maturity > purchase (raw `createInsertSchema`, grz-securities.ts:83) | couponRate "14" → **201**, coupons **70000.00** on face 10000 (and 700000.00 on 100000 from earlier attempt); faceValue **−10000.00** with maturity before purchase → **201** | One pay click posts 595000.00 phantom income (P0 path via GRZ-01 route) | `A POST /api/grz/bonds '{"bondName":"x","tenorYears":2,"faceValue":"10000.00","purchasePrice":"10000.00","purchaseDate":"2026-04-10","couponRate":"14","maturityDate":"2028-04-10"}'` | P1 | High | MISSING / HTTP+DB | Zod: face>0, 0<rate<1 (or normalise like calculators), maturity>purchase, tenor consistent | each bad body → 400 |
| GRZ-06 | maturity cron, `Money.isPositive()` | zero net interest → skip ledger insert | Bill 94af1d3b-… fails **every** cron run (insert 0.00 violates `chk_transaction_amount_nonzero`), stays active; cron body leaks SQL + ids | A par/premium bill never matures; noisy permanent failure | `A POST /api/cron/investment-automation` → `maturities.failed:1` | P1 | High | PRESENT-wrong / HTTP+DB | Use `gt(0)` semantics (fix Money.isPositive or add isStrictlyPositive); reject price ≥ face at create; don't echo SQL | par bill matures with no income row |
| GRZ-07 | schedule vs stored rate | Schedule derived from the persisted rate | stored 0.1235, coupons 6172.50 (from 0.12345) | Schedule disagrees with displayed rate | earlier-attempt bond cc8e50e6-… | P2 | High | PRESENT-wrong / DB | Round rate to 4 dp before scheduling (or widen column) | stored rate × face / f = row gross |
| GRZ-08 | yield day count | One basis per instrument | calculator 360, persisted 365 | Two yields for one bill | §3 | P2 | High | PRESENT / HTTP | Owner decides BoZ basis; use it in both | same bill → same yield both paths |
| GRZ-09 | `POST /grz/tbills` | maturity = purchase + tenor; price < face | tenor 91 maturity 2030 → 201; price 1100 > face 1000 accepted (earlier attempt) | Wrong maturity drives the cron | §2 | P2 | High | MISSING / HTTP | Derive or validate maturity; price < face | mismatch → 400 |
| INV-01 | manual buy/sell → `holdings.cost_basis` | Buy adds amount to cost basis; sell removes disposed cost | cost_basis **0.00** after buys totalling 3105.00 and after sells; SIP path does update cost (inconsistent) | Portfolio gain/loss wrong (F2ZCCM shows +1000 vs hand +90) | §4 rows 2 and 7 | P1 | High | PARTIAL / HTTP+DB | Maintain cost basis (and cost_basis_zmw) in the same txn as quantity, or derive from open tax lots | after fixture buys, cost_basis 3105.00; after FIFO sell, 660.00 |
| INV-02 | sell with negative quantity | quantity > 0 (`decimalSchema` accepts any string) | −10 sell → 201, holding +10, disposal gain −80.00 | Phantom shares; tax gains understated | §4 row 5 | P1 | High | MISSING / HTTP+DB | positive-decimal schema for quantity/price/amount | −10 → 400 |
| INV-03 | sell of holding opened via `POST /holdings` or SIP | Shares held can be sold | 409 "Insufficient tax lot quantity. Available: 0" (no opening lot; SIP creates no lot) | Users cannot record sales of positions added through the normal flow | §4 row 6 | P1 | High | PARTIAL / HTTP+DB | Create an opening tax lot on holding create and on SIP buy | sell 5 of HU → 201 with a disposal |
| INV-04 | FX on investment txns | `amount_zmw` derived from the posted rate; ZMW gains in ZMW | amount_zmw/fx_rate NULL; USD gain 180.00 reported as **180.00 ZMW** (hand 4770.00) | ZRA/tax figures wrong for offshore holdings | §4 rows 7–8; `A GET /api/investments/tax/summary?year=2026` | P1 | High | MISSING / HTTP+DB | Derive amountZmw from fx_rates on txn date, fail closed when missing; never fall back to non-ZMW gain | USD fixture gain_zmw 4770.00 |
| INV-05 | fees | Fees recorded and included in cost/proceeds | `fees` dropped (stored 0.00) | Fee data lost | §4 row 1 | P2 | High | MISSING / HTTP+DB | Add `fees` to schema and to cost/proceeds | fee 5.00 persisted |
| INV-06 | global securities / FX | Tenant writes cannot alter other tenants' valuations | no household_id on `securities`, `fx_rates`; member-writable | Cross-tenant valuation tampering | SRC/schema | P1 | Med | PRESENT-wrong / SRC | Restrict writes to admin/system or scope per household | other household's valuation unchanged |
| INV-07 | tax summary / ZRA export coverage | All GRZ coupon + T-bill interest and WHT included | interestIncome 0.00, ZRA export `[]`, WHT only from T-bill maturity rows | Regulatory output omits all GRZ income/WHT | §5 | P1 | High | PARTIAL / HTTP+DB | Source coupons (paid `grz_bond_payments`) and `maturity` rows into both | fixture: interest ≥ 33125.00 gross, WHT ≥ 4968.76 + 525.00 |
| INV-08 | tax-year window | Year = Jan 1–Dec 31 local | 2025-12-31 counted in 2025 and 2026 and in 2026 ZRA export | Double-reported income across years | §5 | P1 | High | PRESENT-wrong / HTTP | Build `${year}-01-01`/`${year}-12-31` strings directly | Dec-31 row only in its own year |
| INV-09 | SIP buy / plan create audit | Rule 9 audit on financial writes | 0 audit rows (only T-bill rollover branch audits) | DPA gap (not a ledger write) | §6 | P2 | High | MISSING / DB | Audit plan CRUD and SIP buys in-txn | audit row per execution |
| INV-10 | past-due SIP | Overdue plans run (or are logged) | 2026-10-01 plan never runs, never logged | Silent missed investments | §6 | P1 | High | PRESENT-wrong / HTTP+DB | `nextExecutionDate <= today` with catch-up policy | overdue plan executes once and advances |
| PEN-01 | pension contributions | total = employee + employer; > 0 | 500+500/total 5000 accepted; −500 accepted; balance 14500.00 | Pension balance corrupted | §6 | P1 | High | MISSING / HTTP+DB | Zod refine on totals, positivity | bad bodies → 400 |
| PEN-02 | pension audit/atomicity | Rule 9 audit; Rule 10 txn+lock | 0 audit rows; two un-transacted statements | DPA gap; lost updates | §6 | P2 | High | MISSING / DB+SRC | withTransaction + FOR UPDATE + audit | audit row; concurrent test sums correctly |

## 9. What works (verified)

Bond schedule to the cent (§1.1); coupon pay ledger write with correct net amount, two audit rows, and 409 on re-pay with no second ledger row (§1.3); sell FOR UPDATE double-sell guard (409); T-bill discount/yield persistence; T-bill maturity: correct 15% WHT, net interest ledger row, audit, idempotent re-run (§2); all four calculators exact to the stated formula/day count (§3); FIFO tax-lot disposal math and oversell 409 (§4); SIP execution quantity, next date, execution log, idempotent re-run (§6); ZRA export writes its `data_export` audit row (§5); bond create writes an in-txn audit row.

## 10. Not exercised

T-bill **rollover** end to end (needs a `tbill`-type security plan and auction data; SRC only). Portfolio **performance** (no snapshot data, returns `[]`). Concurrency races (pension lost-update and the SIP/maturity lock paths) — SRC review only, no parallel load fired. Cross-tenant write on global securities/FX (left to the security domain). Auction-results endpoints (`grz-auctions.ts`) beyond SRC: they are global market data with an audit row on create.
