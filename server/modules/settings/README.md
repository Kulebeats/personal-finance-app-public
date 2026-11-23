# Settings Module

User profile, preferences, security, and account management.

## Endpoints

### Profile

| Method | Path     | Description      |
| ------ | -------- | ---------------- |
| GET    | /profile | Get user profile |
| PUT    | /profile | Update profile   |

### Security

| Method | Path                 | Description     |
| ------ | -------------------- | --------------- |
| PUT    | /password            | Change password |
| GET    | /sessions            | List sessions   |
| DELETE | /sessions/:id        | Revoke session  |
| POST   | /sessions/revoke-all | Revoke all      |

### Account

| Method | Path            | Description    |
| ------ | --------------- | -------------- |
| POST   | /account/delete | Delete account |
| POST   | /privacy/export | Personal-data export (needs step-up) |
| GET    | /privacy/exports | List own personal exports |
| GET    | /privacy/exports/:id/download | Download own export (expires after 7 days) |

### Notifications

| Method | Path           | Description  |
| ------ | -------------- | ------------ |
| GET    | /notifications | Get prefs    |
| PUT    | /notifications | Update prefs |

### Preferences (Household)

| Method | Path         | Auth      |
| ------ | ------------ | --------- |
| GET    | /preferences | household |
| PUT    | /preferences | household |

## Usage

```typescript
import { settingsRoutes } from "./modules/settings";
app.use("/api/settings", settingsRoutes);
```
