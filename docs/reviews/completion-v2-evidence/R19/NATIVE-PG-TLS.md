# Native PostgreSQL TLS component: source checkpoint

Status: implemented source and pure/fake tests only, 15 October 2026. **No cluster initialization, native tool execution, listener, network/DB connection or generated certificate/credential occurred at this checkpoint.** Independent source/security review must precede the parent's separately released component run. No application or ordinary runner integration is included. R19 OPS-015, R20 production profile, installed runtime dependency identity/custody, hosted CA and release gates remain OPEN.

## Exact bounded allocation

- Run `r19pgtls20261015a1`, numeric endpoint `127.0.0.1:55461`, database `pfa_completion_r19_tls_r19pgtls20261015a1_test`.
- Amended explicit physical root `C:\Users\USER\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\capital-r19-pg-tls\r19pgtls20261015a1`; `pgdata`, `private`, `public` and `evidence` children. The original logical AppData-root assumption was disproved as documented below. An existing run root or any reparse ancestor refuses. A parent directory may be created; it is never recursively removed. Earlier absence/passive port snapshots are not reservations. Live preflight and actual listener PID/address must agree; no alternate port/cluster adoption.
- Exact source-pinned `postgres.exe`, `initdb.exe`, `pg_ctl.exe` in `C:\Program Files\PostgreSQL\18\bin`, and Git's `usr\bin\openssl.exe`. SHA-256 pins in PLAN were observed by read-only file hashing; Windows file metadata reported PG18.6/OpenSSL3.5.7. The future runner independently compares hashes and actual `--version`/`version` output before its first fixture write. These local expectations are not authenticated distribution provenance, DLL inventory or continuous binary custody.
- Existing campaign cluster55432, service registration, shared configuration, application schema/migrations, provider accounts and ordinary test/network/PG guards are untouched. The new component does not accept a connection URL, path, tool, flag, target or environment map from CLI input.

## Future execution sequence, not an executed result

Selected Node24.22.0 ARM64 can directly import the existing `server/dbSsl.ts` with native type stripping; a pure test verified this without connecting or reading CA files. The future command after independent review and parent release is the selected absolute node executable followed by `scripts/component-proofs/native-pg-tls.mjs --execute-owned-component r19pgtls20261015a1`. No preload/tsx or application import is used. The runtime rejects NODE_OPTIONS/NODE_PATH and unexpected Node arguments, then replaces its own child environment with a fixed minimal map, eliminating pg/provider/profile ambient fallbacks. Importing the entry module is inert and exposes no execution function.

All native dispatch uses absolute executables, argument arrays, `shell:false`, `windowsHide:true`, bounded output/time and discarded native stderr. A static, fixed-SystemRoot PowerShell JSON-stdin bridge reads the fixed port/captured process identity and restricts the **new root only** to the current owner's inheritable full-control DACL before secrets are created. Existing accepted metadata inspection rejects every Windows ReparsePoint attribute on ancestors/files. Generated credentials and CA/leaf private keys remain only in this restricted private subtree/native memory; argv/evidence has no password/key bytes. SQL logging and error-statement/parameter logging are disabled in the new cluster. Evidence contains no raw exception/server/SQL payload. This is not a claim that JavaScript strings can be securely zeroed.

Fresh synthetic EC certificates comprise a CA, unrelated CA, IP127.0.0.1 leaf and same-CA localhost-only leaf, with an explicit run-owned OpenSSL config. Initdb uses SCRAM for local/host authentication, UTF8/C locale and a generated password file. Explicit configuration pins numeric listen/port, TLS>=1.2, exact cert/key/HBA files, bounded connections/timeouts, no preloads, no archiving and no domain-socket listener. HBA rejects plaintext and permits only owner+postgres bootstrap or probe-role+exact fixture database via SCRAM. PostgreSQL starts as a captured standalone child; service/pg_ctl start adoption is absent.

The first actual production-resolver TLS client verifies database `postgres`, owner role, server address/port/version, `pg_stat_ssl`, authorized socket and exact peer DER hash. On that same verified client, the runner checks the new PGDATA/system identifier, creates one non-superuser probe role, creates the exact empty database with `TEMPLATE template0`, and sets its unique database comment. No application tables or versioned migrations are created. Probe clients use current `resolveDatabaseConnection` with NODE_ENV=production, explicit public CA and configured numeric host identity. No connectionString is passed to pg. Before callbacks, one query on the same client verifies current database/user, persisted marker, numeric server address/port, server18.6, `pg_stat_ssl` TLS/cipher/bits, authorized socket and public leaf DER digest.

