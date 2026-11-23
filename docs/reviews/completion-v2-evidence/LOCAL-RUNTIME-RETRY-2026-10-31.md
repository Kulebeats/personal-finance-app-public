# Proposed retry of the owned local test runtime

Prepared31 October2026. No startup or database write occurred while preparing
this proposal. The previous owned PostgreSQL startup/bootstrap command was
rejected by automatic approval review as "blocked by policy", without a more
specific reason. Direct owner confirmation is being requested before a further
attempt; it does not guarantee that automatic review will permit the command.
If the retry is rejected, stop that action and retain the rejection. Do not use
an alternate tool/launcher or change permission settings to evade it.

## Verified target before asking

- Control binary: `C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe`, reports18.6.
- Existing owned data directory:
  `C:\Users\USER\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\completion-pg`.
  Resolved path matches, Directory attribute without reparse point, PG_VERSION18.
- No postmaster.pid, standby.signal or recovery.signal exists.
- No listener was observed on55432. Recheck immediately before launch.
- No active overriding data_directory/hba_file/ident_file/port/listen_addresses/
  include/external_pid_file/preload setting was found in postgresql.conf or
  postgresql.auto.conf by the bounded configuration check.
- R00/LOCAL-TARGET.md identifies this same synthetic cluster, role pfa_campaign,
  loopback127.0.0.1:55432, UTC. The shared localhost5432/finance_app endpoint is
  outside the action and must not be connected to, modified or stopped.

## Concrete startup action after confirmation

Use the existing exec_command tool and the documented hidden pg_ctl launch style.
This is a foreground wait for the short control process, with explicit log files;
it is not a new launcher or a permission override. Revalidate that the data path
and listener/PID state still match before creating the log packet and launching:

```powershell
$taskPgData = 'C:\Users\USER\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\completion-pg'
$taskPgLog = 'C:\Users\USER\.codex\worktrees\capital-completion-v2\personal-finance-app\.local\runtime-retry-oct31a'
New-Item -ItemType Directory -Path $taskPgLog -ErrorAction Stop | Out-Null
$taskPgControl = Start-Process -FilePath 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -ArgumentList @(
  '-D', $taskPgData, '-l', "$taskPgLog\postgres.log",
  '-o', '"-p 55432 -h 127.0.0.1"', '-w', '-t', '30', 'start'
) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput "$taskPgLog\start.stdout.log" -RedirectStandardError "$taskPgLog\start.stderr.log"
if ($taskPgControl.ExitCode -ne 0) { throw 'Owned PostgreSQL startup failed; inspect retained logs before any retry' }
```

After launch, independently verify PID/data directory, loopback/port, PostgreSQL
version and UTC using explicit synthetic connection parameters. Abort dependent
work on any mismatch. Never kill an unrecognized process or restart a live server
merely because an observation timed out. Stop the owned cluster after the
serialized evidence window using its verified identity.

## Subsequent already-planned test scope

Use only existing protected target tooling, explicit run manifests, unique
disposable database names and matching markers. Do not use ambient DATABASE_URL
or create an unmarked target. Apply versioned migrations, not schema push.

- C2 corrected d6ee653a: existing import/tag/email guards plus new atomic bulk
  audit/rollback tests and credential/cross-tab browser journeys.
- R04 port777cf5b7: signed HTTP/SQL null/omitted/private/role controls, then the
  Shared selection/filter/reload/login browser journey.
- R14 d938529c: empty/populated additive migration rehearsal and the documented
  constraint/corruption/lease/fence/100-101/query-plan controls on separate targets.

Allocate these serially after the current R20 focused native window is complete.
The exact candidate/manifest/migration/source pins and outcomes must be recorded
for each run. A successful startup does not certify any test or production setup.
No real messages, paid providers, production/shared databases, remote publication,
main merge, deployment or release is included.

## Owner authorization and retry, 1 November 2026

The owner explicitly answered "Authorize the local test retry" to the question
covering this owned cluster and prepared protected database/browser checks.
The previous approval-review rejection remains historical evidence; this direct
answer resolves the pending owner question, not any production or release gate.

Revalidation found the same non-reparse data directory, PG_VERSION18, no PID or
recovery marker, no observed listener on55432 and no active configuration override.
The documented hidden pg_ctl startup reported success. Independent psql readback
confirmed owned PID16024's cluster at127.0.0.1:55432, rolepfa_campaign, PostgreSQL18.6,
expected data_directory and UTC. Evidence: `.local/runtime-retry-nov01a/`.
The startup observation handle remains live while PostgreSQL descendants run;
this is not a failed startup or permission to launch another server.

C2 correctiond6ee653a is the first serialized acceptance window. Its new marked
disposable targetpfa_completion_review_c2nov01a1_test was created with15 versioned
migrations. C2 author packet: `.local/c2/coordinator-db-nov01a/`. Test results and
final cleanup are recorded separately after execution; startup is not acceptance.
