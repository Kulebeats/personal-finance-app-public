# Finance App Documentation

## Overview

This directory contains system, security, compliance, and product documentation for the Personal Finance Application, including 2025-ready standards alignment and fintech expectations.

## Documentation Index

### System Documentation (2025 Standard Set)

- **[System Overview](./system/overview.md)** - Scope, users, data classes, and major workflows
- **[Architecture](./system/architecture.md)** - High-level architecture and subsystem responsibilities
- **[Data Flows](./system/data-flows.md)** - Context + DFDs (Mermaid)
- **[Deployment](./system/deployment.md)** - Environments, configuration, and operational boundaries
- **[Feature Flags](./system/feature-flags.md)** - Runtime flags and module switchover
- **[Health Checks](./system/health.md)** - Liveness/readiness endpoints
- **[SDLC](./sdlc/sdlc.md)** - Requirements, design, build, test, release, and maintenance
- **[Change Management](./operations/change-management.md)** - Change control and approval flow
- **[Release Notes](./operations/release-notes.md)** - Release structure and history
- **[Changelog](./operations/changelog.md)** - Code and doc change log

### Modules

- **[Module Index](./modules/README.md)** - Status reports, reviews, and code entry points

### Security, Privacy, and Compliance

- **[Security Policy](./security/security.md)** - Vulnerability reporting and response expectations
- **[Security Architecture](./security/security-architecture.md)** - Identity, sessions, CSRF, rate limiting, uploads
- **[Threat Model](./security/threat-model.md)** - Assets, threats, mitigations (Mermaid)
- **[Risk Register](./security/risk-register.md)** - Risks, impact, mitigations, owners
- **[Access Control](./security/access-control.md)** - AuthN/AuthZ model and roles
- **[Logging & Monitoring](./security/logging-monitoring.md)** - Audit events, PII rules, metrics
- **[Incident Response](./security/incident-response.md)** - Security incident playbook and roles
- **[Breach Notification](./compliance/breach-notification.md)** - Regulatory timelines and notification templates
- **[Data Privacy](./compliance/data-privacy.md)** - Data handling, retention, and privacy controls
- **[Standards Alignment](./compliance/standards-alignment.md)** - ISO, SOC 2, OWASP, NIST, fintech guidance
- **[Jurisdiction Scope](./compliance/jurisdiction-scope.md)** - Regulatory triggers and recommendations
- **[Compliance Mapping](./compliance/compliance.md)** - PCI DSS, GDPR, PSD2 readiness tracking
- **[Compliance Summary (Quick View)](./compliance/compliance-summary.md)** - High-level snapshot for stakeholders
- **[Accessibility Audit](./accessibility/accessibility-audit.md)** - WCAG 2.1 AA audit plan and findings
- **[Security Review Report](./security/security-review-report.md)** - Latest security review notes
- **[Security Remediation Guide](./security/security-remediation.md)** - Remediation steps and verification checklist
- **[Export Audit Logging Spec](./security/export-audit-logging-spec.md)** - Audit event schema and storage plan

### Policies

- **[Access Control Policy](./policies/access-control-policy.md)** - Authentication and authorization policy
- **[Logging and Audit Policy](./policies/logging-audit-policy.md)** - Audit events and log handling
- **[Data Retention Policy](./policies/data-retention-policy.md)** - Retention and deletion rules
- **[Secure SDLC Policy](./policies/secure-sdlc-policy.md)** - Secure development lifecycle policy
- **[BCP/DR Policy](./policies/business-continuity-disaster-recovery.md)** - Business continuity and recovery
- **[Vendor Management Policy](./policies/vendor-management-policy.md)** - Third-party risk management

### API Documentation

- **[OpenAPI Specification](./api/openapi.yaml)** - API surface and contract (OpenAPI 3.1)
- **[Security Settings API](./api/security-api.md)** - Security-related settings endpoints
- **[API Notes](./api/README.md)** - Auth, pagination, errors, versioning
- **[API Examples](./api/examples.md)** - Request and response samples
- **[Error Codes](./api/error-codes.md)** - API error code reference

### Setup and Operations

