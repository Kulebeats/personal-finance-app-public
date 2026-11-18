# User Stories - Thandiso AI Assistant

**Document Version:** 1.1
**Date:** 2026-02-07
**Status:** Updated to canonical role and Advice-page UX
**Format:** Agile User Story Standard

---

## Epic: Thandiso AI Assistant

### Story Point Scale
Fibonacci: 1, 2, 3, 5, 8, 13

### Priority Levels
- **P0 (Critical):** Must have for MVP
- **P1 (High):** Important for full functionality
- **P2 (Medium):** Enhances user experience
- **P3 (Low):** Nice to have

---

## US-AI-001: Enable AI Assistant

| Attribute | Value |
|-----------|-------|
| **ID** | US-AI-001 |
| **Epic** | E-AI: AI Assistant |
| **Priority** | P0 (Critical) |
| **Points** | 5 |
| **Status** | Ready for Dev |

**Story:**
```
As a household admin or owner
I want to enable the AI assistant feature
So that I can ask financial questions in natural language
```

**Acceptance Criteria:**
```
AC1: Consent UI
Given I am on the Settings page
When I navigate to the AI section
Then I should see a consent checkbox with clear explanation

AC2: Data Privacy Terms
Given I view the AI consent section
When I click "Learn more"
Then I should see what data will be processed and how

AC3: Enable Feature
Given I check the consent checkbox
When I save settings
Then the `/advice` page should become available for AI chat

AC4: Disable Feature
Given AI is enabled
When I uncheck the consent checkbox
Then AI chat on `/advice` should be blocked immediately
```

---

## US-AI-002: Ask Spending Question

| Attribute | Value |
|-----------|-------|
| **ID** | US-AI-002 |
| **Epic** | E-AI: AI Assistant |
| **Priority** | P0 (Critical) |
| **Points** | 8 |
| **Status** | Ready for Dev |

**Story:**
```
As a user with AI enabled
I want to ask "How much did I spend on groceries last month?"
So that I can quickly understand my spending without navigating reports
```

**Acceptance Criteria:**
```
AC1: Natural Language Query
Given AI is enabled
When I type "How much did I spend on groceries last month?"
Then the AI should understand and execute the spending query

AC2: Correct Currency
Given my household currency is ZMW
When the AI returns spending data
Then amounts should be formatted as "ZMW 1,234.56"

AC3: Time Period Recognition
Given I ask about "last month"
When the query executes
Then it should query transactions from the previous calendar month

AC4: Category Matching
Given I have a "Groceries" category
When I ask about "groceries"
Then it should match case-insensitively

AC5: Response Time
Given I submit a query
When processing completes
Then I should see results in < 3 seconds
```

---

## US-AI-003: Check Goal Progress

| Attribute | Value |
|-----------|-------|
| **ID** | US-AI-003 |
| **Epic** | E-AI: AI Assistant |
| **Priority** | P1 (High) |
| **Points** | 5 |
| **Status** | Ready for Dev |

**Story:**
```
As a user with savings goals
I want to ask "How close am I to my emergency fund goal?"
So that I can track progress without opening goal detail screens
```

**Acceptance Criteria:**
```
AC1: Goal Recognition
Given I have a goal named "Emergency Fund"
When I ask about "emergency fund goal"
Then the AI should identify the correct goal

AC2: Progress Calculation
Given my Emergency Fund target is ZMW 10,000 and current is ZMW 4,200
When I ask about progress
Then the AI should respond "42% complete" or "ZMW 5,800 remaining"

AC3: Projection
Given I have consistent contributions
When I ask "When will I reach my goal?"
Then the AI should provide estimated completion date

AC4: Multiple Goals
Given I have multiple goals
When I ask "Show all my goals"
Then the AI should list all with progress percentages
```

---

## US-AI-004: View Upcoming Bills

| Attribute | Value |
|-----------|-------|
| **ID** | US-AI-004 |
| **Epic** | E-AI: AI Assistant |
| **Priority** | P1 (High) |
| **Points** | 3 |
| **Status** | Ready for Dev |

**Story:**
```
As a busy user
I want to ask "What bills are due this week?"
So that I can avoid missed payments
```

**Acceptance Criteria:**
```
AC1: Time Range
Given today is January 14
When I ask "What bills are due this week?"
Then results should include Jan 14-20

AC2: Recurring Transaction Match
Given I have a recurring rule "Netflix - ZMW 150 monthly"
When the next occurrence is within the week
Then it should appear in results

AC3: Amount Display
Given bills have different currencies
When displaying amounts
Then each should use proper currency symbol

AC4: Sorted by Date
Given multiple upcoming bills
When results are returned
Then they should be sorted by due date (earliest first)
```

---

## US-AI-005: Multi-turn Conversation

