import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '@shared/schema';
import type { TransactionUpdateOptions } from '../../repositories/TransactionUpdateWriter';
import type { TransactionType } from '../../utils/withTransaction';

const mocks = vi.hoisted(() => ({
  repository: { create: vi.fn(), update: vi.fn(), softDelete: vi.fn(), findByIdWithVisibility: vi.fn(), findByIdempotencyKey: vi.fn(), findTransferPair: vi.fn() },
  account: { findByIdWithVisibility: vi.fn() },
  deletePair: vi.fn(), commitTransfer: vi.fn(), recurring: vi.fn(), notification: vi.fn(), publish: vi.fn(), audit: vi.fn(), sync: vi.fn(), rules: vi.fn(), warn: vi.fn(),
  parent: { get: vi.fn(), setex: vi.fn(), scan: vi.fn(), del: vi.fn(), duplicate: vi.fn() },
  child: { on: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), scan: vi.fn(), del: vi.fn() },
}));
vi.mock('../../repositories/TransactionRepository', () => ({ transactionRepository: mocks.repository }));
vi.mock('../../repositories/AccountRepository', () => ({ accountRepository: mocks.account }));
vi.mock('../../repositories/CategoryRepository', () => ({ categoryRepository: {} }));
vi.mock('../../repositories/MerchantRepository', () => ({ merchantRepository: {} }));
vi.mock('../../repositories/TransactionTransferRepository', () => ({ transactionTransferRepository: { softDeleteTransferPair: mocks.deletePair } }));
vi.mock('../../utils/withTransaction', () => ({ withTransaction: mocks.commitTransfer }));
vi.mock('../../config/redis', () => ({ redis: mocks.parent, productionRedis: null }));
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: mocks.warn, error: vi.fn(), debug: vi.fn() } }));
vi.mock('../RuleService', () => ({ ruleService: { applyRules: mocks.rules } }));
vi.mock('../RecurringService', () => ({ recurringService: { autoLinkNewTransaction: mocks.recurring } }));
vi.mock('../NotificationService', () => ({ notificationService: { triggerLargeTransaction: mocks.notification } }));
vi.mock('../merchantRecognition', () => ({ resolveMerchantMatch: vi.fn(async () => ({ cleanedName: 'Purchase' })), ensureMerchantAlias: vi.fn() }));
vi.mock('../../core/events', () => ({ outboxEventService: { publish: mocks.publish }, EventTypes: { TRANSACTION_CREATED: 'created', TRANSACTION_UPDATED: 'updated', TRANSACTION_DELETED: 'deleted' } }));
vi.mock('../BusinessAuditService', () => ({ businessAuditService: { log: mocks.audit } }));
vi.mock('../GoalAccountAssignmentService', () => ({ goalAccountAssignmentService: { syncGoalsForAccount: mocks.sync } }));
vi.mock('../TransferFxService', () => ({ calculateFxData: vi.fn() }));
vi.mock('../transaction/queries', () => ({}));
vi.mock('../transaction/owner', () => ({}));
vi.mock('../transaction/review', () => ({}));
vi.mock('../transaction/tags', () => ({}));

import { createTransaction } from '../transaction/create';
import { deleteTransaction } from '../transaction/delete';
import { transactionService } from '../transaction/service';
import { transferService } from '../TransferService';
import { runPostImportSideEffects } from '../import/sideEffects';
import { invalidateOnChange } from '../CacheInvalidation';

const transaction = { id: 'txn', householdId: 'hh', ownerUserId: 'user', accountId: 'from', name: 'Purchase', type: 'expense', amount: '10.00', currency: 'ZMW', date: '2026-10-29', notes: null, isPrivate: false } as Transaction;
const outflow = { ...transaction, type: 'transfer', transferTransactionId: 'pair', transferAccountId: 'to', isTransferIn: false } as Transaction;
const inflow = { ...outflow, id: 'inflow', accountId: 'to', transferAccountId: 'from', isTransferIn: true } as Transaction;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.repository.findByIdWithVisibility.mockResolvedValue(transaction);
  mocks.repository.create.mockImplementation(async (_data, options) => {
    if (options?.publishCreatedEvent) await mocks.publish();
    return { transaction };
  });
  mocks.repository.update.mockImplementation(async (_id, _householdId, _data, _version, _externalTx, options?: TransactionUpdateOptions) => {
    const updated = { ...transaction, notes: 'changed' };
    // Audit/outbox now enlist in the write, before this simulated commit resolves.
    await options?.onWrite?.({} as TransactionType, {
      before: transaction, after: updated, privateAudit: false, beforeSplits: [], afterSplits: [], splitsChanged: false,
    });
    return { transaction: updated, conflict: false };
  });
  mocks.repository.softDelete.mockImplementation(async (_id, _householdId, options) => {
    if (options?.publishDeletedEvent) await mocks.publish();
    return transaction;
  });
  mocks.repository.findTransferPair.mockResolvedValue([outflow, inflow]);
  mocks.account.findByIdWithVisibility.mockImplementation(async (id: string) => ({ id, currency: 'ZMW' }));
  mocks.deletePair.mockResolvedValue(2);
  // Simulate the completed transaction boundary, not database/locking behavior.
  mocks.commitTransfer.mockResolvedValue({ outflow, inflow, affectedAccountIds: ['from', 'to'] });
  mocks.rules.mockImplementation(async value => value);
  for (const fn of [mocks.recurring, mocks.notification, mocks.publish, mocks.audit, mocks.sync, mocks.child.connect]) fn.mockResolvedValue(undefined);
  mocks.parent.duplicate.mockReturnValue(mocks.child);
  mocks.child.scan.mockResolvedValue(['0', []]);
});
afterEach(() => { vi.useRealTimers(); });

