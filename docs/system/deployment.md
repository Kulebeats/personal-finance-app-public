# Deployment Guide

## Personal Finance Application

**Document Version:** 2.0  
**Last Updated:** 2026-02-06

---

## 1. Environments

| Environment     | Purpose                | Database          | Redis    | TLS |
| --------------- | ---------------------- | ----------------- | -------- | --- |
| **Development** | Local coding           | Local PostgreSQL  | Optional | No  |
| **Test**        | CI/CD pipelines        | Docker PostgreSQL | No       | No  |
| **Staging**     | Pre-production testing | Cloud PostgreSQL  | Yes      | Yes |
| **Production**  | Live users             | Cloud PostgreSQL  | Yes      | Yes |

---

## 2. Prerequisites

### 2.1 Runtime Requirements

- Node.js 20+ LTS
- PostgreSQL 15+
- Redis 7+ (optional, for distributed rate limiting)

### 2.2 Environment Variables

**Required:**

| Variable         | Description           | Example                               |
| ---------------- | --------------------- | ------------------------------------- |
| `DATABASE_URL`   | PostgreSQL connection | `postgresql://user:pass@host:5432/db` |
| `SESSION_SECRET` | 32+ char secret       | `openssl rand -base64 32`             |
| `NODE_ENV`       | Environment mode      | `production`                          |

**Optional:**

| Variable      | Description          | Default |
| ------------- | -------------------- | ------- |
| `PORT`        | HTTP listen port     | `5000`  |
| `REDIS_URL`   | Redis connection     | -       |
| `CLIENT_URL`  | Frontend URL         | -       |
| `SMTP_HOST`   | Email server         | -       |
| `SMTP_USER`   | Email user           | -       |
| `SMTP_PASS`   | Email password       | -       |
| `TRUST_PROXY` | Behind reverse proxy | `false` |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Verify DB TLS certificate | `false` until staging proof |
| `DATABASE_SSL_CA_FILE` | Mounted DB CA PEM path | - |
| `DATABASE_SSL_CA_CERT` | Inline DB CA PEM fallback | - |

---

## 3. Deployment Options

### 3.1 Single Server (Simple)

```bash
# Build
npm run build

# Start
NODE_ENV=production npm start
```

Serves both API and static frontend from single Express process.

### 3.2 Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist ./dist
EXPOSE 5000
CMD ["node", "dist/server/index.js"]
```

**docker-compose.yml:**

```yaml
version: "3.8"
services:
  app:
    build: .
    ports:
      - "5000:5000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - SESSION_SECRET=${SESSION_SECRET}
    depends_on:
      - postgres

  postgres:
    image: postgres:15
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: finance_app
      POSTGRES_PASSWORD: ${DB_PASSWORD}

volumes:
  pgdata:
```

### 3.3 Platform Deployments

| Platform    | Build Command   | Notes                     |
| ----------- | --------------- | ------------------------- |
| **Railway** | Auto-detected   | Set env vars in dashboard |
| **Render**  | `npm run build` | Use Render PostgreSQL     |
| **Fly.io**  | `fly launch`    | Add volumes for uploads   |
| **Vercel**  | Not recommended | Serverless poorly suited  |

---

## 4. Production Configuration

### 4.1 Reverse Proxy (Nginx)

```nginx
upstream app {
    server 127.0.0.1:5000;
}

server {
    listen 443 ssl http2;
    server_name finance.example.com;

    ssl_certificate /etc/ssl/certs/cert.pem;
    ssl_certificate_key /etc/ssl/private/key.pem;

    location / {
        proxy_pass http://app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Uploads - larger body size
    location /api/receipts {
        proxy_pass http://app;
        client_max_body_size 10M;
    }
}
```

### 4.2 Trust Proxy Configuration

When behind a reverse proxy, set in your environment:

```bash
TRUST_PROXY=true
```

This ensures correct rate limiting by IP address.

### 4.3 Database TLS Verification

Production enables database TLS by default. Strict certificate verification is enabled with:

```bash
DATABASE_SSL_REJECT_UNAUTHORIZED=true
DATABASE_SSL_CA_FILE=/etc/secrets/render-postgres-ca.pem
```

Use `DATABASE_SSL_CA_CERT` only when a file mount is unavailable. Do not add `sslmode=require`
to `DATABASE_URL`; keep TLS settings in the explicit environment variables so the Node
Postgres SSL object can carry the CA bundle.

---

## 5. Database Operations

### 5.1 Migrations

```bash
# Generate migration from schema changes
npm run db:generate

# Apply migrations
npm run db:push
```

### 5.2 Backups

```bash
# Backup
pg_dump -U postgres finance_app > backup.sql

# Restore
psql -U postgres finance_app < backup.sql
```

---

## 6. Monitoring

### 6.1 Health Checks

| Endpoint            | Purpose         | Expected              |
| ------------------- | --------------- | --------------------- |
| `GET /healthz`      | Liveness probe  | 200 OK                |
| `GET /health/ready` | Readiness probe | 200 OK (DB connected) |

### 6.2 Logging

Structured JSON logging via logger utility:

```json
{
  "level": "info",
  "timestamp": "2026-02-06T12:00:00Z",
  "message": "Request",
  "method": "GET",
  "path": "/api/accounts",
  "duration": 45
}
```

### 6.3 Metrics

Consider adding:

- Response time histograms
- Error rate counters
- Rate limit hit counters
- Active sessions gauge

---

## 7. Security Checklist

- [ ] `SESSION_SECRET` is unique and secure (32+ chars)
- [ ] `NODE_ENV=production` is set
- [ ] TLS enforced at reverse proxy
- [ ] Database uses strong password
- [ ] TRUST_PROXY set if behind proxy
- [ ] SMTP credentials secured
- [ ] File upload directory is not web-accessible directly

---

## 8. Related Documentation

| Document                                                      | Purpose                |
| ------------------------------------------------------------- | ---------------------- |
| [database-setup.md](../setup/database-setup.md)               | Database configuration |
| [Architecture](architecture.md)                               | System design          |
| [Security Architecture](../security/security-architecture.md) | Security controls      |

---

_Document expanded: 2026-02-06 as part of documentation re-audit (Task 3.3)_
