# R00 limiter wiring repair

Status: implemented and locally verified with isolated HTTP fixtures; independent review pending. NEW-08 and R00 are not CLOSED.

## Scope and policy

Baseline wiring was inherited from runtime/target runner commits through 7c05e5b on codex/capital-r00-runtime. General API limiting remains at the actual global mount in server/routes.ts. Removed 25 duplicate API router imports/mounts (15 module routers and 10 legacy/nested routers, including security and security.sessions). The separate public /health router retains its general limiter. Removed duplicate root analytics mounts for reports and weekly recap; their existing router/endpoint analytics tiers remain.

The broad /api/auth mount no longer charges credential quota. The eight existing credential POSTs (register, login, MFA verify/resend, email verify/resend, forgot/reset password) each apply the existing IP-auth and auth tiers once. Password recovery/reset retain their separate strict tier. GET /me, POST /logout, wrong methods and unknown auth paths inherit only general API accounting.

No numeric production limit changed: general 100/minute; IP-auth 5/minute; auth 10/minute; analytics 30/minute; expensive analytics 10/minute; upload and strict tiers unchanged. The companion's 600-per-minute proposal is not an approved production default. Its 200 ordinary requests in one window oracle therefore cannot be claimed with the retained 100 threshold. Capacity ratification and a controlled production-mode load profile remain required. Session/account-lockout response behavior is unchanged and not independently proven here.

## Behavioral red then green

Standalone committed scripts/__tests__/limiters.test.mjs transpiles and executes the actual TypeScript route registration and limiter source using real Express, express-rate-limit and Supertest loopback HTTP. Controller, auth, logging and Redis dependencies are inert synthetic adapters. It imports no application bootstrap, dotenv, database, provider or real messaging transport. NODE_ENV=development activates actual limiters. Synthetic user headers only establish a controlled req.user in this fixture; they do not prove production authentication binding.

Before repair: first notification request had general remaining98 rather than99; repeated /me and logout produced429; first login had auth remaining8 rather than9. A separate report regression before analytics repair had remaining28 rather than29. These were assertion failures, not environment errors. Source-wiring guard also found the 25 duplicate API routers.

After repair on native Windows ARM64 Node24.22.0: npm run test:limiters passed 6/6, zero skipped. Oracles: ordinary requests1-100 succeed and101 returns429/Retry-After; a different synthetic user retains its own general quota; repeated /me/logout leave five shared-IP credential attempts, the sixth blocks across distinct synthetic users; auth quota independently permits10 and blocks11; all eight credential POSTs throttle at shared-IP6 while wrong methods/unknown paths do not consume the quota; reports and recap permit30 and block31, expensive report permits10 and blocks11; static source guard preserves public health and prevents API duplicates.

Adjacent protected no-DB command npm run test:server:unit -- middleware/__tests__/rateLimit.wiring.test.ts modules/auth/__tests__/auth.ratelimit.test.ts passed 2 files /13 tests. npm run check passed, including TypeScript, LOC ratchet (0 new/grown oversized files), script syntax and metadata/template guards. Three existing DB suite wiring assertions (merchants, rules, weekly recap) now require inherited general limiting rather than a duplicate mount; those DB suites were not run here. Parent owns integrated serial suites after review. No DB target or server was contacted.

## Remaining proof

This establishes local request accounting with an in-memory store and inert controllers. It does not prove Redis namespace behavior, distributed/multi-instance counts, production bootstrap fail-closed behavior, full browser shared-IP onboarding, production session binding, hosted runtime identity, numeric load capacity or packet closure. Redis, target safety follow-ups and integrated candidate evidence have separate owners. No production/shared writes, paid calls, real messages, deployment, push or merge occurred.

## Addendum 2026-11-17: tier sizes (lane safe-small-fixes, NEW-08)

The wiring above already removed the double mounting and kept `/me` and `/logout` off the credential tiers. This change applies the R00.3 sizes: general 600 per user per 60 s window (IP key when anonymous) and `ipAuthLimiter` 10 per minute per IP. Both are D22 proposals, labelled as such in `server/middleware/rateLimit.ts`, and are not ratified for production. The spec gives no number for auth (10/min), analytics (30/min), expensive analytics (10/min), strict (5/min) or upload (20/h), so those keep their earlier values. `ipAuthLimiter` keeps its current eight credential POSTs; the spec names five.

`scripts/__tests__/limiters.test.mjs` adds the spec's navigation oracle: one login, then five bursts of 40 concurrent requests in one window. None return 429, and `ratelimit-remaining` stays at or above 300. The exhaustion test is now 600 allowed, then the 601st blocked with `Retry-After`. Login trips on attempt 11 per IP. Before the size change the new tests failed (429 inside the bursts, limit 100, sixth credential attempt blocked). After it, 7/7 pass.
