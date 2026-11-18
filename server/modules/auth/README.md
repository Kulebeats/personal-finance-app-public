# Auth Module

Authentication and session management for the Personal Finance App.

## Files

| File                 | Purpose                               |
| -------------------- | ------------------------------------- |
| `auth.controller.ts` | HTTP request handling                 |
| `auth.service.ts`    | Business logic (login, register, MFA) |
| `auth.repository.ts` | Data access layer                     |
| `auth.validation.ts` | Zod schemas                           |
| `auth.routes.ts`     | Express router                        |
| `auth.types.ts`      | TypeScript interfaces                 |

## Endpoints

| Method | Path                    | Auth | Description       |
| ------ | ----------------------- | ---- | ----------------- |
| POST   | `/auth/register`        | No   | Create new user   |
| POST   | `/auth/login`           | No   | Authenticate user |
| POST   | `/auth/logout`          | Yes  | End session       |
| GET    | `/auth/me`              | Yes  | Get current user  |
| POST   | `/auth/verify-mfa`      | No   | Verify MFA code   |
| POST   | `/auth/change-password` | Yes  | Update password   |

## Security Features

- **Rate limiting**: `authLimiter` on public routes
- **Account lockout**: 5 failed attempts → 15 min lock
- **MFA support**: Email-based verification
- **Password complexity**: Enforced via `validatePasswordComplexity()`
- **Audit logging**: All auth events logged

## Usage

```typescript
import { authRoutes } from "./modules/auth";

app.use("/auth", authRoutes);
```
