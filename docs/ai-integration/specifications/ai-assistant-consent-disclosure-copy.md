# Thandiso AI Consent Disclosure Copy

Version: 2.0  
Date: 2026-02-07  
Status: Canonical Draft for Legal Review

---

## Settings Disclosure

By enabling Thandiso, your household allows summarized financial data (transactions, budgets, goals, recurring items, and derived insights) to be processed by the configured AI provider (Gemini 2.0 Flash in MVP) to answer your questions.

We minimize data sent externally:
- Aggregated and bounded results only.
- Personal names and contact details removed.
- Account numbers and internal IDs removed.

We keep an audit trail of:
- AI questions asked.
- Tools used and sanitized data summaries.
- Processing metadata (latency and token usage).

We also store your conversation with Thandi (your questions and Thandi's replies) in
your household account so you can continue where you left off. Conversations are
visible only to you, and you can delete them. *(Added 2026-07-12 to reflect shipped
conversation persistence — SCP-338; pending legal review with the rest of this draft.
Post-revoke readability of stored conversations is OPEN-5 in the master
requirements.)*

To answer follow-up questions ("what about last month?"), Thandi may include the most
recent few messages of your current conversation with your next question. This is
limited to content you have already seen in that conversation — the same minimization
above was applied before those replies were produced, so no additional personal data
is sent externally as a result. *(Added 2026-07-19 to reflect shipped multi-turn
context — OPEN-3; pending legal review with the rest of this draft.)*

Retention: 24 months for audit records.

You can revoke consent any time in Settings.

## First-Use Consent Modal

Thandiso uses AI to summarize your household financial data. Personal identifiers are removed and data is minimized before external processing.

By continuing, you grant household-level consent. You can revoke consent any time in Settings.

Not financial advice. For personalized advice, consult a qualified professional.

Action labels:
- `Grant Consent (Admin or Owner only)`
- `Cancel`

## Revocation Confirmation

Thandiso has been disabled for this household. Existing audit logs remain for compliance retention. No new AI processing will occur until consent is enabled again.