The fixed oracles are good certificate positive; unrelated CA connect failure; explicit plaintext HBA refusal; stop/restart only this new cluster with the same-CA localhost-only leaf and assert ERR_TLS_CERT_ALTNAME_INVALID before query; restore the good leaf and repeat marker/SSL positive. Expected negative callbacks and identity-query counts are zero. The plaintext negative intentionally overrides only the fixture client's ssl after selecting the verified resolver and is classified as native HBA policy, not application production TLS configuration.

The component-only Node boundary permits the exact numeric socket and its owned TLS upgrade, rejects DNS/HTTP/fetch/listeners/foreign and unowned routes, and records counts. No global OS/process egress certification is inferred. New PG configuration binds only numeric loopback; native tools/OS DLL loading and native-process capability remain outside this Node boundary. This narrowly authorized component proof does not resolve the blocked application dependency/custody gate.

## Shutdown and cleanup

The captured postmaster handle, executable/start identity, exact PGDATA pidfile and fixed-port listener PID must agree before bounded `pg_ctl -D <exactPGDATA> -m fast -w -t10 stop`. No kill-by-port/name, foreign PID stop or service action exists. Cleanup awaits captured process exit and zero fixed-port listeners, rechecks root identity/ancestors and every descendant's reparse/regular-file state, then removes only the owned `pgdata` and `private` descendants. Public certificate material, nonsecret config and sanitized `evidence/report.json` remain in the create-only run root, preventing accidental reuse.

If initialization times out/fails, an unbound process appears, shutdown/identity fails or filesystem identity changes, cleanup fails closed and leaves uncertain state for explicit parent handling. The report cannot claim removal/stopped success. It must never erase live/unverified PGDATA. A remaining postmaster.pid or a newly observed fixed-port listener also blocks descendant removal. Native-path reopen races/custody are not certified by these observation checks. Native subprocess, transport and bridge operations have fixed timeouts; synchronous local filesystem observations are not a hard real-time guarantee. Actual stop timing and Windows native behavior still require the separately authorized run. No guaranteed crash-recovery or descendant-process cleanup is claimed for an interrupted initializer.

## Source verification checkpoint

Selected Node native tests: **18/18 pass, 0 skips**, 213.62ms on the initial complete source run; final rerun is recorded in the handoff. Tests were added before their respective modules/exports and first refused because the implementation was absent. Coverage uses pure inputs and fake sockets/process dispatch: exact target/unknown input refusal, trusted resolver configuration, every same-client identity mismatch, zero-query negative paths, output sanitization, fixed argv/environment, TLS/DNS/HTTP boundary, stopped/port/ownership-before-remove ordering, lifecycle sequence, static JSON-stdin bridge, bounded waits and inert entry import. No native process or cluster fixture was executed by these tests. They do not establish PostgreSQL SSL/SCRAM/Windows ACL/process behavior; those are the pending runtime oracle.

Final focused rerun before freeze: **18/18 pass, 0 skips, 227.40ms**; all seven new module/test files pass selected Node --check. Full npm run check is intentionally pending: parent holds the shared DB/TypeScript/broad slot for other accepted work. New module syntax/native focused checks are permitted. Freeze this source at its introducing commit for independent review; parent owns canonical integration/status and subsequent exact component release. No provider/deployment/readiness/production claim follows from this source checkpoint.

## Independent review correction: fresh listener before native stop

Review of 5c3e4e7 found that listener PID/address agreement was observed at startup but not freshly before each pg_ctl stop. The follow-up adds a fresh fixed-port inventory immediately before native stop dispatch, requiring exactly one row with address 127.0.0.1, port 55461 and the captured postmaster PID. The static bridge now returns the explicit port too; startup reuses the same strict predicate. Missing/multiple listeners, wildcard/IPv6 addresses, foreign PID, wrong/missing port or metadata failure prevent any stop dispatch and retain uncertain state. Fake regressions assert zero dispatch for every refusal and fresh-listener→dispatch ordering for the positive. Focused native result: **19/19 pass, 0 skips, 220.42ms**; seven selected Node syntax checks pass. No real process, listener or cluster was used. This closes the source-contract gap, not a reproduced foreign-process stop; actual runtime remains blocked pending independent re-review and parent release.

## First parent attempt: runtime path case refusal

Parent integrated accepted source as e99323a+aeb4d73, passed 19 focused tests and combined static, then released its exact component CLI. That attempt at aeb4d73 exited 1 before allocation; parent confirmed the approved root remained absent. Parent diagnostics identified SystemRoot=C:\WINDOWS while the entry compared case-sensitive C:\Windows. This is a pre-allocation refusal, not native PG/TLS evidence.

