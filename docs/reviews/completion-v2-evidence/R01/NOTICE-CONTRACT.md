# R01 notice implementation contract (subordinate working design)

This document implements master v2.2 sections2/R01/R16 and does not amend them.
Parent approved narrow ownership of `core/events/{processor,eventTypes,outbox}.ts`,
`security.email.ts` and R01 schema/migrations. No scheduler, real mail or production
activation is authorized. The existing logger remains R19-owned.

## Existing state and necessary additions

The existing outbox has pending/processing/completed/failed/dead_letter states.
It marks unhandled event types complete. `sendEmail` returns a boolean that
cannot distinguish a confirmed rejection from lost acknowledgment. Notifications
have no per-channel outcome/claim equivalent to reuse. Existing preference
fallback is in-app enabled, email disabled; quiet hours lack a stored timezone,
so use the subject's validated IANA profile timezone and fail closed if invalid.

Add unknown/suppressed outbox states and nullable security dispatch claim token,
lease expiry/start time plus monotonic claim generation. Other event types retain
their behavior. Add an expression unique index for a security notice's logical
audit event + normalized recipient + channel. New enum/claim/index state requires
an additive generated migration and protected synthetic-only application.

## Atomic security change transaction

- User-first lock, then credential/token/session revalidation.
- Write the password/email mutation, history/session effects as applicable,
  sanitized security audit and outbox events on the same transaction connection.
- Persist an in-app notice with event/subject/channel dedupe when its preference
  allows. Email suppression must not delete the audit or permitted in-app notice.
- Notice payload is an explicit versioned allowlist: userId, kind, recipient,
  channel, occurredAt. No password/hash, OTP, token/hash/link or raw user row.
- Password notices use the locked current address. Confirmed email transitions
  notify both verified old and newly verified addresses, deduped if equal. The
  transition's audit contains identifiers/action only, not raw addresses.
- Missing email_changed preference follows declared opt-in-compatible metadata;
  it does not silently mandate mail or override preferences.
- Email transition invalidates outstanding reset tokens under the same user
  lock. Reset issuance rechecks its requested email against the locked current
  identity so a former-address snapshot cannot issue a usable token.
- Password reset and authenticated password change revoke an already-issued
  pending email-change capability on that same user transaction. Initial email
  verification is a distinct purpose: replacing a password never activates it.

## Security-only dispatch state machine

Claim and preflight are transactional. Lock subject before event whenever both
are needed. Claim uses token + incremented generation + bounded lease. Duplicate
workers cannot own the same live claim. Expired processing may be reclaimed only
when no dispatch intent was committed; stale tokens/generations cannot start or
complete another claim.

Before calling transport, conditionally transition the owned, unexpired processing
claim to unknown and persist dispatchStartedAt. Only the worker whose transition
affects one row may invoke transport. A crash before this transition is safely
recoverable after lease expiry; a crash after it remains conservatively unknown,
even if transport may not have started.

A positive transport acknowledgment conditionally transitions the same token/
generation from unknown to completed. False/throw/lost acknowledgment or failed
post-send DB completion stays unknown. Unknown/completed cannot enter automatic
retry or be blindly overwritten. Pre-dispatch unavailable/configuration failures
may enter bounded failed retry. Quiet hours defer pending to the next permitted
time; opted-out/erased subjects record suppressed with a bounded reason.

The processor has an explicit built-in security-notice path before generic
unhandled-event completion. This path never reports an uncertain send as a sent
count. Real scheduling, general job fencing and provider outcome reconciliation
remain R14/R16/R19 work; the test mail boundary is synthetic, not runtime delivery.

## Required focused oracles

Actual HTTP: atomic enqueue/audit/in-app persistence on password/reset/email
change; outbox/audit failure rolls the identity change back; one-time email token
race; stale former-address issuance; exact sanitized keys/recipient readback.

Actual PostgreSQL dispatch claims with synthetic mail only: duplicate workers,
crash before dispatch intent, stale claim/late completion, unknown after lost
SMTP acknowledgment, unknown after post-send DB failure, no blind retry,
confirmed non-dispatch retry, preference suppression, timezone/cross-midnight
quiet-hours deferral, correct in-app durability and handler selection.
