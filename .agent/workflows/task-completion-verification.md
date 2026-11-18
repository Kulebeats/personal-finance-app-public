---
description: Quality gate checklist before marking any task as complete
---

# Task Completion Verification Workflow

Before marking ANY task as complete, run through this checklist:

## 1. Code Implementation Check

- [ ] Open the actual source file(s) and verify implementation is NOT a stub
- [ ] Confirm no `TODO`, `FIXME`, or `// stub` comments in critical paths
- [ ] Verify function returns real data, not empty arrays `[]` or `undefined`

## 2. Security Check (if applicable)

- [ ] Privacy filtering (`is_private`) applied in queries
- [ ] Tenant scoping (`household_id`) enforced
- [ ] No hardcoded secrets or fallback values
- [ ] Input validation present

## 3. Integration Check

- [ ] Frontend hooks are actually IMPORTED by pages (not just existing in hooks folder)
- [ ] API endpoints are registered in router AND called by frontend
- [ ] Cache invalidation is WIRED to mutations (not just defined)

## 4. Automation Check (if applicable)

- [ ] Scheduled jobs have a trigger mechanism (cron endpoint, BullMQ job, etc.)
- [ ] Workers are called somewhere in the codebase (search for function calls)

## 5. Test Verification

- [ ] Run `npm run test:server:run` and confirm relevant tests pass
- [ ] If tests fail, note which ones and why

## 6. Explicit Confirmation

When reporting task completion, include:

```
VERIFIED:
- File: [path]
- Lines: [X-Y]
- Evidence: [what I checked]
- Tests: [pass/fail/N/A]
```

// turbo-all
