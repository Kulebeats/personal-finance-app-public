# Auth Session Strategy

> Documentation for session management implementation per INFRA-001.

## Current Implementation

- **Storage:** PostgreSQL via `connect-pg-simple`
- **Table:** `sessions` (standard pg-simple schema)
- **Session ID:** Cryptographically random, stored in signed cookie
- **Cookie Name:** `connect.sid`

## Session Configuration

```typescript
// server/index.ts
session({
  store: new PgSession({ pool }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000, // 24 hours default
  },
});
```

## Session Lifecycle

### Creation

1. User submits valid credentials to `/api/auth/login`
2. Server validates password via bcrypt
3. **Session regeneration** - prevents session fixation attacks
4. New session ID generated (32 bytes random, 256 bits entropy)
5. Session stored in PostgreSQL with user ID
6. Cookie sent to client with session ID (signed)

### Duration

| Mode | Duration | Use Case |
|------|----------|----------|
| Default | 24 hours | Standard login |
| Remember Me | 30 days | Trusted device |
| After Password Change | Immediate invalidation | Security event |

### Rolling Sessions

Sessions are extended on activity via `resave: false` with explicit touch.
The session expiry is set based on the Remember Me preference at login time.

### Destruction

1. User calls `/api/auth/logout`
2. `req.session.destroy()` called
3. Session removed from PostgreSQL
4. Cookie cleared from client

### Invalidation Events

Sessions are invalidated (all sessions for user) on:

- Password change
- MFA enablement/disablement
- Manual revocation from Settings > Security
- Account deletion

## Security Properties

### Cookie Security

| Property | Value | Purpose |
|----------|-------|---------|
| `httpOnly` | true | Prevents XSS access to cookie |
| `secure` | true (prod) | Requires HTTPS |
| `sameSite` | lax | CSRF protection |
| `signed` | true | Prevents tampering |

### Session ID Properties

- **Length:** 32 bytes (256 bits)
- **Generation:** `crypto.randomBytes()`
- **Storage:** Only ID stored client-side, data server-side

### Database Security

- Session data encrypted at rest (PostgreSQL TDE if configured)
- Session table indexed on `sid` and `expire`
- Expired sessions cleaned automatically

## Scaling Considerations

### Current (PostgreSQL)

PostgreSQL sessions work well for:

- Up to ~10,000 concurrent sessions
- Moderate session read frequency
- When session data changes frequently

**Bottleneck:** DB connection pool under very high load

### Future (Redis Option)

For high-scale deployments, consider `connect-redis`:

```typescript
import RedisStore from "connect-redis";
import { createClient } from "redis";

const redisClient = createClient({ url: process.env.REDIS_URL });
const store = new RedisStore({ client: redisClient });
```

**Benefits:**

- Sub-millisecond reads
- Better for 100,000+ concurrent sessions
- Built-in TTL expiration

### Horizontal Scaling

- **Current:** PostgreSQL sessions work across multiple app instances (shared store)
- **Sticky sessions:** NOT required (session store is centralized)
- **Load balancer:** Can use any strategy (round-robin, least connections)

## Session Data Model

### User Session Table (`user_sessions`)

Additional metadata beyond express-session:

```sql
CREATE TABLE user_sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  session_token VARCHAR(255) UNIQUE,
  device_name VARCHAR(100),
  device_type VARCHAR(20),
  browser VARCHAR(50),
  os VARCHAR(50),
  ip_address INET,
  is_trusted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  last_active_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);
```

### Express Session Table (`sessions`)

```sql
CREATE TABLE sessions (
  sid VARCHAR PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX sessions_expire_idx ON sessions(expire);
```

## Concurrent Session Policy

- **Max concurrent sessions:** Unlimited (default)
- **Session visibility:** Users can view all their sessions in Settings
- **Remote revocation:** Users can revoke any session except current
- **Bulk revocation:** "Log out of all other devices" option available

### Optional Enforcement

Can be enabled per-user or globally:

```typescript
const MAX_CONCURRENT_SESSIONS = 5;
const activeSessions = await sessionRepository.countByUserId(user.id);
if (activeSessions >= MAX_CONCURRENT_SESSIONS) {
  // Option A: Reject login
  throw new ConflictError("Maximum sessions reached");
  // Option B: Evict oldest session (preferred)
  await sessionRepository.deleteOldestByUserId(user.id);
}
```

## Data Retention

| Data | Retention | Notes |
|------|-----------|-------|
| Active sessions | Until logout or expiry | Auto-deleted on expiry |
| Expired sessions | Cleaned hourly | pg-simple auto-cleanup |
| Session audit logs | 90 days | `login_history` table |
| Revoked sessions | Immediate deletion | Hard delete |

