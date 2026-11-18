# Merchant Updates - 2025-12-23

## Summary

- Added advanced duplicate detection with similarity scoring and merge preview UX.
- Expanded merchant analytics with quick ranges and category breakdowns.
- Improved merchant reports filtering and added a top merchants dashboard widget.
- Aligned client rule schemas with server rule action/condition types.
- Added smart merchant cleanup + auto-recognition for imports and transaction updates.

## Files Changed

- `server/routes/merchants.ts`
- `server/validation/reports.ts`
- `server/repositories/ReportRepository.ts`
- `client/src/hooks/use-reports.ts`
- `client/src/components/merchants/MerchantDetailView.tsx`
- `client/src/pages/settings/sections/MerchantsSection/index.tsx`
- `client/src/features/settings/schemas/ruleSchema.ts`
- `client/src/features/settings/schemas/__tests__/ruleSchema.test.ts`
- `client/src/components/dashboard/TopMerchantsWidget.tsx`
- `client/src/pages/Dashboard.tsx`
- `client/src/pages/Reports.tsx`
- `server/services/merchantRecognition.ts`
- `server/repositories/MerchantRepository.ts`
- `server/services/TransactionService.ts`
- `server/services/ReceiptService.ts`
- `server/services/__tests__/transactionService.test.ts`
- `README.md`

## Behavior Changes

- Duplicate merchants now show similarity scores and groupings based on name distance.
- Merchant detail view includes quick spend ranges and category breakdowns.
- Merchant report tab supports text filtering and recalculates totals for filtered rows.
- Top merchants widget displays current month leaders on the dashboard.
- Rule validation supports merchant actions/conditions consistent with server APIs.
- Transaction and receipt imports now clean merchant names and auto-match to existing merchants.

## Tests

- Not run.

## Assumptions / Notes

- Similarity threshold is tuned for name-only detection and can be adjusted.
- Category breakdown uses spending report data filtered by merchant.

## Update - Phase 4/5/6 Follow-up

### Summary

- Added transaction filters (category + min/max) to merchant detail and included category in CSV export.
- Expanded merchant reports with max spend, merchant category filter, custom range, and spend trend chart.
- Added bulk merge selection and enhanced merge preview with name/logo picking.

### Files Changed (Follow-up)

- `client/src/components/merchants/MerchantDetailView.tsx`
- `client/src/hooks/use-settings.ts`
- `client/src/pages/Reports.tsx`
- `server/routes/merchants.ts`
- `README.md`

### Behavior Changes (Follow-up)

- Merchant detail filters now scope the recent transactions list and export.
- Merchant reports support custom date ranges and category filtering with a trend line.
- Bulk merge flows open the preview dialog with target selection, and the preview lets you pick which name/logo to keep.

## Documentation Update

### Summary

- Added a workflow audit and a Monarch-style help center guide.

### Files Changed

- `docs/workflow-audit.md`
- `docs/help-center.md`
- `docs/README.md`