The narrow follow-up extracts the entry's pure runtime preflight and compares only case variants of the exact C:\Windows string. It does not normalize/adopt another root, separator, trailing slash, traversal or control characters. The unchanged selected Node path/version/architecture/platform, empty argument list and absent NODE_OPTIONS/NODE_PATH gates remain required. Unit extraction reproduced the uppercase-root refusal (one failed/one passed preflight case), then the correction accepts four case spellings and refuses ten malformed/different-root inputs plus nine altered-runtime/preload/unknown-field cases. Final focused result: **21/21 pass, 0 skips, 222.82ms**; seven syntax checks and diff check pass. Full compiler/broad checks remain parent-owned. No independent CLI retry, native tool/process, root allocation or network/DB action occurred here; parent must review/release any retry on the same allocation.

## Second parent attempt: preallocation TEMP lifecycle

Parent's next exact attempt at canonical f9e7d7e passed all native tool hash/version preflight checks, then failed stage allocate (exit1, 3.27s). Parent log `.local/r01-integrated/native-pg-runtime-f9e7d7e.log` remains the failure record. Read-only follow-up observed exactly root/private/temp: three regular non-reparse directories, current-user owned, inherited/unprotected DACLs, child counts1/1/0; no files, public/evidence/PGDATA, certificates or database outcomes. Root/private creation UTC2026-10-15T04:12:44.6153748Z and temp .6164633Z. Source supplied future private TEMP/TMP to preflight Windows children before create-only allocation. The layout and source support preflight temp materialization; this author did not instrument or claim which particular child created it. No mutation/cleanup/retry accompanied diagnosis.

The source follow-up separates two explicit environments. PREALLOCATION uses the existing fixed `C:\Users\USER\AppData\Local\Temp`, fixed SystemRoot/locale and no OPENSSL_CONF or ambient inheritance. Before its first child, synchronous Node lstat/realpath checks the entire Temp ancestry; the first static read-only metadata child then refuses ANY Windows ReparsePoint attribute on every ancestor before any subsequent native tool or fixture allocation. Node observations alone are not claimed to expose every Windows reparse tag. This permits ordinary nonsecret Windows/tool temporary metadata in the existing local Temp; no generated credential or private key exists yet. Binary hash/version preflight still completes before fixture writes.

Root allocation remains create-only. Its DACL bridge also uses PREALLOCATION, preventing Windows from creating a private subtree first. Only after restricted root, private/public/evidence/temp directories and the owned OpenSSL config exist and pass metadata inspection does the runtime switch to PRIVATE TEMP/TMP+OPENSSL_CONF; only then are generated credentials and keys created. Final evidence/metadata switches back to PREALLOCATION, so deleted private/temp cannot be recreated by a child. Native dispatch rejects an absent environment instead of inheriting it.

Component-local static metadata action now receives JSON paths and this explicit environment. It replaces the import of the recovery helper whose child environment was fixed SystemRoot-only; all accepted recovery files remain unchanged. Fake filesystem/child tests prove full Node ancestry observation before child dispatch, generic reparse refusal, preallocation temp materialization without creating the future run root, create-only allocation/DACL ordering and no private-temp recreation after cleanup. The fake materialization test first failed under the old private-env mapping, then passed under the split lifecycle. This remains a source/fake proof, not Windows runtime success.

Final focused result: **23/23 pass, 0 skips, 222.18ms**; seven selected Node syntax checks and diff check pass. The failed three-directory root and failure log are preserved. Cleanup of that failed allocation is parent-owned and separately reviewed; this source neither adopts an existing root nor chooses a new run/port/target. No actual child/tool, component retry, cluster/DB/network connection, cleanup or compiler/broad suite was executed for the follow-up.

## Third parent attempt: logical AppData allocation disproved

Parent integrated the lifecycle correction as b2d9407, passed23 pure tests/static/browser checks, and separately reviewed/executed nonrecursive deletion of the exact three empty failed-allocation directories. That cleanup has its own parent record; this author did not execute it. Exact retry b2d9407 then refused preflight in0.90s before allocation/tools/certificates/outcomes. Failure log `.local/r01-integrated/native-pg-runtime-b2d9407.log` remains preserved.

