export interface OperationExpectations { readonly subject: string; readonly household?: string }
export interface OperationLifetime { readonly id: number; readonly expectations?: OperationExpectations; active: boolean }
let sequence = 0;
let current: OperationLifetime | null = null;
const retirementListeners = new Set<(lifetime: OperationLifetime) => void>();

export function subscribeOperationLifetimeRetirement(listener: (lifetime: OperationLifetime) => void): () => void {
  retirementListeners.add(listener);
  return () => { retirementListeners.delete(listener); };
}

export class StaleOperationError extends Error {
  constructor() { super("Your session changed. Please start this action again."); this.name = "StaleOperationError"; }
}

export function createOperationLifetime(expectations?: OperationExpectations): OperationLifetime {
  return { id: ++sequence, expectations: expectations ? Object.freeze({ ...expectations }) : undefined, active: true };
}

export function activateOperationLifetime(lifetime: OperationLifetime): void {
  if (current && current !== lifetime) retireOperationLifetime(current);
  current = lifetime;
}

export function retireOperationLifetime(lifetime: OperationLifetime | null = current): void {
  if (lifetime) { lifetime.active = false; retirementListeners.forEach(listener => listener(lifetime)); }
  if (current === lifetime) current = null;
}

export function captureOperationLifetime(): OperationLifetime | null { return current; }

export function assertOperationLifetime(lifetime: OperationLifetime | null): void {
  if (lifetime && (!lifetime.active || current !== lifetime)) throw new StaleOperationError();
}

export function operationPreconditions(lifetime: OperationLifetime | null): Record<string, string> {
  if (!lifetime?.expectations) return {};
  return {
    "X-Capital-Subject": lifetime.expectations.subject,
    ...(lifetime.expectations.household ? { "X-Capital-Household": lifetime.expectations.household } : {}),
  };
}