const cases = [
  { name: 'create', write: mocks.repository.create, run: () => createTransaction({ accountId: 'from', amount: '10.00', type: 'expense', name: 'Purchase', date: '2026-10-29' }, 'hh', 'user'), later() { expect(mocks.recurring).toHaveBeenCalledOnce(); expect(mocks.notification).toHaveBeenCalledOnce(); expect(mocks.publish).toHaveBeenCalledOnce(); } },
  { name: 'update', write: mocks.repository.update, run: () => transactionService.updateTransaction('txn', { notes: 'changed' }, 'hh', 'user'), later() { expect(mocks.publish).toHaveBeenCalledOnce(); expect(mocks.audit).toHaveBeenCalledOnce(); } },
  { name: 'delete', write: mocks.repository.softDelete, run: () => deleteTransaction('txn', 'hh', 'user'), later() { expect(mocks.publish).toHaveBeenCalledOnce(); } },
  { name: 'transfer delete', write: mocks.deletePair, run() { mocks.repository.findByIdWithVisibility.mockResolvedValue(outflow); return deleteTransaction('txn', 'hh', 'user'); }, later() { expect(mocks.repository.softDelete).not.toHaveBeenCalled(); } },
  { name: 'transfer update', write: mocks.commitTransfer, run() { mocks.repository.findByIdWithVisibility.mockResolvedValue(outflow); return transferService.updateTransfer('txn', { fromAccountId: 'from', toAccountId: 'to', amount: '10.00' }, 'hh', 'user'); }, later() { expect(mocks.sync.mock.calls).toEqual([['from', 'transfer_updated'], ['to', 'transfer_updated']]); } },
  { name: 'deletion-only import', write: null, run: () => runPostImportSideEffects([], 'hh', 'user', 1), later() { expect(mocks.rules).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled(); } },
  { name: 'import', write: null, run: () => runPostImportSideEffects([transaction], 'hh', 'user'), later() { expect(mocks.rules).toHaveBeenCalledOnce(); expect(mocks.recurring).toHaveBeenCalledOnce(); expect(mocks.notification).toHaveBeenCalledOnce(); expect(mocks.publish).not.toHaveBeenCalled(); } },
];

describe('actual post-commit services with ordinary optional cache failure', () => {
  for (const scenario of cases) {
    it.each(['rejection', 'outage'] as const)(`${scenario.name} preserves committed success and later effects on %s`, async failure => {
      vi.useFakeTimers();
      const fail = () => failure === 'outage' ? new Promise<never>(() => {}) : Promise.reject(new Error('ordinary Redis scan failed'));
      mocks.parent.scan.mockImplementation(fail); mocks.child.scan.mockImplementation(fail);
      const pending = scenario.run().then(value => ({ state: 'success', value }), error => ({ state: 'failed', error }));
      const outcome = Promise.race([pending, new Promise(resolve => setTimeout(() => resolve({ state: 'still-pending' }), 2000))]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await outcome).toMatchObject({ state: 'success' });
      if (scenario.write) expect(scenario.write).toHaveBeenCalledOnce();
      scenario.later();
      expect(mocks.warn).toHaveBeenCalledWith('Optional analytics cache invalidation failed after commit', expect.objectContaining({ entity: 'transaction', householdId: 'hh' }));
      expect(mocks.child.disconnect).toHaveBeenCalled();
      expect(mocks.parent.scan).not.toHaveBeenCalled();
    });
  }
  it('the low-level invalidation API still rejects ordinary failure', async () => {
    mocks.parent.scan.mockRejectedValue(new Error('ordinary Redis scan failed'));
    mocks.child.scan.mockRejectedValue(new Error('ordinary Redis scan failed'));
    await expect(invalidateOnChange('transaction', 'hh')).rejects.toThrow();
  });
});