| Attribute | Value |
|-----------|-------|
| **ID** | US-AI-005 |
| **Epic** | E-AI: AI Assistant |
| **Priority** | P1 (High) |
| **Points** | 8 |
| **Status** | **AC1/AC2 shipped in v1.1** (OPEN-3); AC3/AC4 superseded |

> **UPDATE (2026-07-19, OPEN-3 / Workstream B):** AC1 (context retention) and AC2
> (pronoun resolution) are now SATISFIED. `ai.service.ts` loads up to
> `AI_CONTEXT_MAX_MESSAGES` (default 6 messages / 3 turns) from the caller's own
> conversation and passes them to `geminiClient.analyzeQuery` as prior turns, ahead of
> the current message. History is trimmed to fit inside the existing 2000-token
> request budget (the cap was not raised) and stored user messages are re-scanned
> against the prompt-injection blocklist before replay. Context is only ever loaded
> for a conversation the caller owns; a foreign or unknown `conversationId` yields
> zero history. Audit rows on `entityType: 'ai_query'` carry `context_messages` and
> `context_tokens` for DPA visibility.
>
> **PRIOR CORRECTION (2026-07-12, code-verified), retained as history:** the shipped
> server did NOT feed prior messages to the model, so AC1/AC2 were not satisfiable in
> v1 and moved to the OPEN-3 backlog.
>
> AC3/AC4 remain superseded by shipped behavior: conversations persist server-side per
> user (SCP-338) and the UI shows the current thread with latest-thread restore; "New
> Chat" starts a new persisted thread rather than discarding an unpersisted one. See
> `ai-assistant-client-ui-spec.md` UI-AI-003d/f and UI-AI-006.

**Story:**
```
As a user exploring my finances
I want to ask follow-up questions
So that I can iteratively drill down into data
```

**Acceptance Criteria:**
```
AC1: Context Retention
Given I asked "How much did I spend in December?"
When I follow up with "What about November?"
Then the AI should understand "November spending"

AC2: Pronoun Resolution
Given I asked "Show my emergency fund goal"
When I ask "How much do I need to reach it?"
Then "it" should resolve to "emergency fund goal"

AC3: Session-Only History
Given I had a 5-message conversation
When I view the chat panel
Then I should see all previous messages for the current session only

AC4: New Conversation
Given I have an active conversation
When I click "New Chat"
Then context should reset and prior session messages are not persisted
```

---

## US-AI-006: Budget Status Check

| Attribute | Value |
|-----------|-------|
| **ID** | US-AI-006 |
| **Epic** | E-AI: AI Assistant |
| **Priority** | P1 (High) |
| **Points** | 5 |
| **Status** | Ready for Dev |

**Story:**
```
As a budget-conscious user
I want to ask "Am I over budget this month?"
So that I can adjust spending if needed
```

**Acceptance Criteria:**
```
AC1: Budget Comparison
Given I have category budgets for January
When I ask about budget status
Then the AI should compare actual vs budgeted amounts

AC2: Over-Budget Alert
Given I spent ZMW 2,000 on Transport (budget: ZMW 1,500)
When I ask budget status
Then the AI should highlight "Transport over by ZMW 500"

AC3: Remaining Budget
Given I have ZMW 1,000 remaining in total budget
When I ask budget status
Then the AI should respond with remaining amount

AC4: Category Breakdown
Given I ask "Which categories am I over budget?"
When multiple categories exceed budget
Then list all over-budget categories with amounts
```

---

## US-AI-007: Net Worth Trend

| Attribute | Value |
|-----------|-------|
| **ID** | US-AI-007 |
| **Epic** | E-AI: AI Assistant |
| **Priority** | P2 (Medium) |
| **Points** | 5 |
| **Status** | Backlog |

**Story:**
```
As an investor
I want to ask "How has my net worth changed over the last year?"
So that I can see wealth growth trends
```

**Acceptance Criteria:**
```
AC1: Net Worth Calculation
Given I have accounts across multiple currencies
When I ask about net worth
Then the AI should sum all accounts in base currency

AC2: Trend Analysis
Given I ask about change over a year
When data is returned
Then it should show starting value, ending value, and % change

AC3: Month-over-Month
Given I request monthly breakdown
When the AI responds
Then it should show net worth for each month

AC4: Visualization Suggestion
Given the AI returns trend data
When appropriate
Then it should suggest "View chart in Reports"
```

---

## US-AI-008: Rate Limit Handling

| Attribute | Value |
|-----------|-------|
| **ID** | US-AI-008 |
| **Epic** | E-AI: AI Assistant |
| **Priority** | P0 (Critical) |
| **Points** | 2 |
| **Status** | Ready for Dev |

**Story:**
```
As a system administrator
I want to limit AI queries per household
So that we control costs and prevent abuse
```

