# Use Case Specification

## Thandiso AI Assistant

**Document Version:** 1.1
**Date:** 2026-02-07
**Status:** Updated to canonical role and UI direction
**Standard:** UML 2.5.1

---

## Table of Contents

1. [Use Case Diagram](#1-use-case-diagram)
2. [Actor Definitions](#2-actor-definitions)
3. [Use Case Specifications](#3-use-case-specifications)
4. [Activity Diagrams](#4-activity-diagrams)
5. [Sequence Diagrams](#5-sequence-diagrams)
6. [State Diagrams](#6-state-diagrams)

---

## 1. Use Case Diagram

Text-only view. See `docs/architecture/ai-assistant-technical-design.md` for visual diagrams.

---

## 2. Actor Definitions

| Actor | Description |
|------|-------------|
| Household Admin/Owner | Enables or disables AI consent for the household |
| Household Member | Uses the AI assistant to ask questions after consent is enabled |
| System | Enforces consent, rate limits, and logging |

---

## 3. Use Case Specifications

### UC-AI-001 Enable AI Assistant

- **Primary Actor:** Household Admin/Owner
- **Preconditions:** User is authenticated and has admin or owner role
- **Trigger:** User toggles AI consent on
- **Main Flow:**
  1. User opens Settings > AI.
  2. System displays consent disclosure.
  3. User enables consent and saves.
  4. System stores consent status and timestamp.
  5. AI chat on `/advice` becomes available.
- **Alternate Flows:**
  - If user cancels, consent remains disabled.
- **Postconditions:** Household consent is enabled.

### UC-AI-002 Ask Spending Question

- **Primary Actor:** Household Admin/Member
- **Preconditions:** AI consent enabled; user authenticated
- **Trigger:** User submits a spending question in the chat
- **Main Flow:**
  1. User submits message.
  2. System validates input and rate limit.
  3. System runs spending tool for the household.
  4. System sends sanitized results to AI.
  5. System returns a formatted response.
- **Alternate Flows:**
  - Rate limit exceeded -> return error.
  - Consent missing -> return error.
- **Postconditions:** Audit log entry created; response delivered.

### UC-AI-003 Ask Goal Status Question

- **Primary Actor:** Household Admin/Member
- **Preconditions:** AI consent enabled
- **Trigger:** User asks about goals
- **Main Flow:**
  1. System executes goal status tool.
  2. AI summarizes progress and deadlines.
  3. Response is returned to user.
- **Postconditions:** Audit log entry created.

### UC-AI-004 Ask Budget Status Question

- **Primary Actor:** Household Admin/Member
- **Preconditions:** AI consent enabled
- **Trigger:** User asks about budgets
- **Main Flow:**
  1. System executes budget status tool.
  2. AI summarizes remaining amounts and overspending.
- **Postconditions:** Audit log entry created.

### UC-AI-005 Revoke AI Consent

- **Primary Actor:** Household Owner
- **Preconditions:** AI consent enabled
- **Trigger:** User disables AI consent
- **Main Flow:**
  1. User disables consent in Settings.
  2. System updates consent status.
  3. AI chat widget is hidden.
- **Postconditions:** AI is disabled for the household.

### UC-AI-006 System Rate Limit Enforcement

- **Primary Actor:** System
- **Preconditions:** AI consent enabled
- **Trigger:** Request volume exceeds limit
- **Main Flow:**
  1. System detects limit reached.
  2. System returns 429 response with retry information.
  3. Audit log captures rate-limit event.
- **Postconditions:** Request blocked; audit logged.

---

## 4. Activity Diagrams

Not included in this document. Refer to `docs/architecture/ai-assistant-technical-design.md`.

---

## 5. Sequence Diagrams

Not included in this document. Refer to `docs/architecture/ai-assistant-technical-design.md`.

---

## 6. State Diagrams

Not included in this document. Refer to `docs/architecture/ai-assistant-technical-design.md`.

