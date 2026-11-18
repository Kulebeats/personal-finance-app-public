# Thandiso Thandiso AI Assistant Code Audit Report

> **HISTORICAL — 2026-07-12 status note.** This Jan-2026 audit of externally-suggested
> code predates the shipped implementation and its remediation. Current assessment:
> `docs/reviews/ai-assistant/ai-assistant-module-assessment.md` (86/100 provisional,
> 2026-07-06). Code-verified contract:
> `docs/ai-integration/specifications/ai-assistant-api-spec.md`. Retained for history.

**Document Version:** 1.1
**Date:** 2026-01-29
**Status:** Historical (was: Revised)
**Audit Type:** Code Review against CLAUDE.md Standards

---

## Executive Summary

This document audits the Gemini Thandiso Thandiso AI Assistant implementation code suggestions (from external conversation) against the Personal Finance App's [CLAUDE.md](../../../CLAUDE.md) standards and enterprise architecture patterns.

### Audit Verdict

| Category | Status | Critical Issues |
|----------|--------|-----------------|
| **Money Class Usage** | FAIL | Does not use Money class for currency |
| **LOC Limits** | FAIL | Single 250+ LOC file violates <500 LOC guideline |
| **Audit Logging** | FAIL | No audit logging for AI queries |
| **Architecture** | FAIL | Not following modular routes pattern |
| **Error Handling** | WARNING | Basic error handling, no AppError |
| **Security** | WARNING | No rate limiting per household |
| **Type Safety** | WARNING | Uses `any` types extensively |

**Overall Score:** 15/100 (Major rework required)

---

## 1. Critical Rule Violations

### 1.1 Money/Arithmetic Rule (HIGH RISK)

**Rule:** NEVER use `parseFloat()`, `Math.round()`, or `Number()` for financial calculations.

**Violation Found:**
```typescript
// BAD CODE from suggestion
async function spendingByCategory(householdId: string, period: string): Promise<any> {
  return [
    { category: "Transport", amount: 1250.00 },  //  Raw number
    { category: "Groceries", amount: 850.00 },   //  Raw number
  ];
}
```

**Required Fix:**
```typescript
// CORRECT: Use Money class from server/core/money.ts
import { Money } from '../core/money';

async function spendingByCategory(
  householdId: string,
  period: string,
  currency: string
): Promise<Array<{ category: string; amount: Money }>> {
  const results = await db.query(/* SQL */);
  return results.map(r => ({
    category: r.category,
    amount: Money.from(r.amount, currency)  //  Use Money class
  }));
}
```

**Risk:** Floating-point calculation errors in financial data returned to AI assistant could compound into incorrect advice.

---

### 1.2 LOC Limits Violation

**Rule:** Server files must be <500 LOC.

**Violation:**
- Suggested `server/routes/ai.ts` would be ~250 LOC (within limit but approaching threshold)
- Does not follow modular pattern used by existing codebase

**Required Fix:** Split into modular structure:
```
server/modules/ai/
├── ai.controller.ts         (< 500 LOC)
├── ai.service.ts            (< 500 LOC)
├── ai.validation.ts         (< 100 LOC)
├── ai.routes.ts             (< 100 LOC)
├── ai.tools.ts              (< 300 LOC)
└── README.md
```

---

### 1.3 Missing Audit Logging

**Rule:** All financial writes must call `BusinessAuditService`.

**Violation:**
```typescript
// BAD: No audit logging in AI endpoint
router.post('/chat', async (req, res) => {
  const result = await chat.sendMessage(messages[messages.length - 1].content!);
  //  No audit log of what data was queried
  res.json({ reply: finalResponse });
});
```

**Required Fix:**
```typescript
import { BusinessAuditService } from '../services/BusinessAuditService';
const auditService = new BusinessAuditService();

router.post('/chat', async (req, res) => {
  const result = await chat.sendMessage(userMessage);

  //  Audit all AI queries for compliance
  await auditService.log({
    householdId: req.user!.householdId,
    userId: req.user!.id,
    action: 'CREATE',
    entityType: 'ai_query',  // Add to AuditEntityType
    entityId: generateId(),
    details: {
      query: userMessage,
      tools_used: toolCalls.map(t => t.name),
      response_summary: finalResponse.substring(0, 200)
    },
    ipAddress: req.ip
  });

  res.json({ reply: finalResponse });
});
```

**Risk:** Regulatory compliance requires audit trail of all financial data access.

---

## 2. Architectural Issues

### 2.1 Not Following Modular Routes Pattern

**Current Pattern:**
```
server/modules/goals/
├── goals.controller.ts
├── goals.service.ts
├── goals.validation.ts
├── goals.routes.ts
└── index.ts
```

**Suggested Code:** Single `server/routes/ai.ts` file (violates pattern)

