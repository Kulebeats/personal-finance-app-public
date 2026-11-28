# Operational Runbooks

## Personal Finance Application

**Last Updated:** 2026-02-06

---

## Runbook Index

| Runbook                                       | Scenario                    |
| --------------------------------------------- | --------------------------- |
| [RB-001](#rb-001-application-not-starting)    | Application not starting    |
| [RB-002](#rb-002-database-connection-failure) | Database connection failure |
| [RB-003](#rb-003-high-error-rate)             | High error rate             |
| [RB-004](#rb-004-user-account-locked)         | User account locked         |
| [RB-005](#rb-005-session-issues)              | Session issues              |
| [RB-006](#rb-006-rate-limit-triggered)        | Rate limit triggered        |
| [RB-007](#rb-007-disk-space-full)             | Disk space full             |

---

## RB-001: Application Not Starting

**Symptoms:** Application fails to start, logs show startup error

**Diagnosis:**

```bash
# Check logs
npm run start 2>&1 | head -50

# Verify environment
cat .env | grep -E "^(DATABASE_URL|SESSION_SECRET|NODE_ENV)"
```

**Common Causes:**

| Cause                  | Solution                    |
| ---------------------- | --------------------------- |
| Missing DATABASE_URL   | Set DATABASE_URL in .env    |
| Invalid SESSION_SECRET | Ensure 32+ character secret |
| Port 5000 in use       | Kill process or change PORT |
| Missing node_modules   | Run `npm install`           |

**Resolution:**

1. Fix environment variable
2. Restart application
3. Verify readiness: `curl http://localhost:5000/health/ready` (checks the database and Redis; the Render health check uses this path). `/healthz` only shows the process is up.

---

## RB-002: Database Connection Failure

**Symptoms:** API returns 503, logs show "ECONNREFUSED" or "connection timeout"

**Diagnosis:**

```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"

# Check PostgreSQL service
systemctl status postgresql
# or on Windows
sc query postgresql-x64-18
```

**Resolution:**

1. Start PostgreSQL if stopped
2. Verify connection string format
3. Check network/firewall rules
4. Restart application after DB is available

**Escalation:** If cloud database, check provider status page.

---

## RB-003: High Error Rate

**Symptoms:** Monitoring shows >1% error rate, users reporting failures

**Diagnosis:**

```bash
# Check recent logs for errors
grep "error" /var/log/app/*.log | tail -100

# Check for specific patterns
grep -E "(500|ECONNREFUSED|timeout)" /var/log/app/error.log
```

**Common Causes:**

| Cause               | Indicator                     | Action                   |
| ------------------- | ----------------------------- | ------------------------ |
| DB overload         | Slow queries                  | Add indexes, scale DB    |
| Memory pressure     | OOM in logs                   | Increase memory, restart |
| Bad deployment      | Errors started at deploy time | Rollback                 |
| External dependency | Specific error messages       | Check dependency status  |

**Resolution:**

1. Identify error pattern
2. Apply targeted fix or rollback
3. Monitor error rate returning to baseline

---

## RB-004: User Account Locked

**Symptoms:** User reports "account locked" error

**Diagnosis:**

```sql
SELECT email, failed_login_attempts, locked_until
FROM users
WHERE email = 'user@example.com';
```

**Resolution:**

```sql
-- Unlock account
UPDATE users
SET failed_login_attempts = 0, locked_until = NULL
WHERE email = 'user@example.com';
```

**Root Cause:** User or bot triggered 5 failed login attempts.

---

## RB-005: Session Issues

**Symptoms:** Users logged out unexpectedly, "session expired" errors

**Diagnosis:**

```sql
-- Check session table
SELECT COUNT(*) FROM session WHERE expire < NOW();

-- Cleanup expired sessions
DELETE FROM session WHERE expire < NOW();
```

**Common Causes:**

| Cause                  | Solution                       |
| ---------------------- | ------------------------------ |
| SESSION_SECRET changed | Users must re-login (expected) |
| Session table bloated  | Run cleanup query above        |
| Cookie settings issue  | Check secure/sameSite flags    |

**Resolution:**

1. Verify SESSION_SECRET unchanged
2. Clean expired sessions
3. If SECRET was rotated, inform users they must re-login

---

## RB-006: Rate Limit Triggered

**Symptoms:** User or integration getting 429 errors

**Diagnosis:**

```bash
# Check rate limit logs
grep "rate limit" /var/log/app/*.log | grep "user@example.com"
```

**Legitimate User:**

```bash
# Rate limits reset after window (1 minute for API, varies by endpoint)
# User should wait and retry
```

**Bot/Attack:**

```bash
# Check for patterns
grep "429" /var/log/app/access.log | awk '{print $1}' | sort | uniq -c | sort -rn
```

**Resolution:**

1. Identify if legitimate or malicious
2. For legitimate high-volume users, consider API key tier
3. For attacks, add IP to blocklist

---

## RB-007: Disk Space Full

**Symptoms:** Application errors, "no space left on device"

**Diagnosis:**

```bash
df -h  # Check disk usage
du -sh /var/log/app/*  # Check log sizes
du -sh /app/uploads/*  # Check upload sizes
```

**Resolution:**

1. Clear old logs: `find /var/log/app -mtime +30 -delete`
2. Clean temp files: `rm -rf /tmp/app-*`
3. Archive old uploads
4. Consider log rotation configuration

---

## Escalation Matrix

| Severity      | Response Time | Escalation                |
| ------------- | ------------- | ------------------------- |
| P0 (Outage)   | 15 min        | On-call → Team Lead → CTO |
| P1 (Degraded) | 1 hour        | On-call → Team Lead       |
| P2 (Minor)    | 4 hours       | Next business hours       |
| P3 (Cosmetic) | Next sprint   | Product backlog           |

---

## Contact Information

| Role           | Contact                |
| -------------- | ---------------------- |
| On-call        | PagerDuty rotation     |
| Backend Lead   | @backend-lead          |
| Infrastructure | @infra-team            |
| Database       | Cloud provider support |

---

_Created: 2026-02-06 as part of documentation re-audit (Task 4.4)_
