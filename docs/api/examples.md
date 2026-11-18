# API Examples

## CSRF Token Response

```json
{
  "success": true,
  "data": {
    "csrfToken": "token"
  }
}
```

## Create Account (POST /api/accounts)

Request:

```json
{
  "name": "Main Checking",
  "type": "checking",
  "currency": "USD",
  "openingBalance": "1500.00",
  "institution": "Example Bank"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "2a1f2c68-8f1c-4f6b-9c34-8c8a734edc33",
    "name": "Main Checking",
    "type": "checking",
    "currency": "USD",
    "balance": "1500.00",
    "institution": "Example Bank",
    "isArchived": false,
    "createdAt": "2026-02-01T12:00:00.000Z"
  }
}
```

## List Transactions (GET /api/transactions?limit=25&offset=0)

```json
{
  "success": true,
  "data": [
    {
      "id": "9b6a5f1c-8ce9-4b9f-84f8-5d4b0a1f1a55",
      "accountId": "2a1f2c68-8f1c-4f6b-9c34-8c8a734edc33",
      "amount": "-42.15",
      "currency": "USD",
      "date": "2026-02-01",
      "categoryId": "7f7b6c5a-6ad0-4a1a-9ce0-3e1c2c6d1b20",
      "merchantId": "b4d1c2e3-48aa-4b1c-9fd1-9e2a1d6b3a42",
      "notes": "Groceries"
    }
  ],
  "pagination": {
    "limit": 25,
    "offset": 0,
    "total": 120,
    "page": 1,
    "pageSize": 25,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## Validation Error (400)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "amount must be a valid decimal string",
    "details": {
      "field": "amount"
    }
  }
}
```

## Rate Limit (429)

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests"
  }
}
```

## CSRF Flow (Client)

1. Call `GET /api/csrf-token`
2. Read CSRF token from response
3. Send `X-CSRF-Token` on POST/PUT/PATCH/DELETE
4. Refresh token after login or when the session changes
