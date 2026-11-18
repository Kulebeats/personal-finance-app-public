# Export Audit Logging Spec

## Purpose

Define a consistent audit trail for data exports (reports, CSV exports, downloads).

## Scope

- Report exports (CSV, PDF if added)
- Merchant analytics exports
- Transaction exports

## Event Schema

Log a structured event with the following fields:

- eventId (UUID)
- occurredAt (timestamp)
- userId
- householdId
- exportType (transactions, reports, merchants, budgets)
- format (csv, json)
- filters (JSON: date range, category, merchant, etc.)
- result (success, failure)
- errorCode (optional)
- requestId (trace id)
- ipAddress (optional)
- userAgent (optional)

## Storage Plan

Create a table `export_audit_logs`:

- id (uuid, pk)
- user_id (fk)
- household_id (fk)
- export_type (text)
- format (text)
- filters (jsonb)
- result (text)
- error_code (text, nullable)
- request_id (text)
- ip_address (text, nullable)
- user_agent (text, nullable)
- occurred_at (timestamp)

## API Integration Points

- Transactions export endpoint
- Reports export endpoint
- Merchant analytics export endpoint

Each export handler should:

1. Capture request metadata
2. Execute export
3. Write audit log with success/failure

## Retention

- Retain export audit logs for 1 year
- Align with data retention policy

## Security Notes

- Do not store exported data payloads
- Restrict access to audit logs
- Include audit logs in incident response scope

## Example Event

```json
{
  "eventId": "7ad49f62-4187-4fe3-9b2a-2a9d8dcf4b46",
  "occurredAt": "2026-01-12T10:22:00Z",
  "userId": "user_123",
  "householdId": "house_456",
  "exportType": "transactions",
  "format": "csv",
  "filters": {
    "dateStart": "2026-01-01",
    "dateEnd": "2026-01-12",
    "categoryId": "cat_789"
  },
  "result": "success",
  "requestId": "req_abc123"
}
```
