# Dependency Upgrade Plan

**Generated:** 2026-01-28
**Analysis Only** - Do not upgrade without scheduling maintenance window

---

## Executive Summary

| Category | Count | Status |
|----------|-------|--------|
| Security Vulnerabilities | 4 | Moderate severity (all in drizzle-kit transitive deps) |
| Major Version Upgrades Available | 8 | React 19, Express 5, Zod 4, etc. |
| Minor/Patch Updates Available | 12+ | Low risk |
| Total Outdated Packages | 20 | Per npm outdated |

**Recommendation:** Address security vulnerabilities first via drizzle-kit update, then plan major upgrades in phases.

---

## Security Vulnerabilities

### CRITICAL - Address Immediately

| Package | Severity | Issue | Fix |
|---------|----------|-------|-----|
| esbuild | Moderate | CVE: GHSA-67mh-4wv8-2f99 - Development server request forgery | Update drizzle-kit |
| @esbuild-kit/core-utils | Moderate | Depends on vulnerable esbuild | Update drizzle-kit |
| @esbuild-kit/esm-loader | Moderate | Depends on vulnerable @esbuild-kit/core-utils | Update drizzle-kit |
| drizzle-kit | Moderate | Uses vulnerable transitive dependencies | Update to latest |

**Current:** `drizzle-kit@0.31.8`
**Latest:** `drizzle-kit@0.31.8` (same version, but transitive deps need resolution)

**Note:** The vulnerability is in development tooling only (esbuild), not production code. Risk is limited to development environments. However, should still be addressed.

**Resolution Path:**
```bash
# After maintenance window scheduled:
npm audit fix --force
# OR
npm update drizzle-kit
```

---

## Major Version Upgrades (Breaking Changes)

### 1. React 18 -> 19 (HIGH RISK)

| Attribute | Value |
|-----------|-------|
| Current | 18.3.1 |
| Latest | 19.2.4 |
| Risk Level | HIGH |
| Estimated Effort | 8-16 hours |

**Breaking Changes in React 19:**
- Removal of deprecated APIs (e.g., `defaultProps` on function components)
- `useContext()` no longer accepts second argument
- Strict mode behavior changes
- Ref callback cleanup (refs now get cleanup functions)
- `ReactDOM.render()` removed (we use createRoot, should be fine)
- `propTypes` no longer checked in production

**Dependencies to Update Together:**
- `@types/react` 18.3.27 -> 19.2.10
- `@types/react-dom` 18.3.7 -> 19.2.3
- All `@radix-ui/*` packages (check compatibility)
- `react-hook-form` (check compatibility)
- `@tanstack/react-query` (check compatibility)
- `recharts` (supports React 19)
- `@nivo/*` packages (check compatibility)

**Testing Required:**
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual smoke test of all major pages
- [ ] Check console for deprecation warnings
- [ ] Verify all forms work correctly
- [ ] Verify all charts render

---

### 2. Express 4 -> 5 (HIGH RISK)

| Attribute | Value |
|-----------|-------|
| Current | 4.22.1 |
| Latest | 5.2.1 |
| Risk Level | HIGH |
| Estimated Effort | 4-8 hours |

**Breaking Changes in Express 5:**
- `app.del()` removed (use `app.delete()`)
- `app.param(callback)` removed
- Pluralized method names (`req.acceptsCharset()` -> `req.acceptsCharsets()`)
- `res.json(obj, status)` signature changed
- `res.jsonp(obj, status)` signature changed
- `res.send(body, status)` signature changed
- `res.send(status)` removed (use `res.sendStatus()`)
- `res.sendfile()` removed (use `res.sendFile()`)
- Promise rejection handling changed (async errors auto-forwarded)
- `req.host` now includes port
- `req.query` can be configured differently
- Path route matching more strict

**Dependencies to Update Together:**
- `@types/express` 4.17.21 -> 5.0.6
- Check all middleware compatibility:
  - `express-session` (check v5 compatibility)
  - `express-rate-limit` (check v5 compatibility)
  - `helmet` (should work)
  - `cors` (should work)
  - `passport` (check compatibility)

**Testing Required:**
- [ ] All API endpoints tested
- [ ] Authentication flows work
- [ ] Rate limiting works
- [ ] Session management works
- [ ] Error handling works correctly
- [ ] All middleware executes in correct order

---

