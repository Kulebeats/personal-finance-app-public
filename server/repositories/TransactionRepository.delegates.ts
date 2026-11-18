/**
 * TransactionRepository delegated methods.
 *
 * Extracted from TransactionRepository to keep the primary repository focused on
 * core write flows and balance integrity logic.
 */
export class TransactionRepositoryDelegates {
  /**
   * Find all transactions for a household with pagination and filtering.
   * @deprecated Use transactionQueryRepository.findByHousehold instead.
   */
  async findByHousehold(
    ...args: Parameters<
      import("./TransactionQueryRepository").TransactionQueryRepository["findByHousehold"]
    >
  ) {
    const { transactionQueryRepository } = await import(
      "./TransactionQueryRepository"
    );
    return transactionQueryRepository.findByHousehold(...args);
  }

  /**
   * Find transactions with visibility filtering.
   * @deprecated Use transactionQueryRepository.findByHouseholdWithVisibility instead.
   */
  async findByHouseholdWithVisibility(
    ...args: Parameters<
      import("./TransactionQueryRepository").TransactionQueryRepository["findByHouseholdWithVisibility"]
    >
  ) {
    const { transactionQueryRepository } = await import(
      "./TransactionQueryRepository"
    );
    return transactionQueryRepository.findByHouseholdWithVisibility(...args);
  }

  /**
   * Find transactions for recurring pattern detection.
   * @deprecated Use transactionQueryRepository.findForPatternDetection instead.
   */
  async findForPatternDetection(
    ...args: Parameters<
      import("./TransactionQueryRepository").TransactionQueryRepository["findForPatternDetection"]
    >
  ) {
    const { transactionQueryRepository } = await import(
      "./TransactionQueryRepository"
    );
    return transactionQueryRepository.findForPatternDetection(...args);
  }

  /**
   * Create a transfer (two-row model).
   * @deprecated Use transactionTransferRepository.createTransfer instead.
   */
  async createTransfer(
    ...args: Parameters<
      import("./TransactionTransferRepository").TransactionTransferRepository["createTransfer"]
    >
  ) {
    const { transactionTransferRepository } = await import(
      "./TransactionTransferRepository"
    );
    return transactionTransferRepository.createTransfer(...args);
  }

  /**
   * Find the paired transfer transaction.
   * @deprecated Use transactionTransferRepository.findTransferPair instead.
   */
  async findTransferPair(
    ...args: Parameters<
      import("./TransactionTransferRepository").TransactionTransferRepository["findTransferPair"]
    >
  ) {
    const { transactionTransferRepository } = await import(
      "./TransactionTransferRepository"
    );
    return transactionTransferRepository.findTransferPair(...args);
  }

  /**
   * Count transactions for a household.
   * @deprecated Use transactionCountRepository.countByHousehold instead.
   */
  async countByHousehold(
    ...args: Parameters<
      import("./TransactionCountRepository").TransactionCountRepository["countByHousehold"]
    >
  ) {
    const { transactionCountRepository } = await import(
      "./TransactionCountRepository"
    );
    return transactionCountRepository.countByHousehold(...args);
  }

  /**
   * Count transactions with visibility filtering.
   * @deprecated Use transactionCountRepository.countByHouseholdWithVisibility instead.
   */
  async countByHouseholdWithVisibility(
    ...args: Parameters<
      import("./TransactionCountRepository").TransactionCountRepository["countByHouseholdWithVisibility"]
    >
  ) {
    const { transactionCountRepository } = await import(
      "./TransactionCountRepository"
    );
    return transactionCountRepository.countByHouseholdWithVisibility(...args);
  }
}

