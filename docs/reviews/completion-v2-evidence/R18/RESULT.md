# R18 settings navigation component checkpoint

Status: OPEN. This packet does not close UX-02, NEW-37 or any supporting group.
The governing requirements remain the master completion specification v2.5,
R18.1 and R18.3. R02/R03/R05 completion dependencies and full-workflow acceptance
remain pending.

## Integrated settings slice

General and final Astra review approved revision R2 after both resize/focus
findings were repaired. Author commit `04c1914f37ed1f0487a5b79b1c5590739a97b78c`
was integrated as `ab6303318bb78374430a5bd6996c4c9acb294cd8`. All eight reviewed
files match after line-ending normalization. Fresh canonical verification passed
6/6 actual-component tests (16.00 s) and `npm run check`; logs and parity receipt
are under `.local/r18-settings-integrated-oct29/`.

The frozen author receipt is `.local/r18-settings-oct29/freeze-receipt-r2.json`,
SHA-256 `846e4ea3eaef911f83f63061a49a70c6f174f32f3ed709c1934df91a4fe72b7c`.
Its actual component-browser result is
`browser-d2ea9309-35c7-4286-a87e-51df3b9bc1cd/result.json`, SHA-256
`a3ca6b7cec648c2126701336b9b4651b65de9e8d8c9b3c90e83d86dd2f08bd61`.
Eight viewport/proxy scenarios passed, along with breakpoint focus, rapid
desktop/mobile reversal, and Escape/selection/Close followed by desktop resize
during a forced 600 ms exit animation. The browser disconnected; recorded page
errors and forbidden requests were empty. Parent visual inspection of the 320px
selection screenshot showed the component content within the viewport.

Final review noted one nonblocking test-hardening opportunity: the selection
resize assertion can be strengthened by targeting the desktop navigation locator
after the dialog disappears, rather than the shared aria-label. This did not
block the inspected fix. Do not treat these tests as complete accessibility,
real-shell, authenticated-route or browser-zoom acceptance.

The sections below preserve the earlier candidate/failure history. This
integration supersedes their initial pending source-review status only.

## Candidate scope and ownership

The isolated author checkout is
`C:\Users\USER\.codex\worktrees\capital-r18-settings\personal-finance-app`,
branch `codex/capital-r18-settings`, based on `851c1c14`. Changes are limited to
SettingsLayout, its focused component tests and an isolated browser fixture.
All ten settings sections, selection callback ownership and logout behavior are
preserved. The application shell, authentication, query and financial contracts
are outside this slice.

The candidate adds a named settings dialog, controlled selection/close behavior,
a menu trigger in normal layout flow, bounded scrolling, visible focus indicators,
touch targets and focus restoration across the mobile/desktop breakpoint. It
removes the nested main landmark. No source integration is recorded yet.

## Evidence and review so far

Six tests against the real SettingsLayout and Sheet failed on the original
component and passed on the first candidate. The shell and API dependencies are
inert. The logs are preserved in the author checkout's
`.local/r18-settings-oct29/`; these early passes predate the later resize repair.

Independent review found a remaining focus defect: switching to desktop starts
drawer closure, but switching back to mobile before the close callback could
focus the now-hidden desktop navigation. The repair checks the current viewport
at callback time; regression and final review remain pending at this checkpoint.

The initial author stalled during browser-fixture preparation without a browser
run. Its work was preserved and the agent interrupted. A second Sol implementer
resumed the same checkout and executed the fixture. The first actual run failed
a premature focus assertion after Escape; the next exposed missing responsive
CSS in the isolated fixture's Tailwind source scan. Failed runs remain under
`.local/r18-settings-oct29/browser-*/` and are not acceptance evidence. The fixture
and current candidate are being verified before review/integration.

## Required acceptance still outstanding

- Actual 200% browser zoom and recorded device/screen-reader journeys. Smaller
  viewport or DPR proxies must not be reported as actual browser zoom.
- Real authenticated application-route behavior, all applicable offered controls,
  first-run/query states and R18's remaining workflows. An inert component fixture
  establishes no backend, persistence or production-profile evidence.

No production-readiness or release conclusion follows from this component slice.

## Profile first-save validation slice integrated

The next NEW-37 slice reproduced a first-save failure using the actual ProfileForm,
useProfileForm, React Hook Form and Zod, with API mutation/toast boundaries mocked.
With a missing required gender and no prior blur, the original handler read its
render-captured empty errors after validation and showed a generic unexpected
error. No mutation was reached. The repair consumes the fresh invalid callback,
shows field-specific feedback and directs focus to the relevant tab/control.

General and final Astra review also corrected an introduced save-failure message:
mutation rejection does not prove a write failed to commit. The final message
says the save could not be confirmed and asks the user to refresh before retrying.
No profile schema, server persistence, authorization or financial policy changed.

Author `7a953c2871ebac6018e1cbca1742f2002a32c110` was integrated as
`a22e9f18c89c03534a95bbadfb6bf9c6851211ac`. All three reviewed files match after
line-ending normalization. Fresh canonical checks passed 13/13 tests (19.97 s)
and `npm run check`; logs/parity receipt are in
`.local/r18-profile-integrated-oct29/`.

Author freeze: `.local/r18-settings-oct29/profile-new37-freeze-r2.json`, SHA-256
`1effb821b9c95ec6dba7f7efb9c452174d43477db97bf70c6b020255ef6ecc70`.
Tests cover first-invalid-save feedback/focus/no mutation, financial-tab error
navigation, valid mutation once and uncertain rejected-mutation feedback. These
are component/validation checks, not real HTTP/DB save or read-back evidence.
AH-07/SET-01 profile-field persistence and full NEW-37 remain OPEN.
