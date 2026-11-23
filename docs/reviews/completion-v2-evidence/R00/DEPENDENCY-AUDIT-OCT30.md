# Production dependency audit,30 October2026

Read-only audit at canonical HEAD545c3004f6729a3d3274e5a2b994a1a40636e770.
Pinned Node24.22.0 ran `npm audit --omit=dev --json`; exit1 reports six affected
packages, four high and two moderate, with no critical finding. This confirms the
previous non-green disposition remains current. It does not demonstrate exploit
reachability or absence of other vulnerabilities. No install, lockfile/package
change, lifecycle script or external application service was invoked.

| Locked package | Version | npm severity | Follow-up |
|---|---|---|---|
| body-parser | 1.20.8 | high | Advisory lists 1.20.9 as the patched 1.x release |
| multer | 2.4.0 | high | Advisory lists 2.5.0 as patched |
| nodemailer | 10.1.1 | moderate | Audit reports an available compatible fix; verify chosen exact release before implementation |
| qs | 6.16.0 | moderate | Audit reports an available compatible fix; verify chosen exact release before implementation |
| zod | 3.25.76 | high | Patched line starts4.6.6; audit proposes4.6.7 as a major upgrade |
| zod-validation-error | 3.5.4 | high, via zod | Audit proposes5.0.0 as a major upgrade |

Primary advisory pages were opened and verified on this turn:
[body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[multer](https://github.com/advisories/GHSA-q7qp-rjg7-q26m), and
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Raw audit includes the other advisory URLs and exact affected node paths.

Evidence: `.local/r00-dependency-review-oct30/` contains audit.json, stderr,
exit code, detailed findings, exact locked versions/integrities and a receipt
pinning package.json/package-lock.json/audit bytes. Receipt SHA256:
`8b2650d0f4aa888e7a83920743eee5f4c89ad2bb50dc35bf3cb7b9c5d46e062a`.
An initial read-only PowerShell lockfile parse failed because the lock contains
an empty root package key; using ConvertFrom-Json -AsHashtable resolved it. No
null-version output from that failed parse is used as evidence.

Next dependency work must be isolated from canonical node_modules and the frozen
runtime inventories. Parent owns package/lock scheduling. Review exact dependency
and lock changes, install into a private target, run meaningful affected parser,
upload, mail/validation and static tests, then refresh build/installed inventory
evidence for those new bytes. The Zod major migration also needs inspection of
schema, Drizzle/form adapters and validation-error compatibility; a forced audit
fix is not an implementation or acceptance plan. Do not relabel old installed
runtime evidence as covering upgraded packages. Security findings and full R00/R20
closure remain OPEN while the application-root architecture checkpoint proceeds.