**Required Fix:** Follow existing modular pattern documented in [CLAUDE.md:57-62](../../../CLAUDE.md#L57-L62)

---

### 2.2 Missing Service Layer

**Violation:** Tools directly execute database queries in route handler

**Required Fix:**
```
server/modules/ai/
├── ai.controller.ts       # HTTP handlers
├── ai.service.ts          # Business logic (tool execution)
├── ai.analytics.service.ts # Analytics queries
└── ai.tools.ts            # Tool definitions
```

**Principle:** No direct DB access in controllers – use services/repositories

---

## 3. Security Issues

### 3.1 Missing Rate Limiting

**Suggested Code:**
```typescript
if (!await rateLimitCheck(userId)) {
  return res.status(429).json({ error: "Daily limit reached" });
}
```

**Issues:**
-  Rate limit by `userId` instead of `householdId`
-  No implementation of `rateLimitCheck` function
-  Hard-coded 20/day limit not configurable

**Required Fix:**
```typescript
import { RateLimiterMemory } from 'rate-limiter-flexible';

const aiRateLimiter = new RateLimiterMemory({
  points: 50,        // 50 queries per household
  duration: 86400,   // Per day
});

// In middleware
const key = `ai:${req.user!.householdId}`;
try {
  await aiRateLimiter.consume(key);
} catch (rejRes) {
  return res.status(429).json({
    error: "AI query limit reached. Try again tomorrow.",
    retryAfter: rejRes.msBeforeNext
  });
}
```

---

### 3.2 Missing Input Validation

**Violation:** No Zod validation schema

**Required Fix:**
```typescript
// server/modules/ai/ai.validation.ts
import { z } from 'zod';

export const chatRequestSchema = z.object({
  message: z.string()
    .min(1, "Message cannot be empty")
    .max(1000, "Message too long"),
  conversationId: z.string().uuid().optional()
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
```

---

## 4. Type Safety Issues

### 4.1 Excessive `any` Usage

**Violations:**
```typescript
details?: Record<string, any>;  //  any
const toolResult = await executeTool(toolCall.name, toolCall.args);  //  Returns any
async function spendingByCategory(householdId: string, period: string): Promise<any> {  //  Returns any
```

**Required Fix:**
```typescript
// Define proper types
export interface SpendingByCategoryResult {
  category: string;
  amount: Money;
  transactionCount: number;
}

export interface GoalStatusResult {
  goalId: string;
  name: string;
  target: Money;
  current: Money;
  status: 'on_track' | 'behind' | 'ahead';
  projectedCompletion: Date | null;
}

async function spendingByCategory(
  householdId: string,
  period: string,
  currency: string
): Promise<SpendingByCategoryResult[]> {
  // Implementation
}
```

---

## 5. Error Handling Issues

### 5.1 Generic Error Handling

**Violation:**
```typescript
try {
  const result = await chat.sendMessage(messages[messages.length - 1].content!);
  // ...
} catch (error) {
  res.status(500).json({ error: 'AI service error' });  //  Too generic
}
```

**Required Fix:**
```typescript
import { AppError, InternalError, ValidationError } from '../core/errors';

try {
  const result = await chat.sendMessage(userMessage);
  // ...
} catch (error) {
  if (error instanceof GoogleGenerativeAIError) {
    if (error.code === 'RATE_LIMITED') {
      throw new RateLimitError('Gemini API rate limit exceeded');
    }
    if (error.code === 'INVALID_API_KEY') {
      logger.error('Invalid Gemini API key', { error });
      throw new InternalError('AI service misconfigured');
    }
  }
  throw new InternalError('AI service error', { cause: error });
}
```

---

## 6. Missing Features

### 6.1 No Currency Context

**Issue:** Tools don't respect household's default currency

**Required Fix:**
```typescript
// Get household currency first
const household = await db.query.households.findFirst({
  where: eq(households.id, householdId)
});

const currency = household?.currency || 'ZMW';

// Pass to all tools
const toolResult = await executeTool(
  toolCall.name,
  { ...toolCall.args, currency }
);
```

---

### 6.2 No Conversation History Storage

**Issue:** No persistence of conversations

**Required Fix:** Add `ai_conversations` table:
```sql
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id),
  user_id UUID NOT NULL REFERENCES users(id),
  messages JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 7. Compliance Issues

### 7.1 Missing Data Protection

**Zambia DPA Requirement:** Users must consent to AI processing

**Required Fix:**
- Add consent checkbox in settings
- Store consent in `households.ai_consent_given`
- Check consent before allowing AI queries

---

### 7.2 No Data Minimization

**Issue:** Tools may return excessive data to Gemini API

**Required Fix:**
```typescript
// Limit data sent to AI
const spendingData = await spendingByCategory(householdId, period, currency);
const minimized = spendingData
  .slice(0, 10)  // Top 10 categories only
  .map(({ category, amount }) => ({
    category,
    amount: amount.toFixed(2)  // String representation only
  }));
```

---

## 8. Testing Requirements

### Missing Tests

**Required:**
- Unit tests for each tool function
- Integration tests for `/chat` endpoint
- Rate limiting tests
- Error handling tests
- Money class usage verification tests

**Test File Structure:**
```
server/modules/ai/__tests__/
├── ai.controller.test.ts
├── ai.service.test.ts
├── ai.tools.test.ts
└── ai.rate-limiting.test.ts
```

---

## 9. Recommended Implementation Plan

### Phase 1: Foundation (Week 1)
1. Create modular structure following [CLAUDE.md](../../../CLAUDE.md)
2. Add proper types (no `any`)
3. Implement Money class usage
4. Add audit logging

### Phase 2: Security (Week 1)
1. Implement rate limiting
2. Add input validation (Zod)
3. Add consent management
4. Implement AppError error handling

### Phase 3: Features (Week 2)
1. Implement conversation history
2. Add currency context
3. Implement data minimization
4. Add tool result caching

### Phase 4: Testing & Polish (Week 2)
1. Write comprehensive tests
2. Add monitoring/observability
3. Document API endpoints
4. Security review

---

## 10. Corrected Architecture

### Proper Module Structure

```
server/modules/ai/
├── README.md                     # Module documentation
├── index.ts                      # Module exports
├── ai.routes.ts                  # Express routes (<100 LOC)
├── ai.controller.ts              # HTTP handlers (<500 LOC)
├── ai.service.ts                 # Core AI logic (<500 LOC)
├── ai.analytics.service.ts       # Analytics queries (<300 LOC)
├── ai.conversation.service.ts    # Conversation storage (<200 LOC)
├── ai.tools.ts                   # Tool definitions (<300 LOC)
├── ai.validation.ts              # Zod schemas (<150 LOC)
├── ai.types.ts                   # TypeScript types (<200 LOC)
├── ai.middleware.ts              # Rate limiting, consent (<150 LOC)
└── __tests__/
    ├── ai.controller.test.ts
    ├── ai.service.test.ts
    ├── ai.tools.test.ts
    └── ai.rate-limiting.test.ts
```

---

## 11. Acceptance Criteria for Fixed Implementation

### Critical (Must Have)
- [ ] All currency values use `Money` class
- [ ] All files under LOC limits
- [ ] Audit logging for all AI queries
- [ ] Following modular routes pattern
- [ ] Rate limiting per household
- [ ] Input validation with Zod
- [ ] No `any` types
- [ ] AppError error handling
- [ ] User consent for AI processing
- [ ] Test coverage >80%

### High Priority
- [ ] Conversation history storage
- [ ] Currency context in all tools
- [ ] Data minimization
- [ ] Tool result caching
- [ ] Comprehensive error messages

### Medium Priority
- [ ] Cost tracking per household
- [ ] Token usage monitoring
- [ ] Response time metrics
- [ ] Tool usage analytics

---

## 12. Security Checklist

### Before Production
- [ ] API key stored in environment variable (not in code)
- [ ] API key rotation mechanism
- [ ] Rate limiting tested
- [ ] Input sanitization verified
- [ ] SQL injection prevention verified
- [ ] Audit logging tested
- [ ] Data minimization verified
- [ ] OWASP ASVS 4.0 compliance check
- [ ] Zambia DPA consent mechanism
- [ ] PII data not sent to Gemini without consent

---

## 13. Cost & Performance Considerations

### Gemini API Costs
| Tier | Tokens/Day | Cost/1M Tokens | Daily Budget |
|------|------------|----------------|--------------|
| Free | 1,500 RPD | $0.00 | N/A |
| Pay-as-you-go | Unlimited | $0.075 (input), $0.30 (output) | ~$10/day recommended |

### Performance Targets
- Response time: <3s for simple queries
- Tool execution: <1s per tool
- Database queries: <500ms
- Rate limit: 50 queries/household/day

---

## 14. Dependencies

### New Dependencies Required
```json
{
  "dependencies": {
    "@google/generative-ai": "^0.21.0",
    "rate-limiter-flexible": "^5.0.0"
  }
}
```

**Total Bundle Size Impact:** +180KB (minified)

---

## 15. Conclusion

The suggested implementation from the external conversation **violates 7 critical CLAUDE.md rules** and requires major rework before it can be merged into the codebase.

### Action Required
1. **Reject** current implementation as-is
2. **Create proper specification** (see related documents)
3. **Re-implement** following this audit's recommendations
4. **Review** against CLAUDE.md before committing

### Related Documents
- [Business Requirements Document](../../specifications/ai-assistant-brd.md)
- [Software Requirements Specification](../specifications/ai-assistant-srs.md)
- [Use Cases](../specifications/ai-assistant-use-cases.md)
- [User Stories](../specifications/ai-assistant-user-stories.md)
- [Technical Design](../architecture/ai-assistant-technical-design.md)

---

**Audit completed by:** Codex
**Review date:** 2026-01-29
**Next review:** After implementation review