## Monitoring

### Key Metrics

- Active session count per user
- Session creation rate
- Failed authentication rate
- Session table size
- Cleanup job execution

### Alerts

- Session table > 1M rows
- Session creation rate > 1000/min (potential attack)
- Failed auth rate > 100/min per IP

---

## Horizontal Scaling Guide (P3-50)

### Current Architecture (Single Instance)

```
┌──────────────┐     ┌──────────────┐
│   Client     │────▶│   Express    │
└──────────────┘     │   Server     │
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │  PostgreSQL  │
                     │  (Sessions)  │
                     └──────────────┘
```

### Scaled Architecture (Multiple Instances)

```
                     ┌──────────────┐
              ┌─────▶│  Express #1  │─────┐
              │      └──────────────┘     │
┌──────────┐  │      ┌──────────────┐     │  ┌──────────┐
│  Client  │──┼─────▶│  Express #2  │─────┼─▶│  Redis   │
└──────────┘  │      └──────────────┘     │  │ Sessions │
      │       │      ┌──────────────┐     │  └──────────┘
      │       └─────▶│  Express #n  │─────┘
      │              └──────────────┘
      │                     │
      │              ┌──────▼───────┐
      └─────────────▶│   Nginx LB   │
                     └──────────────┘
```

### Migration Steps: PostgreSQL → Redis Sessions

#### 1. Install Redis Session Store

```bash
npm install connect-redis redis
```

#### 2. Update Session Configuration

```typescript
// server/index.ts
import RedisStore from "connect-redis";
import { createClient } from "redis";

// Create Redis client
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 2000),
  },
});

redisClient.on("error", (err) => logger.error("Redis error", err));
redisClient.on("connect", () => logger.info("Redis connected"));

await redisClient.connect();

// Create session store
const sessionStore = new RedisStore({
  client: redisClient,
  prefix: "sess:",
  ttl: 86400, // 24 hours default
});

// Use Redis store instead of PostgreSQL
app.use(
  session({
    store: sessionStore, // Changed from PgSession
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);
```

#### 3. Environment Variables

```env
# Redis configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your-redis-password
REDIS_TLS_ENABLED=true  # For production
```

#### 4. Health Check Update

```typescript
// Add Redis to health check
app.get("/healthz", async (req, res) => {
  const checks = {
    postgres: await checkPostgres(),
    redis: await checkRedis(),
  };

  const healthy = Object.values(checks).every(Boolean);
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    checks,
    timestamp: new Date().toISOString(),
  });
});

async function checkRedis(): Promise<boolean> {
  try {
    await redisClient.ping();
    return true;
  } catch {
    return false;
  }
}
```

### Load Balancer Configuration (Nginx)

```nginx
upstream app_servers {
    least_conn;  # Or: ip_hash for sticky sessions (not required with Redis)
    server app1:3000;
    server app2:3000;
    server app3:3000;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://app_servers;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: finance-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: finance-api
  template:
    metadata:
      labels:
        app: finance-api
    spec:
      containers:
        - name: api
          image: finance-api:latest
          ports:
            - containerPort: 3000
          env:
            - name: REDIS_URL
              valueFrom:
                secretKeyRef:
                  name: redis-secret
                  key: url
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          readinessProbe:
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /healthz
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 20
---
apiVersion: v1
kind: Service
metadata:
  name: finance-api
spec:
  selector:
    app: finance-api
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
```

### Performance Comparison

| Metric | PostgreSQL Sessions | Redis Sessions |
|--------|--------------------:|---------------:|
| Read latency (p50) | 5-10ms | <1ms |
| Write latency (p50) | 10-20ms | <1ms |
| Max concurrent | ~10,000 | ~100,000+ |
| Memory per session | N/A (disk) | ~500 bytes |
| Failover time | Manual/slow | <1 second |

### Rollback Plan

If Redis migration causes issues:

1. Revert session store configuration to PostgreSQL
2. Existing sessions will be invalid (users must re-login)
3. No data loss (user data in PostgreSQL, only sessions in Redis)

```typescript
// Rollback: revert to PostgreSQL sessions
const sessionStore = new PgSession({
  pool,
  tableName: "sessions",
});
```

## Related Documentation

- [Auth Module Overhaul Plan](../plans/auth-module-overhaul-plan.md)
- [Security Settings API](../api/security-api.md)
- [Breach Notification Process](../compliance/breach-notification.md)

