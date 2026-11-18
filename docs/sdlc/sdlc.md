# SDLC

## Phases

1. Requirements
   - Capture business goals and non-functional requirements
   - Document in SRS and architecture requirements
2. Design
   - Update architecture docs and data flows
   - Threat model changes for major features
   - Define API schema changes and migration plans
3. Implementation
   - Follow module patterns and validation requirements
   - Ensure logging and error handling is consistent
   - Update OpenAPI and feature docs alongside code
4. Testing
   - Unit, integration, property-based, and manual testing
   - Maintain test results logs
   - Security testing for authz, rate limiting, and exports
5. Release
   - Update changelog and release notes
   - Verify DB migrations and rollback plans
   - Run smoke tests and monitor key metrics
6. Operations
   - Monitor errors, latency, and rate limits
   - Revisit risks and incident response exercises

## Required Artifacts
- SRS and module requirements
- Architecture diagrams and data flow notes
- OpenAPI spec and examples
- Test plans and results
- Release notes and change request

## Quality Gates
- TypeScript checks
- Linting and formatting
- Test pass for client and server
- Security review for auth and data changes
- Documentation updates for user-visible changes

## Change Control
- Follow `docs/operations/change-management.md`
- All production changes require a rollback plan
