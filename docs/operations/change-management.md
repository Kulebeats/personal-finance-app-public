# Change Management

## Objectives
- Ensure controlled changes to production systems
- Maintain auditability for security and compliance
- Reduce regression risk

## Change Types
| Type | Description | Examples | Approval |
| --- | --- | --- | --- |
| Standard | Low risk, repeatable changes | Copy updates, config toggles, minor UI text | Team lead |
| Normal | Feature or behavioral changes | API changes, schema changes, new screens | Eng lead + Product |
| Emergency | Urgent security or outage fixes | Critical patches, incident mitigation | On-call + Eng lead |

## Roles
- Requester: authors the change request and plan
- Approver: reviews risk, scope, and rollback
- Release manager: schedules and coordinates deployments
- On-call: monitors and responds during rollout

## Workflow
1. Create change request (scope, risk, rollback)
2. Impact analysis and approvals
3. Implement with tests and validation
4. Update documentation and release notes
5. Deploy and monitor
6. Post-change review

## Change Request Template
- Summary and motivation
- Systems affected and dependencies
- Risk assessment and mitigation
- Data migrations and rollback plan
- Test plan and results
- Monitoring plan and success criteria
- Documentation updates
- Communication plan

## Emergency Changes
- Criteria: active incident or security vulnerability
- Minimum approvals: on-call + engineering lead
- Post-incident review required within 5 business days