Bounded read-only diagnosis found Temp and Local ancestry accepted, tool metadata accepted and zero55461 listeners, but the old parent `C:\Users\USER\AppData\Local\capital-r19-pg-tls` failed native realpath equality. Despite Directory attributes16/no symbolic link, Node resolved it to `C:\Users\USER\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\capital-r19-pg-tls`. The earlier logical allocation assumption was therefore false on this packaged Windows host. Strict identity refusal was correct; neither a no-reparse-only exception nor dynamic realpath adoption is allowed.

Parent explicitly authorized a fixed physical allocation amendment with the same run/database/port. Read-only verification accepted all ten Node and Windows-metadata ancestors of that explicit physical parent with existing preallocation Temp. Logical and physical parent lstat identities match dev2651408473, inode16888498604651032, birthtimeNs1792037564615374800; both report directory=true/symbolic=false and the same explicit physical native realpath. The same-run child is absent through the physical path. These observations bind this allocation decision, not future custody; preflight repeats exact checks and requires create-only absence at execution.

The sole runtime constant change pins PLAN.root to the complete physical path above. All realpath equality, generic reparse, ACL, tool, secret, cleanup, run/DB/port and create-only guards remain unchanged. A separately literal pure regression refused the old root and now requires the exact new pin. No alias is accepted dynamically. Root length119, owned OpenSSL-config path139 and representative pg_wal segment path158 are below legacy Windows MAX_PATH260; this is a concrete length inventory, not proof of every native path/temporary-file behavior or general long-path support. Actual initializer/start/stop remains unexecuted by this author.

Final focused result: **24/24 pass, 0 skips, 230.38ms**; seven selected Node syntax checks and diff check pass. Only read-only pinned-path metadata/identity and passive-port diagnostics, pure tests and syntax checks ran here. No native version command, component retry, allocation, cleanup, DB query/connection or provider call occurred. Parent/reviewer must accept this explicit amendment before any execution; prior failure logs and independent cleanup evidence remain intact.

## Parent actual native component result

Independent review accepted physical-allocation amendment author
`1ed6183e3954ec3f864070f159feb2614c27822c`, integrated as exact candidate
`1dd9aed746ccf6e9823b640751787d63ddfdfbac`. Parent fresh native tests passed
**24/24**, zero skips, 218.53ms, and `npm run check` passed, exit 0. Logs:
`.local/r01-integrated/native-pg-source-physical.log` and `check-physical.log`.
The selected absolute Node executable then ran the exact owned-component CLI
at that candidate. It completed with **status passed, exit 0**. No source changes
occurred during execution.

| Actual native outcome | Evidence |
|---|---|
| Trusted IP leaf, first and restored run | TLSv1.3; same-client peer/DB/role/marker/SSL identity verified; one identity query per probe |
| Unrelated CA | UNABLE_TO_VERIFY_LEAF_SIGNATURE; zero queries/callbacks |
| Plaintext connection | Native HBA code28000; zero queries/callbacks |
| Same-CA localhost-only leaf against numeric host | ERR_TLS_CERT_ALTNAME_INVALID; zero queries/callbacks |
| Bootstrap | Identity verified before three fixture DDL statements; system identifier7696746886577993432; no application schema |
| Node transport | Six exact-target connections, five TLS upgrades, zero DNS calls; denied counter0 on this prescribed run |
| Owned cleanup | Captured cluster stopped, listener gone, private subtree and PGDATA removed |

Canonical sanitized artifacts are
`.local/r01-integrated/native-pg-runtime-1dd9aed.log`,
`native-pg-runtime-1dd9aed-report.json` and
`native-pg-runtime-1dd9aed-readback.json`. The retained root's
`evidence/report.json` matches stdout. Its SHA256 is
`4f4f39d49ec0957b311c04807100132474ee7108a9c5c93bc121fcdd2dea8083`.
Separate parent read-back confirmed private and PGDATA absent, zero listeners
on55461, current-owner protected root DACL, and only public/evidence directories
plus component.conf/component.hba retained. The create-only root remains as
evidence and must not be reused for another execution. Previous failed logs and
the separately reviewed three-empty-directory cleanup record remain preserved.

Independent reviewer read the stdout/report/read-back and fresh check logs,
verified semantic equality and the report hash, and accepted this bounded
component result. The reviewer did not rerun it or independently inspect the
live target. This establishes native PostgreSQL TLS component behavior on this
local host, not application production mode, external JS/native dependency
custody, native DLL provenance, global egress, hosted/release TLS, recovery,
actual mail or deployment. All five report certifications remain false; full
production-profile manifest gates remain false. The ordinary application-test
cluster on55432 was not modified by this rehearsal.
