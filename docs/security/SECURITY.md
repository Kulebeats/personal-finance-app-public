# Security Policy

## Scope
This document describes how to report vulnerabilities for the Personal Finance App and what to expect in response.

In scope:
- API server and data handling
- Web client
- Authentication and session handling
- Documentation that affects security guidance

Out of scope:
- Third-party dependencies (report upstream)
- Denial of service from unrealistic traffic volumes
- Social engineering

## Supported Versions
| Version | Supported |
| --- | --- |
| main | yes |

## Reporting a Vulnerability
Please report security issues privately.
- Email: security@yourdomain.example
- Include: summary, impact, steps to reproduce, proof of concept, affected endpoints, and suggested fix if available
- Do not open public issues with exploit details
- If encryption is required, request our PGP key in the initial email

## Severity and Response Targets
| Severity | Example | Acknowledge | Status Update | Fix Target |
| --- | --- | --- | --- | --- |
| Critical | Auth bypass, data exfiltration | 72 hours | 7 days | 30 days |
| High | Privilege escalation, SQLi | 72 hours | 7 days | 45 days |
| Medium | Sensitive data exposure | 7 days | 14 days | 90 days |
| Low | Minor misconfig or hardening | 14 days | 30 days | Best effort |

## Coordinated Disclosure
- We coordinate disclosure with the reporter once a fix is available
- We aim for a 90-day disclosure window unless risk requires faster action

## Safe Harbor
We support good-faith security research. If you act in good faith and follow this policy, we will not pursue legal action.
