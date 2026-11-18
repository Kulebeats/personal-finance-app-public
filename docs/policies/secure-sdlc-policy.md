# Secure SDLC Policy

## Purpose

Define security and quality controls across the software lifecycle.

## Scope

- All code changes across client, server, and shared packages
- Third-party dependencies and infrastructure changes
- Documentation updates tied to releases

## Security Gates by Phase

### Requirements and Design

- Define security and privacy requirements for new features
- Perform threat modeling for high-risk features
- Identify data classification and retention impacts

### Implementation

- Code reviews required for all changes
- Input validation required for all API endpoints
- Use Money class for all currency calculations
- Avoid logging PII or secrets

### Verification

- Unit and integration tests for critical flows
- Security tests for auth and authorization
- Coverage threshold of 80 percent for core modules

### Release

- Run SCA and dependency audit
- Run linting and type checks
- Update changelog for user-facing changes
- Verify migrations and rollback notes

### Post-Release

- Monitor error rates and security alerts
- Document incidents and root cause analysis
- Update docs to reflect production behavior

## Tooling Requirements

- SAST or lint security rules in CI
- Dependency scanning on every release
- CI must block merges on failed tests

## Documentation Requirements

- Update API and security docs when endpoints change
- Update data dictionary when schema changes
- Update runbooks when operational behavior changes

## Exceptions

- Exceptions require written approval and a time limit
- Record exceptions in the risk register

## Review Cadence

- Annual review or after major security incidents
