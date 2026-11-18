# Notifications PII Audit Findings

**Date:** 2026-01-29
**Scope:** Notification payloads, metadata, and retention behavior for auth-related events
**Modules:** `server/services/notification`, `server/modules/auth`, `shared/schema`, scheduler

---

## Summary

A targeted audit of notification content identified two PII leakage paths in the new-login notification flow. Both issues were remediated in the same session by removing PII from notification payloads, narrowing metadata to the minimum needed for internal correlation, and updating tests to assert the new behavior.

---

## Findings

| ID | Issue | Impact | Evidence | Status |
| --- | --- | --- | --- | --- |
| NOTIF-PII-001 | IP address stored in notification metadata | PII retained beyond need; increases breach impact | `metadata` included `ipAddress` | Resolved |
| NOTIF-PII-002 | Device name present in notification body | PII shown to end users; potential exposure in screenshots/exports | Body contained device details | Resolved |

---

## Detailed Findings and Remediation

### NOTIF-PII-001: IP Address Stored in Metadata

**Problem:** `metadata` on new-login notifications contained `ipAddress`.

**Risk:** IP addresses are personal data and not required for user-facing notification workflows. Retaining them in a user-visible data store expands data retention obligations and breach impact.

**Fix:** Remove `ipAddress` from metadata and keep only `sessionId` for internal correlation.

**Post-Fix Behavior:**
- `metadata` now contains only `sessionId`.
- IP address remains available in audit logs and login history, not in notifications.

### NOTIF-PII-002: Device Name in Notification Body

**Problem:** Notification body included device name and OS details.

**Risk:** Device details are personal data and can be exposed via notification UIs, exports, or logs. It is unnecessary for the minimal alert purpose.

**Fix:** Replace the body with a generic security message and direct users to review active sessions.

**Post-Fix Body Example:**
- "A new device signed in to your account. Review your active sessions for details."

---

## Validation Steps

1. Trigger a new-login notification.
2. Query notification rows created in the last 24 hours.
3. Confirm `metadata` does not include `ipAddress` or `deviceName`.
4. Confirm notification body uses the generic message.

Example query:

```sql
SELECT metadata, body
FROM notifications
WHERE type = 'new_login'
  AND created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC
LIMIT 5;
```

---

## Follow-Ups

- Keep notification payloads PII-minimal by default.
- Re-audit notification types whenever new templates are introduced.
- Ensure exports exclude or redact notification metadata fields by default.
