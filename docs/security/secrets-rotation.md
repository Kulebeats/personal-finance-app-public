# Secrets Rotation Procedures

This document describes the manual procedures for rotating sensitive secrets in the application.

## Overview

Secrets should be rotated:

- **Immediately** if a potential compromise is suspected
- **Quarterly** for session and JWT secrets
- **Annually** for database credentials (or per policy)

## Secrets Inventory

| Secret            | Environment Variable   | Rotation Period |
| ----------------- | ---------------------- | --------------- |
| Session Secret    | `SESSION_SECRET`       | 90 days         |
| Database Password | `DATABASE_URL`         | Annually        |
| CSRF Secret       | (derived from session) | 90 days         |

---

## SESSION_SECRET Rotation

The session secret is used to sign session cookies. Rotation invalidates all existing sessions.

### Procedure

1. **Generate new secret** (minimum 32 characters):

   ```bash
   openssl rand -base64 32
   ```

2. **Schedule rotation during low-traffic period**

3. **Update environment variable:**

   ```bash
   # In your hosting platform (Render, Vercel, etc.)
   SESSION_SECRET=<new-secret-value>
   ```

4. **Deploy application**

   - All users will be logged out
   - They will need to re-authenticate

5. **Verify:**
   - Check application logs for session errors
   - Confirm users can log in successfully

### Impact

- All existing sessions are invalidated
- Users must log in again

---

## DATABASE_URL Rotation

### Procedure

1. **Create new database user** with required permissions
2. **Update connection string** in environment
3. **Deploy and verify** database connectivity
4. **Revoke old credentials** after successful deployment

### Impact

- Brief downtime during credential switch
- No user-facing impact if done correctly

---

## Emergency Rotation

If a secret is compromised:

1. **Generate and deploy new secret immediately**
2. **Review audit logs** for suspicious activity
3. **Notify affected users** if necessary
4. **Document incident** for compliance

---

## Verification Checklist

After any rotation:

- [ ] Application starts successfully
- [ ] No authentication errors in logs
- [ ] Users can log in
- [ ] API endpoints respond correctly
- [ ] Background jobs execute without errors

---

## Monitoring

Watch for these indicators that rotation is needed:

- Approaching 90-day rotation deadline
- Security scan alerts
- Suspicious authentication patterns
- Failed login spikes

---

## Future Improvements

For automated rotation, consider:

- AWS Secrets Manager or HashiCorp Vault
- Dual-key verification during rotation period
- Automated rotation scheduling
