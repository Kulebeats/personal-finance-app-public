# Incident Response

## Purpose

Define how to detect, triage, contain, and recover from security incidents.

## Severity Levels

- P1: Confirmed data breach, active exploitation, or material financial risk.
- P2: Potential data exposure or security control failure with no confirmed breach.
- P3: Minor security bugs or policy deviations.

## Roles

- Incident Commander: Security Lead
- Engineering Lead: Backend Lead
- Communications: Product or Support Lead
- Legal or Compliance: Compliance Lead

## Runbook

1. Detect and triage. Identify scope and affected systems, preserve logs and evidence, and classify severity.
2. Contain. Disable affected credentials, rotate secrets if exposure is suspected, and apply emergency rate limits or feature flags.
3. Eradicate. Patch the root cause, remove malicious artifacts, and validate fixes in staging.
4. Recover. Restore services, verify core workflows, and monitor for reoccurrence.
5. Post-incident. Conduct root cause analysis, document the timeline and lessons learned, and update playbooks and tests.

## Evidence Handling

- Preserve logs, database records, and audit trails
- Record time of discovery, actions taken, and decisions
- Store evidence in access-controlled location

## Notifications

- Internal: notify security, engineering, and leadership
- External: notify users and regulators when required
- See `docs/compliance/breach-notification.md` for regulatory guidance

## Communication Templates

### User Notice

Subject: Security Notice - [Short Description]

Hello [User],

We are writing to inform you of a security incident that may affect your account.

What happened: [Describe the incident]
When: [Date and time]
What data was involved: [Specific data categories]
What we have done: [Actions taken]
What you should do: [User actions, such as password reset]

If you have questions, contact privacy@yourdomain.example.

Sincerely,
[Company Name] Security Team

### Status Update

Incident ID: [INC-YYYY-###]
Time: [Timestamp]
Status: [Investigating | Identified | Monitoring | Resolved]
Impact: [User impact summary]
Next update: [Time]

### Regulator Notice

- Incident ID and summary
- Timeline of discovery and containment
- Data categories affected
- Estimated number of affected users
- Mitigation steps and future prevention

## Review Cadence

- After every P1 or P2 incident
- Annual tabletop exercise
