# GRZ policy defaults (pending OI-03)

**Status: policy default, pending OI-03.** OI-03 is the open item for the verified current GRZ tax, withholding, day-count, fee and reporting conventions. It is still with the owner. Until it closes, every convention below describes what the code does today. None of them is a statement of current Zambian tax law or Bank of Zambia market practice, and none may be promoted to a real-user default without OI-03 sign-off.

The server publishes these defaults in `server/services/grz/grzPolicyDefaults.ts`. They come back as `meta.policy` on `GET /api/grz/bonds` and `GET /api/grz/tbills`, with `status: "policy_default_pending_OI-03"`. The GRZ securities screen shows them under the label "Policy default, pending OI-03". The bond schedule labels its withholding column the same way.

| Convention | Value the code applies | Where it is applied |
| --- | --- | --- |
| Coupon withholding | 15% of each gross coupon | `generateBondSchedule` in `server/services/grz-service.ts` |
| T-bill discount withholding | 15% of the discount (face value less purchase price) | `calculateTBillResults` |
| Principal withholding | 0 | bond schedule (principal row) |
| Bond sale withholding | 0 (none applied) | `server/services/grz/bondSale.ts` |
| Recorded T-bill yield | discount / purchase price x 365 / tenor days (ACT/365) | `calculateTBillResults` |
| T-bill auction calculator | discount rate x tenor days / 360 (ACT/360) | `calculateTBillYield` |
| Accrued interest calculator | ACT/365 by default; ACT/360 and 30/360 can be chosen | `calculateAccruedInterest` |

The recorded T-bill yield (365) and the auction calculator (360) use different day bases. That inconsistency is deliberate here: it is the current behaviour, and OI-03 decides the real convention. Changing `grzPolicyDefaults.ts` changes only the label, not the arithmetic.

## Money in GRZ responses (NEW-35)

GRZ securities responses carry every amount as a MoneyDto, `{ "amount": "1000.00", "currency": "ZMW" }`, never a bare string or number:

- `GET` and `POST /api/grz/bonds`: `faceValue`, `purchasePrice`, `soldPrice`, `saleFees`, `saleCostBasis`, `saleRealizedGain` (the sale fields are `null` when unset or redacted).
- Each bond payment, and the payment returned by `POST /api/grz/payments/:id/pay`: `grossAmount`, `withholdingTax`, `netAmount`.
- `GET` and `POST /api/grz/tbills`: `faceValue`, `purchasePrice`, `discountAmount`.

Rates and yields (`couponRate`, `purchaseYield`, `soldYield`) are ratios, not money, and stay decimal strings. Request bodies are unchanged. The `/api/grz/calculators/*` endpoints still return plain numbers; moving them is a NEW-35 follow-up.
