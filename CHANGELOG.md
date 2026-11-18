# Changelog

All notable changes to the Personal Finance App.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Added

- Documentation re-audit remediation (February 2026)
- System-wide test strategy document

## [0.3.0] - 2026-02-06

### Added

- Multi-factor authentication (email-based OTP)
- MFA backup codes for account recovery
- PHQ-9 mental health screening module
- Investment sub-controllers (buy, sell, dividend, interest, fee, split, transfer_in, transfer_out, coupon, maturity)
- Notification preferences and quiet hours
- Weekly financial recap feature
- CSRF protection (csrf-csrf double-submit cookie pattern)
- Gitleaks pre-commit hook for secret detection

### Changed

- Investments module refactored into sub-services
- Security documentation updated to reflect all P0 remediations
- Testing documentation renamed to clarify scope (Settings-specific)

### Fixed

- Budget module calculation errors for rollover edge cases
- MFA code no longer logged in development mode
- Rate limit bypass via X-Forwarded-For spoofing
- Express qs dependency CVE (DoS vulnerability)

### Security

- Rotated exposed secrets (SESSION_SECRET, CRON_SECRET, LOGO_DEV_TOKEN)
- All P0 security findings from Jan 2026 review remediated

## [0.2.0] - 2026-01-27

### Added

- MFA implementation during login flow
- Email verification system
- Session management improvements
- Account lockout after failed attempts

### Fixed

- Login error handling improvements
- Auth module security gaps addressed

## [0.1.0] - 2026-01-13

### Added

- Complete modular architecture (all 13 core modules migrated from legacy routes)
- Security review and Phase 0 remediation
- Rate limiting across all endpoint tiers
- Feature flag system for module switchover
- Comprehensive IEEE-compliant documentation suite (SRS, SDD, BRD)
- Zambia Data Protection Act (DPA) compliance framework
- Household-based multi-tenancy model
- Money class for precise currency arithmetic (decimal.js)
- FOR UPDATE row locking for concurrency safety

### Security

- Session regeneration on login (prevents session fixation)
- bcrypt password hashing with 12 rounds
- Structured logging with PII redaction
- RBAC system for admin functionality
- Helmet security headers (CSP, HSTS, X-Frame-Options)
- Error sanitization (no stack traces leaked)
