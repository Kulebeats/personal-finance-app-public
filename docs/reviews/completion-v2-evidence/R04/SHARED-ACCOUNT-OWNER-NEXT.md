# Shared account owner: confirmed R04 follow-up

Discovered during the R05 remembered-account browser journey,30 October2026.
This is a separate open account-creation defect, not accepted shared ownership.

The real UI selected Shared (Household), then POST /api/accounts returned201 with
the creating actor's ownerUserId rather than null. Raw failure and screenshot:
account-memory author `.local/r05-account-memory/browser-diagnostic.log` and
`browser-diagnostic-artifacts/`. The synthetic row is preserved.

Source trace from the account-memory author:

- OwnerSelector.tsx maps Shared to null.
- AddAccountModal.tsx preserves ownerUserId in its create input; useAccounts and
  accountsApi JSON serialization retain explicit null.
- accounts.validation.ts accepts and preserves nullable ownerUserId; controller
  passes that validated input to the service.
- server/services/account/AccountCoreService.ts uses
  `const ownerUserId = data.ownerUserId ?? userId`, conflating explicit null with
  omission before repository insertion.

## Next implementation contract

Create a separate derived author after the R05 candidate is frozen. Preserve
explicit null as household-shared ownership; preserve the existing default to
the actor only for omitted ownership. Keep existing capability checks, household
membership validation, private-account rules, monetary inputs and ledger behavior.
Do not infer new permission or ownership policy from this defect.

First demonstrate the failure through focused service/route behavior, then verify
explicit-null create versus omitted create and explicit valid actor ownership.
Cover unauthorized/nonmember owner inputs through the existing R04 contract.
Run protected HTTP/SQL proof on a fresh marked disposable target, then repeat the
real Shared selection and assert request, response and database ownerUserId=null.
Use independent general/TypeScript/domain review as applicable. This local repair
does not close full R04 or satisfy Astra final/canonical integration gates.

The R05 memory journey may use explicitly actor-owned public accounts because its
contract is personal memory over the same eligible account list. Require the
second actor to receive both accounts in the real list and see both picker options;
do not silently count that as proof of household-shared ownership. Existing
AccountRepository visibility admits public rows independently of their owner.

Prioritize this concrete prerequisite defect before the separately recorded
R05/RECEIPT-REVIEW-NEXT.md consumer work. All101 groups remain OPEN.

Continuation update30 October2026: the bounded local repair and its unit, signed
HTTP/SQL and actual Shared browser evidence are now in SHARED-ACCOUNT-OWNER-CANDIDATE.md.
Resume that frozen candidate for Astra/canonical integration; do not reimplement
this plan from the failed baseline. Full R04 and release acceptance remain OPEN.
