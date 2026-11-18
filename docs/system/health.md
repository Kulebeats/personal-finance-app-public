# Health Check Endpoints

Standardized health probes for orchestration and monitoring.

## Endpoints

### `GET /health/live`

**Liveness Probe**

- **Purpose**: Checks if the application process is running and accepting HTTP requests.
- **Usage**: Used by Kubernetes/Docker to restart the container if the process hangs.
- **Response**: `200 OK`

```json
{
  "status": "healthy",
  "uptime": 123.45
}
```

### `GET /health/ready`

**Readiness Probe**

- **Purpose**: Checks if the application dependencies (Database, Cache) are ready to handle traffic.
- **Usage**: Used by Load Balancers to route traffic. If 503, traffic is held or routed elsewhere.
- **Response**: `200 OK` or `503 Service Unavailable`

```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "healthy", "latency": 5 },
    "cache": { "status": "healthy", "latency": 1 }
  },
  "version": "1.0.0",
  "uptime": 123.45
}
```

### `GET /health/startup`

**Startup Probe**

- **Purpose**: Checks if the application has completed initialization (migrations, seed data, warming).
- **Usage**: Used during slow startups to delay liveness checks.
- **Response**: `200 OK` or `503 Service Unavailable`