**Acceptance Criteria:**
```
AC1: Daily Limit
Given a household has 50 queries/day limit
When they exceed 50 queries
Then subsequent queries return 429 error

AC2: Clear Error Message
Given the rate limit is exceeded
When the user submits a query
Then show "Daily AI limit reached. Resets at midnight UTC."

AC3: Remaining Queries
Given a user has made 45 queries today
When they open the AI chat
Then show "5 queries remaining today"

AC4: Reset at Midnight
Given the rate limit was exceeded today
When midnight UTC passes
Then the counter resets to 0
```

---

## US-AI-009: Audit Logging

| Attribute | Value |
|-----------|-------|
| **ID** | US-AI-009 |
| **Epic** | E-AI: AI Assistant |
| **Priority** | P0 (Critical) |
| **Points** | 3 |
| **Status** | Ready for Dev |

**Story:**
```
As a compliance officer
I want all AI queries logged
So that we have an audit trail for regulatory compliance
```

**Acceptance Criteria:**
```
AC1: Query Logging
Given a user submits an AI query
When the query processes
Then log: user_id, household_id, query_text, timestamp, IP

AC2: Tool Execution Logging
Given the AI executes 3 tools
When processing completes
Then log which tools were called and with what parameters

AC3: Response Summary
Given the AI returns a response
When logging
Then store first 200 characters of response

AC4: Retention
Given audit logs are created
When 2 years pass
Then logs should still be accessible
```

---

## US-AI-010: Search Transactions

| Attribute | Value |
|-----------|-------|
| **ID** | US-AI-010 |
| **Epic** | E-AI: AI Assistant |
| **Priority** | P2 (Medium) |
| **Points** | 5 |
| **Status** | Backlog |

**Story:**
```
As a user
I want to ask "Show me all Amazon transactions last quarter"
So that I can review specific merchant spending
```

**Acceptance Criteria:**
```
AC1: Merchant Search
Given I have transactions with merchant "Amazon"
When I ask about "Amazon transactions"
Then return all matching transactions

AC2: Date Range
Given I ask about "last quarter"
When processing
Then query Oct-Dec or appropriate 3-month period

AC3: Result Limit
Given I have 500 Amazon transactions
When results are returned
Then limit to top 20 with option to see more

AC4: Total Amount
Given multiple transactions returned
When displaying results
Then show total: "15 transactions totaling ZMW 3,450"
```

---

## Story Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER JOURNEY                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ONBOARDING          BASIC QUERIES        ADVANCED               │
│      │                    │                   │                  │
│      ▼                    ▼                   ▼                  │
│  ┌────────┐          ┌────────┐          ┌────────┐             │
│  │US-AI-001          │US-AI-002          │US-AI-005             │
│  │ Enable │          │Spending│          │Multi-   │             │
│  │   AI   │          │ Query  │          │turn     │             │
│  └────────┘          └────────┘          └────────┘             │
│      │                    │                   │                  │
│      │               ┌────────┐          ┌────────┐             │
│      │               │US-AI-003          │US-AI-007             │
│      │               │ Goal   │          │NetWorth│             │
│      │               │Progress│          │ Trend  │             │
│      │               └────────┘          └────────┘             │
│      │                    │                   │                  │
│      │               ┌────────┐          ┌────────┐             │
│      │               │US-AI-004          │US-AI-010             │
│      │               │Upcoming│          │Transaction          │
│      │               │ Bills  │          │ Search │             │
│      │               └────────┘          └────────┘             │
│      │                    │                                      │
│      │               ┌────────┐                                 │
│      │               │US-AI-006                                 │
│      │               │ Budget │                                 │
│      │               │ Status │                                 │
│      │               └────────┘                                 │
│      │                                                           │
│      └───────────────────┬───────────────────┘                  │
│                          │                                      │
│                    SYSTEM STORIES                               │
│                          │                                      │
│                     ┌────────┐                                  │
│                     │US-AI-008                                  │
│                     │Rate Limit                                │
│                     └────────┘                                  │
│                          │                                      │
│                     ┌────────┐                                  │
│                     │US-AI-009                                  │
│                     │Audit Log                                 │
│                     └────────┘                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Definition of Done

For each user story to be considered "Done":

- [ ] Code implemented following [CLAUDE.md](../../../CLAUDE.md) standards
- [ ] Money class used for all currency values
- [ ] All files <500 LOC
- [ ] Unit tests written (>80% coverage)
- [ ] Integration tests passing
- [ ] Manual testing completed
- [ ] Audit logging verified
- [ ] Security review passed
- [ ] Documentation updated
- [ ] Code reviewed and merged

---

**Status:** Ready for sprint planning
**Total Story Points (P0+P1):** 44 points
**Estimated Sprint Velocity:** 13 points/week
**Estimated Duration:** 4 weeks for MVP
