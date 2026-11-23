# R00 isolated local PostgreSQL target

Observed 15 October 2026 at 02:06 Africa/Lusaka. This proves a local synthetic cluster endpoint only; it does not prove a migrated application database or staging.

| Field | Observed value |
|---|---|
| Host binding | 127.0.0.1 only |
| Port | 55432 |
| PostgreSQL | 18.6, Windows x64 |
| Maintenance database | postgres in the newly initialized campaign cluster |
| Synthetic role | pfa_campaign |
| Authentication | trust, isolated loopback synthetic cluster only; not deployment policy |
| Data directory | C:\Users\USER\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\completion-pg |
| Process ID at creation | 35108; must reverify before process operations |
| Timezone | UTC, confirmed after reload |
| Application DB | Not created at this checkpoint; R00 target worker owns unique manifest-bound creation |

The primary .env was inspected without printing credentials. Its DATABASE_URL resolves to localhost:5432/finance_app. No connection to that endpoint was made. No .env or credential was copied. The separate cluster path was absent and port 55432 had no listener before initialization.

Installed executables used: C:\Program Files\PostgreSQL\18\bin\initdb.exe, pg_ctl.exe and psql.exe. Initialization arguments: `-D <exact campaign cluster path> -U pfa_campaign -A trust --no-locale -E UTF8`. pg_ctl was launched with a hidden window, explicit data path and `-p 55432 -h 127.0.0.1`. The host's existing PostgreSQL service was not stopped, reconfigured or connected to.

Read-back from the new maintenance endpoint:

```text
current_database = postgres
inet_server_addr = 127.0.0.1
inet_server_port = 55432
version = PostgreSQL 18.6 on x86_64-windows, compiled by msvc-19.44.35228, 64-bit
timezone = UTC
```

Only this endpoint is authorized for campaign bootstrap. R00's bootstrap must additionally require an explicit run manifest, a unique disposable name and marker; it may create an absent synthetic database, apply versioned migrations and verify the marker. Naming alone is insufficient. Existing/foreign markers, URL overrides and wrong endpoints must fail before writes. Tests must not fall back to the primary configuration.

The local data directory is intentionally ignored. Portable target/fixture definitions and evidence belong in versioned files. Do not treat this local cluster's existence as a dependency runtime decision: R00 runtime owner must reconcile selected PostgreSQL support/parity with CI and deployment.

When cleanup is authorized, verify the exact resolved cluster directory and owning PID, stop only this cluster using its explicit data directory, then remove only checked campaign-owned data. Do not stop the shared PostgreSQL service or recursively traverse dependency junctions.
