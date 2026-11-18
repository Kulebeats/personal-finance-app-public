# Architecture Diagrams

## System Context
```mermaid
flowchart LR
  User[User] -->|Browser| WebClient[React Web Client]
  WebClient -->|HTTP/JSON| Api[Express API]
  Api -->|SQL| Db[(PostgreSQL)]
  Api -->|Cache (optional)| Redis[(Redis)]
  Api -->|Files| Uploads[(Uploads Folder)]
  Cron[External Cron] -->|X-Cron-Secret| Api
```

## Transaction Flow
```mermaid
sequenceDiagram
  participant U as User
  participant C as Web Client
  participant A as API
  participant D as Postgres
  U->>C: Create transaction
  C->>A: POST /api/transactions
  A->>D: Insert transaction and balance updates
  D-->>A: Persisted data
  A-->>C: success response
  C-->>U: UI updated
```

## Analytics Report Flow
```mermaid
sequenceDiagram
  participant C as Web Client
  participant A as API
  participant R as Redis (optional)
  participant D as Postgres
  C->>A: GET /api/reports/cashflow
  A->>R: Lookup cache
  alt cache hit
    R-->>A: cached result
  else cache miss
    A->>D: Query analytics
    D-->>A: result set
    A->>R: store cache
  end
  A-->>C: report data
```

## Notes
- Redis cache is optional and enabled via `REDIS_URL`.
- Uploads are served from the local `uploads/` directory.