### 3. Zod 3 -> 4 (MEDIUM-HIGH RISK)

| Attribute | Value |
|-----------|-------|
| Current | 3.25.76 |
| Latest | 4.3.6 |
| Risk Level | MEDIUM-HIGH |
| Estimated Effort | 4-8 hours |

**Breaking Changes in Zod 4:**
- Error formatting changes
- Some utility types renamed/removed
- `z.ZodIssue` structure changes
- `safeParse` result structure changes
- Some schema methods renamed
- `z.nativeEnum` behavior changes

**Impacted Code:**
- All `*.validation.ts` files in server/modules/
- All Zod schemas in shared/schema.ts
- Error message formatting in controllers
- drizzle-zod integration (need to check compatibility)

**Dependencies to Update Together:**
- `zod-validation-error` 3.5.4 -> 5.0.0 (major version, breaking changes)
- `drizzle-zod` 0.7.1 -> 0.8.3 (check Zod 4 compatibility)
- `@hookform/resolvers` 3.10.0 -> 5.2.2 (major version)

**Testing Required:**
- [ ] All validation schemas work
- [ ] Error messages display correctly
- [ ] Form validation works on client
- [ ] API validation works on server

---

### 4. date-fns 3 -> 4 (MEDIUM RISK)

| Attribute | Value |
|-----------|-------|
| Current | 3.6.0 |
| Latest | 4.1.0 |
| Risk Level | MEDIUM |
| Estimated Effort | 2-4 hours |

**Breaking Changes in date-fns 4:**
- Dropped `Date` type extensions
- Some functions removed/renamed
- Locale handling changes
- Timezone handling improvements

**Testing Required:**
- [ ] All date formatting works
- [ ] Date calculations in reports work
- [ ] Budget period calculations work
- [ ] Recurring transaction date logic works

---

### 5. Recharts 2 -> 3 (MEDIUM RISK)

| Attribute | Value |
|-----------|-------|
| Current | 2.15.4 |
| Latest | 3.7.0 |
| Risk Level | MEDIUM |
| Estimated Effort | 2-4 hours |

**Note:** Recharts 3 supports React 16-19, so can upgrade independently or with React.

**Breaking Changes:**
- Component API changes
- Animation behavior changes
- Some prop names changed

**Testing Required:**
- [ ] All charts render correctly
- [ ] Dashboard widgets display properly
- [ ] Reports page charts work
- [ ] Tooltips work

---

### 6. Drizzle ORM 0.39 -> 0.45 (MEDIUM RISK)

| Attribute | Value |
|-----------|-------|
| Current | 0.39.3 |
| Latest | 0.45.1 |
| Risk Level | MEDIUM |
| Estimated Effort | 2-4 hours |

**Changes:**
- Query builder improvements
- New features (may not need migration)
- Potential schema generation changes

**Dependencies to Update Together:**
- `drizzle-kit` (for migrations)
- `drizzle-zod` (for schema integration)

**Testing Required:**
- [ ] All database queries work
- [ ] Migrations run correctly
- [ ] Schema generation works

---

### 7. @hookform/resolvers 3 -> 5 (MEDIUM RISK)

| Attribute | Value |
|-----------|-------|
| Current | 3.10.0 |
| Latest | 5.2.2 |
| Risk Level | MEDIUM |
| Estimated Effort | 1-2 hours |

**Note:** Skipped v4, so check both v4 and v5 breaking changes.

**Dependencies:** Must update alongside Zod if using zodResolver.

---

### 8. @neondatabase/serverless 0.10 -> 1.0 (LOW-MEDIUM RISK)

| Attribute | Value |
|-----------|-------|
| Current | 0.10.4 |
| Latest | 1.0.2 |
| Risk Level | LOW-MEDIUM |
| Estimated Effort | 1 hour |

**Note:** Major version bump (0.x to 1.x) may have API changes. Review changelog.

---

## Minor/Patch Updates (Safe to Upgrade)

These can generally be upgraded with minimal risk:

| Package | Current | Latest | Risk |
|---------|---------|--------|------|
| TypeScript | 5.6.3 | 5.9.3 | LOW (minor) |
| Vite | 7.1.9 | 7.3.1 | LOW (minor) |
| Vitest | 4.0.15 | 4.0.18 | LOW (patch) |
| @tanstack/react-query | 5.60.5 | 5.90.20 | LOW (minor) |
| lucide-react | 0.545.0 | 0.563.0 | LOW (minor) |
| esbuild | 0.25.12 | 0.27.2 | LOW (minor) |
| @types/node | 20.19.30 | 25.0.10 | MEDIUM (major Node types) |
| react-resizable-panels | 2.1.9 | 4.5.2 | MEDIUM (major) |