- **[Setup Guide](./setup/setup.md)** - General application setup instructions
- **[Developer Onboarding](./setup/developer-onboarding.md)** - First-week guide and orientation
- **[Database Setup (Authoritative)](./setup/database-setup.md)** - Consolidated database setup guide
- **[Migration Guide](./setup/migration-guide.md)** - Migration workflow and tips
- **[Runbooks](./operations/runbooks.md)** - Operational procedures and checklists

### Testing Documentation

- **[Test Strategy](./testing/test-strategy.md)** - System-wide testing strategy and coverage targets
- **[Settings Testing Guide](./testing/settings-testing-guide.md)** - Settings module testing (detailed)
- **[Test Results](./testing/test-results.md)** - Historical test results and phase completion status
- **[Manual Testing Results](./testing/manual-testing-results.md)** - Manual testing logs
- **[Settings Integration Testing](./testing/settings-integration-testing.md)** - Integration testing infrastructure
- **[Settings Test Changelog](./testing/settings-test-changelog.md)** - Updates to Settings integration testing
- **[Testing Fixtures](./testing/fixtures/)** - HTML and CSV fixtures used in docs

### Product and Features

- **[Feature Showcase](./features/feature-showcase.md)** - Profile enhancement demo guide
- **[Features Overview](./features/features.md)** - Major capabilities and modules
- **[Data Export](./features/data-export.md)** - Export formats and data portability
- **[Help Center](./features/help-center.md)** - Job aids for each app section

### Architecture and Specifications

- **[Architecture Diagrams](./architecture/architecture-diagram.md)** - System context and data flow diagrams
- **[Architecture Requirements](./architecture/architecture-requirements.md)** - Core system requirements and invariants
- **[Architecture Review](./reviews/architecture-review.md)** - Architecture evaluation and gaps
- **[Data Dictionary](./specifications/data-dictionary.md)** - Field definitions for core entities
- **[Analytics & Reporting Architecture](./architecture/analytics-reporting-architecture.md)** - Analytics system design
- **[Analytics Architecture Amendments](./architecture/analytics-architecture-amendments.md)** - Architecture updates and changes
- **[Implementation Plan v7 (Final)](./architecture/implementation-plan-v7-final.md)** - Production-ready implementation plan
- **[Implementation Summary](./architecture/final-implementation-summary.md)** - Technical achievements
- **[Phase 1 Complete](./architecture/phase-1-complete.md)** - Phase 1 milestone
- **[Transaction Modal Refactoring Plan](./features/requirements/transaction-modal-refactoring-plan.md)** - UI/UX plan
- **[Investment Integration Requirements](./features/requirements/investment-integration-requirements.md)** - Integration requirements

### Reviews and Audits

- **[Workflow Audit](./reviews/workflow-audit.md)** - End-to-end wiring audit (UI -> hooks -> API)
- **[Security Audit Report (v3, 2026-01-13)](./reviews/security-audit-report-2026-01-13-v3.md)** - Security audit results
- **[Industry Standards Review](./reviews/industry-standards-review.md)** - Prior standards review
- **[Prioritized Action Items](./reviews/prioritized-action-items.md)** - Consolidated action list
- **[QA Verification Report v2](./reviews/qa-verification-report-2026-01-12-v2.md)** - QA verification notes
- **[Documentation Re-Audit v3](./reviews/documentation-reaudit-v3-final-2026-02-06.md)** - Documentation completeness review

## Quick Start

### For Developers

1. **Setup Environment**: Follow [Setup Guide](./setup/setup.md)
2. **Database Configuration**: Use [Database Setup (Authoritative)](./setup/database-setup.md)
3. **Run Tests**: See [Test Strategy](./testing/test-strategy.md)
4. **Integration Testing**: Review [Settings Integration Testing](./testing/settings-integration-testing.md)

### For Testers

1. **Manual Testing**: Use [Settings Testing Guide](./testing/settings-testing-guide.md) checklist
2. **Feature Demo**: Follow [Feature Showcase](./features/feature-showcase.md)
3. **Test Results**: Check [Test Results](./testing/test-results.md)

### For Stakeholders

1. **Feature Overview**: Start with [Features Overview](./features/features.md)
2. **Implementation Status**: Review [Implementation Summary](./architecture/final-implementation-summary.md)
3. **Test Coverage**: Check [Test Results](./testing/test-results.md)
