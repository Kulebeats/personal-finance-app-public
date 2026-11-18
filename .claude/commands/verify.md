---
description: Run full verification suite for P4 changes
allowed-tools: Bash(npm run check:*), Bash(npm run test:*)
---

# Verification Checklist

Run the full P4 verification suite:

1. **TypeScript check:** `npm run check`
2. **Client tests:** `npm run test:run`
3. **Server tests:** `npm run test:server:run`

Report any failures with exact error output and file:line references.

If all pass, confirm with a summary like:
```
✅ TypeScript: PASS
✅ Client tests: PASS (X tests)
✅ Server tests: PASS (X tests)
```
