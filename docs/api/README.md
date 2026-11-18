# API Notes

## Base URL

- Local dev: http://localhost:5000

## Auth

- Session-based auth
- CSRF token required for state-changing requests (except `/api/auth/logout`)
- Use /api/csrf-token to fetch token

## Versioning

- API is mounted under `/api`
- If versioning is introduced, use `/api/v1` and update `docs\api\openapi.yaml`

## Pagination

- Uses standard limit/offset patterns where applicable
- Typical query params: `limit`, `offset`

## Error Format

- JSON: { success: false, error: { code, message } }

## OpenAPI

See `docs\api\openapi.yaml` for the full API contract.

## Error Codes

See `docs\api\error-codes.md` for the error code reference.

## Example Requests

### Fetch CSRF Token

```http
GET /api/csrf-token
```

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "YourPassword1!"
}
```

### List Transactions

```http
GET /api/transactions?limit=25&offset=0
```

### Create Transaction

```http
POST /api/transactions
Content-Type: application/json
X-CSRF-Token: <token>

{
  "accountId": "acc_123",
  "amount": 125.50,
  "currency": "ZMW",
  "merchantId": "mer_456",
  "date": "2026-01-12",
  "type": "expense"
}
```