---

## Recommended Upgrade Order

### Phase 1: Security Fixes (Do First)
1. Update `drizzle-kit` to resolve transitive esbuild vulnerability
2. Run `npm audit` to verify resolution

### Phase 2: Safe Minor Updates
1. TypeScript 5.6 -> 5.9
2. Vite 7.1 -> 7.3
3. Vitest 4.0.15 -> 4.0.18
4. @tanstack/react-query 5.60 -> 5.90
5. lucide-react update
6. esbuild update

### Phase 3: Drizzle Ecosystem
1. drizzle-orm 0.39 -> 0.45
2. drizzle-zod 0.7 -> 0.8
3. Run full database test suite

### Phase 4: Zod Ecosystem (Coordinate Together)
1. Zod 3 -> 4
2. zod-validation-error 3 -> 5
3. @hookform/resolvers 3 -> 5
4. Update all validation schemas
5. Full test suite run

### Phase 5: date-fns & Charts
1. date-fns 3 -> 4
2. recharts 2 -> 3
3. Test all date operations and charts

### Phase 6: Express 5 (Major Backend Change)
1. Express 4 -> 5
2. @types/express update
3. Full API test suite
4. Manual endpoint testing

### Phase 7: React 19 (Major Frontend Change)
1. React 18 -> 19
2. react-dom 18 -> 19
3. @types/react, @types/react-dom
4. Verify all Radix UI components work
5. Verify all third-party React components
6. Full frontend test suite
7. Manual UI testing

---

## Pre-Upgrade Checklist

Before any upgrade:

- [ ] All tests passing (`npm run check && npm run test:run && npm run test:server:run`)
- [ ] Clean git state (no uncommitted changes)
- [ ] Database backup if touching Drizzle
- [ ] Create feature branch for upgrade work
- [ ] Document current functionality with screenshots (for UI changes)
- [ ] Review changelog for each package being upgraded
- [ ] Check GitHub issues for known upgrade problems

---

## Post-Upgrade Verification

After each phase:

- [ ] `npm run check` passes
- [ ] `npm run test:run` passes
- [ ] `npm run test:server:run` passes
- [ ] `npm audit` shows no new vulnerabilities
- [ ] Manual smoke test of affected features
- [ ] No console errors/warnings in development
- [ ] Production build succeeds (`npm run build`)

---

## Dependencies NOT to Upgrade

These should stay pinned or require careful consideration:

| Package | Reason |
|---------|--------|
| `passport` | 0.7.0 is stable, authentication is critical |
| `passport-local` | 1.0.0 is stable, avoid auth changes |
| `@replit/*` plugins | Replit-specific, follow their guidance |

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1 (Security) | 1 hour | None |
| Phase 2 (Minor) | 2 hours | None |
| Phase 3 (Drizzle) | 2-4 hours | Phase 1-2 |
| Phase 4 (Zod) | 4-8 hours | Phase 3 |
| Phase 5 (date/charts) | 2-4 hours | Phase 4 |
| Phase 6 (Express) | 4-8 hours | Phase 5 |
| Phase 7 (React) | 8-16 hours | Phase 6 |

**Total Estimated Time:** 23-43 hours over multiple sessions

**Recommendation:** Spread over 2-3 weeks, one phase per session, with time for regression testing between phases.

---

## Notes

1. **Do NOT run `npm update` blindly** - this can cause cascading breaks
2. **Test in development first** - never upgrade directly in production
3. **Keep a rollback plan** - git stash or branch before each phase
4. **Monitor after deploy** - watch error logs for 24-48 hours post-upgrade
5. **Document any workarounds** - if a package has issues, document for future reference

---

## References

- [React 19 Upgrade Guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide)
- [Express 5 Migration Guide](https://expressjs.com/en/guide/migrating-5.html)
- [Zod Changelog](https://github.com/colinhacks/zod/releases)
- [Drizzle ORM Changelog](https://github.com/drizzle-team/drizzle-orm/releases)
- [date-fns Changelog](https://github.com/date-fns/date-fns/releases)
