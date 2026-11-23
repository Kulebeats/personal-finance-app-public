Run from the candidate repository root through its protected runner:

```powershell
node scripts/run-protected-tests.mjs unit tsx client/src/components/layout/__tests__/browser/ApplicationNavigation.browser.mjs
```

The parent may set `PFA_COMPONENT_BROWSER_EXECUTABLE` to an installed compatible
Chromium binary. The selected path is hashed and passed explicitly to launch;
otherwise `chromium.executablePath()` supplies that same recorded launch target.

The parent owns execution. This fixture serves actual Layout, Sidebar, TopBar,
ThemeToggle, NotificationBell, ProfileMenu, Wouter, both Sheets and SettingsLayout.
Wouter uses actual browser location/history against the owned Vite SPA fixture.
The route owner subscribes above Suspense, matching App.tsx's session-route owner.
Effectful hooks/API/protected media and GoalMilestoneModal are inert. The widest
partner account selector is present. There is no application server, auth session,
database, financial state, external provider, actual phone or browser zoom proof.

Geometry covers320/360/375/390/767/768/1280 and375x320, with reachable links,
painted keyboard focus, both Tab directions, background scroll lock, Escape,
Close and outside dismissal. Separate remounting route fixtures check same-route,
cross-route, external route changes, unresolved lazy destinations, desktop
preference, breakpoint closure/reversal, hidden focused controls, preserved main
focus and sequential Settings drawers. The lazy import is resolved explicitly
after the actual exit completes, so focus cannot pass through synchronous timing.

Each execution preserves a unique `.local/r18-app-navigation/browser-*/result.json`,
selected screenshots, failure screenshots/HTML, executable identity and runtime
cleanup evidence. Failed packets must be retained and diagnosed before rerunning.

Default execution includes all geometry and focus cases, including navigation to a
cold lazy destination during Escape, Close and same-route selection exit. The
optional `--exit-route-only` argument runs only those three regressions and records
`scenarioSelection: "exit-route-only"`; it is not complete browser acceptance.
