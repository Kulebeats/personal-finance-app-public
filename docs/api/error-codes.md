# API Error Codes Reference

This document provides a comprehensive reference for all error codes returned by the API.

---

## Error Response Format

All errors follow this standard format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {} // Optional additional context
  }
}
```

---

## Error Codes by Category

### Authentication Errors (401)

| Code                       | HTTP Status | Description                       | Client Handling                  |
| -------------------------- | ----------- | --------------------------------- | -------------------------------- |
| `UNAUTHORIZED`             | 401         | Missing or invalid authentication | Redirect to login                |
| `AUTH_SESSION_EXPIRED`     | 401         | Session has expired               | Clear session, redirect to login |
| `AUTH_INVALID_CREDENTIALS` | 401         | Wrong email/password              | Show error, allow retry          |
| `AUTH_MFA_REQUIRED`        | 401         | MFA verification needed           | Show MFA input                   |

### Authorization Errors (403)

| Code                       | HTTP Status | Description              | Client Handling              |
| -------------------------- | ----------- | ------------------------ | ---------------------------- |
| `FORBIDDEN`                | 403         | Insufficient permissions | Show "access denied" message |
| `INSUFFICIENT_PERMISSIONS` | 403         | Role-based access denied | Show permission error        |

### Validation Errors (400)

| Code               | HTTP Status | Description                    | Client Handling          |
| ------------------ | ----------- | ------------------------------ | ------------------------ |
| `VALIDATION_ERROR` | 400         | Request data validation failed | Highlight invalid fields |
| `INVALID_INPUT`    | 400         | Generic input error            | Show error message       |

**Validation Error Response Example:**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "fields": [
      {
        "field": "amount",
        "message": "Amount must be positive",
        "code": "too_small"
      },
      { "field": "date", "message": "Required", "code": "invalid_type" }
    ]
  }
}
```

### Resource Errors (404, 409)

| Code             | HTTP Status | Description                   | Client Handling             |
| ---------------- | ----------- | ----------------------------- | --------------------------- |
| `NOT_FOUND`      | 404         | Resource does not exist       | Show "not found" page       |
| `CONFLICT`       | 409         | Resource conflict (duplicate) | Show conflict resolution UI |
| `ALREADY_EXISTS` | 409         | Entity already exists         | Suggest update instead      |

### Rate Limiting (429)

| Code                  | HTTP Status | Description       | Client Handling               |
| --------------------- | ----------- | ----------------- | ----------------------------- |
| `RATE_LIMIT_EXCEEDED` | 429         | Too many requests | Implement exponential backoff |

**Rate Limit Response Headers:**

```
RateLimit-Limit: 100
RateLimit-Policy: 100;w=60
RateLimit-Remaining: 0
RateLimit-Reset: 60
Retry-After: 60
```

`RateLimit-*` is the IETF draft-6 family emitted by `express-rate-limit`
(`standardHeaders: true` in `server/middleware/rateLimit.ts`). `RateLimit-Reset`
and `Retry-After` are both **delta-seconds** — seconds from now, not a unix
timestamp and not an HTTP-date. `Retry-After` is emitted for every
`RateLimitError` by `apiErrorMiddleware`, so any 429 carries it.

*(CORRECTED 2026-07-19: this block previously showed `X-RateLimit-*` names with
`Reset` as a unix epoch. That was never what this API emitted — the library has
sent the `RateLimit-*` family with delta-seconds since `standardHeaders` was
enabled. PR #135 brought the AI endpoints onto the same family.)*

### Business Logic Errors (400, 422)

| Code                 | HTTP Status | Description                | Client Handling      |
| -------------------- | ----------- | -------------------------- | -------------------- |
| `INSUFFICIENT_FUNDS` | 422         | Account balance too low    | Show balance warning |
| `BUDGET_EXCEEDED`    | 422         | Transaction exceeds budget | Show budget warning  |
| `INVALID_TRANSFER`   | 400         | Transfer validation failed | Show transfer error  |

### System Errors (500, 503)

| Code                  | HTTP Status | Description              | Client Handling                       |
| --------------------- | ----------- | ------------------------ | ------------------------------------- |
| `INTERNAL_ERROR`      | 500         | Unexpected server error  | Show generic error, log to monitoring |
| `SERVICE_UNAVAILABLE` | 503         | Service temporarily down | Show maintenance message              |

---

## Client-Side Error Handling Pattern

```typescript
import { AxiosError } from "axios";

interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: Array<{ field: string; message: string; code: string }>;
  };
}

function handleApiError(error: AxiosError<ApiError>) {
  const { code, message, fields } = error.response?.data?.error || {};

  switch (code) {
    case "UNAUTHORIZED":
    case "AUTH_SESSION_EXPIRED":
      // Redirect to login
      window.location.href = "/login";
      break;

    case "VALIDATION_ERROR":
      // Map field errors to form state
      if (fields) {
        fields.forEach((f) => setFieldError(f.field, f.message));
      }
      break;

    case "RATE_LIMIT_EXCEEDED":
      const retryAfter = error.response?.headers["retry-after"];
      showToast(`Too many requests. Retry in ${retryAfter}s`);
      break;

    case "NOT_FOUND":
      showToast("Resource not found");
      break;

    default:
      showToast(message || "An unexpected error occurred");
  }
}
```

---

## HTTP Status Code Summary

| Status | Category          | Usage                         |
| ------ | ----------------- | ----------------------------- |
| 200    | Success           | Standard success response     |
| 201    | Created           | Resource created successfully |
| 204    | No Content        | Delete success                |
| 400    | Bad Request       | Validation errors             |
| 401    | Unauthorized      | Authentication required       |
| 403    | Forbidden         | Permission denied             |
| 404    | Not Found         | Resource doesn't exist        |
| 409    | Conflict          | Duplicate resource            |
| 422    | Unprocessable     | Business logic error          |
| 429    | Too Many Requests | Rate limit exceeded           |
| 500    | Internal Error    | Server error                  |
| 503    | Unavailable       | Service down                  |
