# Auth Performance Targets

> Performance requirements and monitoring for authentication endpoints (P4-61).

## Response Time Targets

| Endpoint | p50 | p95 | p99 | Max |
|----------|-----|-----|-----|-----|
| POST /api/auth/login | <100ms | <200ms | <500ms | 1000ms |
| POST /api/auth/register | <150ms | <300ms | <600ms | 1200ms |
| POST /api/auth/logout | <30ms | <50ms | <100ms | 200ms |
| GET /api/auth/me | <20ms | <40ms | <80ms | 150ms |
| POST /api/security/mfa/verify | <100ms | <200ms | <400ms | 800ms |

## Measurement Points

- Time from request received to response sent
- Excludes network latency
- Measured at application level (Express middleware)
- Does not include client rendering time

## Bottleneck Analysis

### Login Endpoint Breakdown

| Operation | Expected Time | Notes |
|-----------|--------------|-------|
| Request parsing | <1ms | JSON body parsing |
| Input validation | <2ms | Zod schema validation |
| User lookup | <10ms | PostgreSQL indexed query |
| Password verification | 80-120ms | bcrypt with cost=12 |
| Session creation | <10ms | Session store write |
| Audit logging | <5ms | Async, non-blocking |
| Response serialization | <1ms | JSON response |
| **Total** | **~110-150ms** | Within p95 target |

### Critical Path: bcrypt

bcrypt is intentionally slow (security feature). Current configuration:

```typescript
const BCRYPT_ROUNDS = 12; // ~100ms on modern hardware
```

**Trade-offs:**
- Lower rounds (10): ~25ms but weaker security
- Higher rounds (14): ~400ms, better security, worse UX
- **Current (12)**: Good balance at ~100ms

### Optimization Opportunities

1. **Connection Pooling** (Already implemented)
   - Max 20 connections to PostgreSQL
   - Prevents connection overhead

2. **Session Store** (Current: PostgreSQL)
   - Upgrade to Redis for <1ms session reads
   - Current PostgreSQL: ~5-10ms

3. **Async Operations**
   - Audit logging is fire-and-forget
   - New device notifications are async

4. **Caching**
   - User lookup could be cached (not implemented)
   - Trade-off: Cache invalidation complexity

## Load Testing

### Target Capacity

| Metric | Target | Notes |
|--------|--------|-------|
| Concurrent users | 1000 | Simultaneous sessions |
| Logins/minute | 500 | Peak authentication rate |
| Registrations/minute | 100 | New user signups |

### k6 Load Test Script

```javascript
// load-tests/auth.k6.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const loginDuration = new Trend('login_duration');
const loginErrors = new Rate('login_errors');

export const options = {
  stages: [
    { duration: '1m', target: 100 },   // Warm up
    { duration: '3m', target: 500 },   // Ramp to target
    { duration: '5m', target: 500 },   // Sustain
    { duration: '2m', target: 1000 },  // Peak load
    { duration: '3m', target: 1000 },  // Sustain peak
    { duration: '2m', target: 0 },     // Cool down
  ],
  thresholds: {
    'login_duration': ['p(95)<200', 'p(99)<500'],
    'login_errors': ['rate<0.01'],
    'http_req_duration': ['p(95)<300'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Login test
  const loginStart = Date.now();
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: `loadtest+${__VU}@example.com`,
      password: 'LoadTest123!',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  loginDuration.add(Date.now() - loginStart);

  const loginSuccess = check(loginRes, {
    'login status 200': (r) => r.status === 200,
    'login has session': (r) => r.cookies['connect.sid'] !== undefined,
  });

  loginErrors.add(!loginSuccess);

  if (loginSuccess) {
    // Get current user
    const meRes = http.get(`${BASE_URL}/api/auth/me`, {
      cookies: { 'connect.sid': loginRes.cookies['connect.sid'][0].value },
    });

    check(meRes, {
      'me status 200': (r) => r.status === 200,
      'me response time < 50ms': (r) => r.timings.duration < 50,
    });

    // Logout
    http.post(`${BASE_URL}/api/auth/logout`, null, {
      cookies: { 'connect.sid': loginRes.cookies['connect.sid'][0].value },
    });
  }

  sleep(1);
}
```

### Running Load Tests

```bash
# Install k6
# Windows: choco install k6
# macOS: brew install k6
# Linux: sudo apt install k6

# Run against local
k6 run load-tests/auth.k6.js

# Run against staging
k6 run -e BASE_URL=https://staging.example.com load-tests/auth.k6.js

# Run with output to InfluxDB
k6 run --out influxdb=http://localhost:8086/k6 load-tests/auth.k6.js
```

## Monitoring

### Key Metrics to Track

```typescript
// Prometheus metrics (example)
const authMetrics = {
  login_duration_seconds: new Histogram({
    name: 'auth_login_duration_seconds',
    help: 'Login endpoint duration',
    labelNames: ['status'],
    buckets: [0.05, 0.1, 0.2, 0.5, 1],
  }),

  login_total: new Counter({
    name: 'auth_login_total',
    help: 'Total login attempts',
    labelNames: ['status', 'mfa_required'],
  }),

  active_sessions: new Gauge({
    name: 'auth_active_sessions',
    help: 'Number of active sessions',
  }),
};
```

### Alerting Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| Login p95 latency | >300ms | >500ms |
| Login error rate | >1% | >5% |
| Session creation failures | >0.1% | >1% |
| Rate limit triggers | >100/min | >500/min |

### Dashboard Panels

1. **Login Latency** - p50, p95, p99 over time
2. **Login Success Rate** - Success vs failure %
3. **Active Sessions** - Count over time
4. **Rate Limit Triggers** - By endpoint
5. **bcrypt Time** - Password verification duration

## Capacity Planning

### Current Limits

| Resource | Limit | Impact |
|----------|-------|--------|
| DB connections | 20 | Max concurrent queries |
| Session store | PostgreSQL | ~5ms read latency |
| bcrypt workers | 1 (main thread) | Sequential password checks |

### Scaling Path

1. **Vertical (Current)**
   - Increase DB connections (up to 100)
   - Add more CPU for bcrypt

2. **Horizontal**
   - Multiple app instances
   - Shared session store (Redis)
   - Load balancer (no sticky sessions needed)

3. **Optimize bcrypt**
   - Worker threads for password verification
   - Reduces main thread blocking

```typescript
// Example: bcrypt in worker thread
import { Worker } from 'worker_threads';

async function verifyPasswordAsync(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./bcrypt-worker.js', {
      workerData: { password, hash },
    });
    worker.on('message', resolve);
    worker.on('error', reject);
  });
}
```

## Related Documentation

- [Auth Session Strategy](./auth-session-strategy.md)
- [Penetration Testing Checklist](../security/auth-pentest-checklist.md)
- [Auth Module Overhaul Plan](../plans/auth-module-overhaul-plan.md)

