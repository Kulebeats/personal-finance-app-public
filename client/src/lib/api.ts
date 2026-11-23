/**
 * API Client for Finance App
 *
 * Provides typed API calls to the backend for accounts and transactions.
 * Replaces localStorage operations with server-backed data.
 */

import type { MoneyDto } from "@shared/money";
import type {
  ConditionType,
  Operator,
  ActionType,
} from "@shared/ruleConditions";
import { getCsrfToken, clearCsrfToken } from "./csrf";
import { assertOperationLifetime, captureOperationLifetime, type OperationLifetime } from "./operation-lifetime";
import { beginSessionTransition, completeSessionTransition } from "./session";
import { protectedFetch } from "./protected-fetch";
import { throwIfResNotOk } from "./queryClient";
import { unsubscribeThisBrowserFromPush } from "./push-signout";
export type { MoneyDto };

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
  isDuplicate?: boolean;
}

// Shape of the Error thrown by apiCall on a non-2xx response. Callers that
// need to branch on the server's error `code` (see server/core/errors) or
// raw HTTP `status`, rather than parsing the message string, should narrow
// to this type instead of hand-rolling an inline `Error & {...}` cast.
export interface ApiError extends Error {
  code?: string;
  details?: unknown;
  fields?: unknown;
  status?: number;
  /**
   * Seconds until the caller may retry, from the `Retry-After` header on a 429
   * (falling back to `RateLimit-Reset`). Both are RFC 9110 delta-seconds — see
   * docs/api/error-codes.md. Undefined when the response carried neither, which
   * callers must treat as "unknown", not "retry now".
   */
  retryAfterSeconds?: number;
}

/**
 * Read the retry delay off an error response, in seconds.
 *
 * Prefers `Retry-After` (emitted for every `RateLimitError` by
 * `apiErrorMiddleware`) and falls back to `RateLimit-Reset`. Both are
 * delta-seconds, never an ISO instant or HTTP-date, so callers must convert
 * before rendering an absolute time.
 *
 * `headers` is optional-chained because a real `Response` always has it but
 * hand-rolled `Response` mocks across the client test suite often don't; a
 * missing header set means "no retry info", not a crash.
 */
function readRetryAfterSeconds(response: Response): number | undefined {
  const raw =
    response.headers?.get?.("Retry-After") ??
    response.headers?.get?.("RateLimit-Reset");
  if (!raw) return undefined;

  const seconds = Number(raw);
  // Reject NaN (e.g. a server sending an HTTP-date) and negatives rather than
  // propagating a value that would render as a past instant.
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds;
}

export interface PaginatedResponse<T> extends ApiResponse<T> {
  pagination: {
    // Legacy fields
    limit: number;
    offset: number;
    count: number;
    totalCount: number;
    // V7 pagination format (CLAUDE.md Response Format Rules)
    total: number;
    page: number;
    pageSize: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Account types (matching server schema)
export interface Category {
  id: string;
  name: string;
  householdId?: string;
  groupId?: string | null;
  groupName?: string | null;
  groupType?: "income" | "expenses" | "transfers" | null;
  icon?: string | null;
  color?: string | null;
  includeInBudget?: boolean;
  rolloverEnabled?: boolean;
  rolloverStartBalance?: string | null;
  isArchived?: boolean;
  displayOrder?: number | null;
  isCustom?: boolean;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface Account {
  id: string;
  householdId: string;
  name: string;
  type:
    | "checking"
    | "savings"
    | "credit"
    | "cash"
    | "mobile_money"
    | "investment"
    | "loan"
    | "mortgage"
    | "other_liability"
    | "real_estate"
    | "vehicle"
    | "other";
  subtype?: string;
  institution?: string;
  institutionLogo?: string;
  balance: string;
  availableBalance?: string;
  initialBalance: string;
  creditLimit?: string;
  estimatedValue?: string | null;
  purchaseDate?: string | null;
  address?: string | null;
  currency: string;
  isAsset: boolean;
  isPrivate: boolean;
  ownerUserId?: string | null;
  isHidden: boolean;
  isArchived: boolean;
  excludeFromNetWorth?: boolean;
  hideTransactions?: boolean;
  color?: string;
  icon?: string;
  displayOrder: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CreateAccountInput {
  name: string;
  type: Account["type"];
  subtype?: string;
  institution?: string;
  initialBalance?: string;
  currency?: string;
  isPrivate?: boolean;
  isHidden?: boolean;
  notes?: string;
  ownerUserId?: string | null;
  // Credit/loan account fields
  creditLimit?: string;
  apr?: number;
  statementDay?: number;
  // Property/vehicle fields
  estimatedValue?: string | null;
  purchaseDate?: string | null;
  address?: string | null;
}

export interface UpdateAccountInput extends Partial<CreateAccountInput> {
  isArchived?: boolean;
  displayOrder?: number;
  updatedAt?: string;
}

export interface BalanceAdjustmentInput {
  amount: number;
  isIncrease: boolean;
  notes?: string;
}

export interface NetWorthSummary {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  currency?: string; // TODO-006: Added base currency
  scope?: "visible_account_linked";
  complete?: false;
  valuationDate?: string;
  fxPolicy?: "trusted_same_day_only";
}

export interface BalanceHistoryPoint {
  date: string;
  balance: number;
}

export interface NetWorthHistoryPoint {
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
  currency?: string;
  provenance?: "captured_snapshot";
}

export interface NetWorthHistory {
  series: NetWorthHistoryPoint[];
  /** Requested only by the registered account page; shares current frame authority. */
  accounts?: Account[];
  accessibleAccountCount?: number;
  latest: {
    assets: number;
    liabilities: number;
    netWorth: number;
    currency?: string;
    valuationDate?: string;
  } | null;
  scope?: "household" | "user"; // TODO-009: Added scope metadata
  currentStatus?: "available" | "unavailable";
  historyCoverage?: "verified_snapshots_only";
  unattestedHistory?: "not_charted";
}

export interface AccountSettings {
  isHidden?: boolean;
  excludeFromNetWorth?: boolean;
  hideTransactions?: boolean;
}

export interface TransactionImportRow {
  date: string;
  merchant: string;
  category?: string;
  originalStatement?: string;
  notes?: string;
  amount: string;
  tags?: string;
}

/** NEW-17: a row the member chose to post although it may repeat a transaction already on the account. */
export interface TransactionImportPossibleDuplicate {
  row: number;
  transactionId: string;
  matchesTransactionId: string;
}

export interface TransactionImportResult {
  imported: number;
  totalAmount: MoneyDto;
  skipped: number;
  possibleDuplicates: TransactionImportPossibleDuplicate[];
  /** A-01: flagged rows the member chose to skip. */
  reviewSkipped?: number;
}

/** A-01: the member's choice for a flagged row, bound to the transaction it was shown against. */
export interface TransactionImportDecision {
  row: number;
  matchesTransactionId: string;
  decision: "post" | "skip";
}

/** A-01: a row the import refused to post until the member decides (409 IMPORT_REVIEW_REQUIRED). */
export interface TransactionImportReviewItem {
  row: number;
  matchesTransactionId: string;
  match: { name: string; date: string; type: string; amount: { amount: string; currency: string } };
}

export const IMPORT_REVIEW_REQUIRED = "IMPORT_REVIEW_REQUIRED";

// Transaction types (matching server schema)
export interface Transaction {
  id: string;
  householdId: string;
  accountId: string;
  ownerUserId?: string | null;
  date: string;
  name: string;
  originalName?: string;
  amount: MoneyDto; // Server returns MoneyDto via mapTransactionMoney
  type: "income" | "expense" | "transfer" | "balance_adjustment";
  categoryId?: string;
  merchantId?: string;
  transferAccountId?: string;
  transferTransactionId?: string;
  isTransferIn?: boolean;
  isBalanceAdjustmentIncrease?: boolean;
  isPending: boolean;
  status?: "pending" | "cleared" | "reconciled";
  isRecurring: boolean;
  recurringTransactionId?: string;
  isExcludedFromReports: boolean;
  isExcludedFromBudget: boolean;
  isPrivate: boolean;
  idempotencyKey?: string;
  source?: "manual" | "whatsapp" | "receipt_scan" | "csv_import" | "recurring";
  reviewedAt?: string;
  reviewedBy?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  // Denormalized fields (populated by backend)
  merchantName?: string | null;
  merchantLogoUrl?: string | null;
  categoryName?: string | null;
  accountName?: string | null;
  currency?: string | null;
  // Split transaction data (when transaction has splits)
  splits?: Array<{
    id: string;
    amount: MoneyDto | { amount: string; currency: null };
    categoryId?: string | null;
    merchantId?: string | null;
    displayOrder?: number;
    categoryName?: string;
    notes?: string | null;
  }>;
}

export interface CreateTransactionInput {
  accountId: string;
  date: string;
  name: string;
  amount: MoneyDto;
  type: "income" | "expense";
  categoryId?: string;
  merchantId?: string;
  isPending?: boolean;
  isRecurring?: boolean;
  isExcludedFromReports?: boolean;
  isExcludedFromBudget?: boolean;
  isPrivate?: boolean;
  notes?: string;
  idempotencyKey?: string;
  ownerUserId?: string | null;
}

export interface CreateTransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: MoneyDto;
  date?: string;
  name?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface UpdateTransferInput {
  expectedUpdatedAt?: string;
  fromAccountId: string;
  toAccountId: string;
  amount: MoneyDto;
  date?: string;
  name?: string;
  notes?: string | null;
}

export interface UpdateTransactionInput {
  date?: string;
  name?: string;
  amount?: MoneyDto;
  type?: "income" | "expense";
  categoryId?: string | null;
  merchantId?: string | null;
  isExcludedFromReports?: boolean;
  isExcludedFromBudget?: boolean;
  notes?: string | null;
  ownerUserId?: string | null;
  isPrivate?: boolean;
  updatedAt?: string;
  expectedUpdatedAt?: string;
  splits?: Array<{ amount: MoneyDto; categoryId: string | null; merchantId?: string | null; notes?: string; displayOrder?: number }>;
}

export interface TransactionSummary {
  totalIncome: MoneyDto;
  totalExpenses: MoneyDto;
  netFlow: MoneyDto;
  transactionCount: number;
  // Full-period eligible flows, already converted to the same household currency.
  largestIncome?: MoneyDto | null;
  largestExpense?: MoneyDto | null;
  firstTransactionDate?: string | null;
  lastTransactionDate?: string | null;
}

export interface ListTransactionsParams {
  limit?: number;
  offset?: number;
  accountId?: string;
  categoryId?: string;
  merchantId?: string;
  type?: string;
  startDate?: string;
  endDate?: string;
  ownerUserId?: string | null;
  search?: string;
  amountMin?: number;
  amountMax?: number;
  reviewed?: "reviewed" | "unreviewed";
  tagIds?: string[];
}

// CSRF token acquisition/caching lives in the shared ./csrf module so this
// layer and apiRequest (lib/queryClient.ts) use one token cache. Re-export
// clearCsrfToken to keep the existing import surface (login handlers, tests).
export { clearCsrfToken };

// ============================================================================
// STEP-UP ("SUDO MODE") HANDLER BRIDGE
// ============================================================================

// Registered by StepUpProvider so the API layer can prompt for re-authentication
// and transparently retry a request that returned 401 STEP_UP_REQUIRED.
type StepUpHandler = (level: string) => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;

export function registerStepUpHandler(handler: StepUpHandler | null): void {
  stepUpHandler = handler;
}

export function requestStepUp(level: string): Promise<boolean> {
  return stepUpHandler ? stepUpHandler(level) : Promise.resolve(false);
}

// Helper function for API calls
export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {},
  retryOnStepUp = true,
  csrfRetried = false,
  operation: OperationLifetime | null = captureOperationLifetime(),
): Promise<T> {
  assertOperationLifetime(operation);
  const method = (options.method || "GET").toUpperCase();
  const isMutating = ["POST", "PUT", "DELETE", "PATCH"].includes(method);

  // FormData bodies (file uploads) must not get a JSON content-type: the
  // browser has to set multipart/form-data with its own boundary.
  const isFormData = options.body instanceof FormData;

  // Fetch CSRF token for mutating requests
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers as Record<string, string>),
  };

  if (isMutating) {
    const csrfToken = await getCsrfToken();
    headers["x-csrf-token"] = csrfToken;
  }

  assertOperationLifetime(operation);
  const response = await protectedFetch(`/api${endpoint}`, {
    ...options,
    headers,
    credentials: "include",
  }, operation);
  assertOperationLifetime(operation);

  // 204 No Content carries an EMPTY body, so response.json() would reject with
  // a SyntaxError. Endpoints that answer 204 (e.g. DELETE
  // /api/ai/conversations/:id) resolve to undefined instead — callers type
  // these as Promise<void>. 204 is always a success status, so this returns
  // before the error handling below.
  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json();
  assertOperationLifetime(operation);

  if (!response.ok) {
    // Clear CSRF token on 403 (might be invalid)
    if (response.status === 403) {
      clearCsrfToken();
      // A stale CSRF token (e.g. login regenerated the session) self-heals: drop
      // the cached token and retry the mutation once with a freshly fetched one.
      if (isMutating && data.error?.code === "CSRF_INVALID" && !csrfRetried) {
        return apiCall<T>(endpoint, options, retryOnStepUp, true, operation);
      }
    }

    // Step-up ("sudo mode"): on 401 STEP_UP_REQUIRED, prompt for re-auth and
    // retry the original request once.
    if (
      retryOnStepUp &&
      response.status === 401 &&
      (data?.error?.code === "STEP_UP_REQUIRED" || data?.requiresStepUp) &&
      stepUpHandler
    ) {
      assertOperationLifetime(operation);
      const verified = await stepUpHandler(data?.level ?? "SETTINGS");
      assertOperationLifetime(operation);
      if (verified) {
        return apiCall<T>(endpoint, options, false, csrfRetried, operation);
      }
    }

    const error = new Error(
      data.error?.message || "API request failed",
    ) as ApiError;
    error.code = data.error?.code;
    error.details = data.error?.details;
    // ValidationError serializes per-field messages as error.fields (not
    // details); surface them so callers can show the specific field message.
    error.fields = data.error?.fields;
    error.status = response.status;
    error.retryAfterSeconds = readRetryAfterSeconds(response);
    throw error;
  }

  return data;
}

// Generate idempotency key for offline support
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

// ============================================================================
// AUTH API
// ============================================================================

export const authApi = {
  async logout(): Promise<void> {
    const operation = beginSessionTransition(true);
    try { await apiCall<ApiResponse<unknown>>("/auth/logout", { method: "POST" }, false, false, operation); }
    finally { completeSessionTransition(operation); }
    await unsubscribeThisBrowserFromPush();
  },
};

async function readAccountExportBlob(response: Response, operation: OperationLifetime | null): Promise<Blob> {
  await throwIfResNotOk(response);
  assertOperationLifetime(operation);
  const blob = await response.blob();
  assertOperationLifetime(operation);
  return blob;
}

// ============================================================================
// ACCOUNTS API
// ============================================================================

export const accountsApi = {
  /**
   * List all accounts
   * TODO-024: Added ownerUserId for server-side filtering
   */
  async list(params?: {
    includeArchived?: boolean;
    includeHidden?: boolean;
    ownerUserId?: string | null;
  }): Promise<Account[]> {
    const query = new URLSearchParams();
    if (params?.includeArchived) query.set("includeArchived", "true");
    if (params?.includeHidden) query.set("includeHidden", "true");
    if (params?.ownerUserId !== undefined) {
      // null means "shared" accounts, undefined means "all"
      query.set("ownerUserId", params.ownerUserId ?? "shared");
    }
    const queryStr = query.toString();
    const response = await apiCall<ApiResponse<Account[]>>(
      `/accounts${queryStr ? `?${queryStr}` : ""}`,
    );
    return response.data;
  },

  /**
   * Get account by ID
   */
  async get(id: string): Promise<Account> {
    const response = await apiCall<ApiResponse<Account>>(`/accounts/${id}`);
    return response.data;
  },

  /**
   * Get net worth summary
   */
  async getSummary(): Promise<NetWorthSummary> {
    const response =
      await apiCall<ApiResponse<NetWorthSummary>>("/accounts/summary");
    return response.data;
  },

  /**
   * Create a new account
   */
  async create(data: CreateAccountInput): Promise<Account> {
    const response = await apiCall<ApiResponse<Account>>("/accounts", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  /**
   * Update an account
   */
  async update(id: string, data: UpdateAccountInput): Promise<Account> {
    const response = await apiCall<ApiResponse<Account>>(`/accounts/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  /**
   * Delete an account (soft delete)
   */
  async delete(id: string): Promise<void> {
    await apiCall<ApiResponse<{ message: string }>>(`/accounts/${id}`, {
      method: "DELETE",
    });
  },

  /**
   * Adjust account balance
   */
  async adjustBalance(
    id: string,
    data: BalanceAdjustmentInput,
  ): Promise<{ account: Account; transactionId: string }> {
    const response = await apiCall<
      ApiResponse<{ account: Account; transactionId: string }>
    >(`/accounts/${id}/adjust-balance`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  /**
   * Archive an account
   */
  async archive(id: string): Promise<Account> {
    const response = await apiCall<ApiResponse<Account>>(
      `/accounts/${id}/archive`,
      {
        method: "POST",
      },
    );
    return response.data;
  },

  /**
   * Unarchive an account
   */
  async unarchive(id: string): Promise<Account> {
    const response = await apiCall<ApiResponse<Account>>(
      `/accounts/${id}/unarchive`,
      {
        method: "POST",
      },
    );
    return response.data;
  },

  /**
   * Get balance history for an account
   */
  async getBalanceHistory(
    id: string,
    dateRange: string = "1m",
  ): Promise<BalanceHistoryPoint[]> {
    const response = await apiCall<ApiResponse<BalanceHistoryPoint[]>>(
      `/accounts/${id}/balance-history?dateRange=${dateRange}`,
    );
    return response.data;
  },

  /**
   * Get net worth history for charts
   * @param scope - "user" (default, filtered by visibility) or "household" (admin/owner only)
   */
  async getNetWorthHistory(
    dateRange: string = "1m",
    scope: "user" | "household" = "user",
    includeAccounts = false,
    accountOwnerUserId?: string | null,
  ): Promise<NetWorthHistory> {
    const query = new URLSearchParams({ dateRange, scope });
    if (includeAccounts) query.set("includeAccounts", "true");
    if (includeAccounts && accountOwnerUserId !== undefined) query.set("ownerUserId", accountOwnerUserId === null ? "shared" : accountOwnerUserId);
    const response = await apiCall<ApiResponse<NetWorthHistory>>(
      `/accounts/net-worth/history?${query.toString()}`,
    );
    return response.data;
  },

  /**
   * Export transactions as CSV (returns blob URL)
   */
  async exportTransactions(
    id: string,
    options?: { startDate?: string; endDate?: string },
    operation = captureOperationLifetime(),
  ): Promise<Blob> {
    const query = new URLSearchParams();
    if (options?.startDate) query.set("startDate", options.startDate);
    if (options?.endDate) query.set("endDate", options.endDate);
    const queryStr = query.toString();
    const response = await protectedFetch(
      `/api/accounts/${id}/transactions/export${
        queryStr ? `?${queryStr}` : ""
      }`,
      { credentials: "include" },
      operation,
    );
    return readAccountExportBlob(response, operation);
  },

  /**
   * Export balance history as CSV
   */
  async exportBalanceHistory(id: string, operation = captureOperationLifetime()): Promise<Blob> {
    const response = await protectedFetch(`/api/accounts/${id}/balance-history/export`, {
      credentials: "include",
    }, operation);
    return readAccountExportBlob(response, operation);
  },

  /**
   * Import balance history
   */
  async importBalanceHistory(
    id: string,
    data: { date: string; amount: string }[],
  ): Promise<{ imported: number }> {
    const response = await apiCall<ApiResponse<{ imported: number }>>(
      `/accounts/${id}/balance-history/import`,
      {
        method: "POST",
        body: JSON.stringify({ data }),
      },
    );
    return response.data;
  },

  /**
   * Import transactions
   */
  async importTransactions(
    id: string,
    transactions: TransactionImportRow[],
    adjustBalance: boolean = false,
    possibleDuplicateDecisions: TransactionImportDecision[] = [],
  ): Promise<TransactionImportResult> {
    const response = await apiCall<
      ApiResponse<TransactionImportResult>
    >(`/accounts/${id}/transactions/import`, {
      method: "POST",
      body: JSON.stringify({ transactions, adjustBalance, possibleDuplicateDecisions }),
    });
    return response.data;
  },

  /**
   * Update account settings (visibility toggles)
   */
  async updateSettings(
    id: string,
    settings: AccountSettings,
  ): Promise<Account> {
    const response = await apiCall<ApiResponse<Account>>(
      `/accounts/${id}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify(settings),
      },
    );
    return response.data;
  },

  /**
   * Export accounts summary as CSV
   */
  async exportSummary(operation = captureOperationLifetime()): Promise<Blob> {
    const response = await protectedFetch("/api/accounts/summary/export", {
      credentials: "include",
    }, operation);
    return readAccountExportBlob(response, operation);
  },
};

// ============================================================================
// TRANSACTIONS API
// ============================================================================

function transactionQueryParams(params?: ListTransactionsParams) {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", params.limit.toString());
  if (params?.offset) query.set("offset", params.offset.toString());
  if (params?.accountId) query.set("accountId", params.accountId);
  if (params?.categoryId) query.set("categoryId", params.categoryId);
  if (params?.merchantId) query.set("merchantId", params.merchantId);
  if (params?.type) query.set("type", params.type);
  if (params?.startDate) query.set("startDate", params.startDate);
  if (params?.endDate) query.set("endDate", params.endDate);
  if (params?.ownerUserId !== undefined) {
    query.set("ownerUserId", params.ownerUserId || "shared");
  }
  if (params?.search) query.set("search", params.search);
  if (params?.amountMin !== undefined)
    query.set("amountMin", params.amountMin.toString());
  if (params?.amountMax !== undefined)
    query.set("amountMax", params.amountMax.toString());
  if (params?.reviewed) query.set("reviewed", params.reviewed);
  if (params?.tagIds && params.tagIds.length > 0) {
    query.set("tags", params.tagIds.join(","));
  }
  return query;
}

export const transactionsApi = {
  /**
   * List transactions with pagination and filters
   */
  async list(params?: ListTransactionsParams): Promise<{
    transactions: Transaction[];
    pagination: {
      // Legacy fields
      limit: number;
      offset: number;
      count: number;
      totalCount: number;
      // V7 pagination format (CLAUDE.md Response Format Rules)
      total: number;
      page: number;
      pageSize: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    const query = transactionQueryParams(params);
    const queryStr = query.toString();
    const response = await apiCall<PaginatedResponse<Transaction[]>>(
      `/transactions${queryStr ? `?${queryStr}` : ""}`,
    );
    return { transactions: response.data, pagination: response.pagination };
  },

  /**
   * Get transaction by ID
   */
  async get(id: string): Promise<Transaction> {
    const response = await apiCall<ApiResponse<Transaction>>(
      `/transactions/${id}`,
    );
    return response.data;
  },

  /**
   * Get transaction summary for a date range
   * R-09: Extended to accept ownerUserId, type, and accountId filters
   */
  async getSummary(params: Omit<ListTransactionsParams, "limit" | "offset"> & { startDate: string; endDate: string }, signal?: AbortSignal): Promise<TransactionSummary> {
    const query = transactionQueryParams(params);
    const response = await apiCall<ApiResponse<TransactionSummary>>(
      `/transactions/summary?${query.toString()}`, { signal },
    );
    return response.data;
  },

  /**
   * Create a new transaction
   */
  async create(
    data: CreateTransactionInput,
  ): Promise<{ transaction: Transaction; isDuplicate: boolean }> {
    const response = await apiCall<
      ApiResponse<Transaction> & { isDuplicate?: boolean }
    >("/transactions", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return {
      transaction: response.data,
      isDuplicate: response.isDuplicate ?? false,
    };
  },

  /**
   * Create a transfer (two transactions)
   */
  async createTransfer(data: CreateTransferInput): Promise<{
    outflow: Transaction;
    inflow: Transaction;
    isDuplicate: boolean;
  }> {
    const response = await apiCall<
      ApiResponse<{ outflow: Transaction; inflow: Transaction }> & {
        isDuplicate?: boolean;
      }
    >("/transactions/transfer", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return { ...response.data, isDuplicate: response.isDuplicate ?? false };
  },

  /**
   * Update a transfer (both sides)
   */
  async updateTransfer(
    id: string,
    data: UpdateTransferInput,
  ): Promise<{ outflow: Transaction; inflow: Transaction }> {
    const response = await apiCall<
      ApiResponse<{ outflow: Transaction; inflow: Transaction }>
    >(`/transactions/transfer/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  /**
   * Update a transaction
   */
  async update(id: string, data: UpdateTransactionInput): Promise<Transaction> {
    const response = await apiCall<ApiResponse<Transaction>>(
      `/transactions/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
    return response.data;
  },

  /**
   * Mark transaction as reviewed/unreviewed (dedicated endpoint)
   */
  async review(id: string, reviewed: boolean): Promise<Transaction> {
    const response = await apiCall<ApiResponse<Transaction>>(
      `/transactions/${id}/review`,
      {
        method: "PUT",
        body: JSON.stringify({ reviewed }),
      },
    );
    return response.data;
  },

  /**
   * Delete a transaction (soft delete)
   */
  async delete(id: string): Promise<void> {
    await apiCall<ApiResponse<{ message: string }>>(`/transactions/${id}`, {
      method: "DELETE",
    });
  },

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  /**
   * Bulk update transaction category
   */
  async bulkUpdateCategory(
    transactionIds: string[],
    categoryId: string | null,
  ): Promise<{ successCount: number; totalCount: number }> {
    const response = await apiCall<
      ApiResponse<{ successCount: number; totalCount: number }>
    >("/transactions/bulk-category", {
      method: "PUT",
      body: JSON.stringify({ transactionIds, categoryId }),
    });
    return response.data;
  },

  /**
   * Bulk mark transactions as reviewed/unreviewed
   */
  async bulkReview(
    transactionIds: string[],
    reviewed: boolean = true,
  ): Promise<{ successCount: number; totalCount: number }> {
    const response = await apiCall<
      ApiResponse<{ successCount: number; totalCount: number }>
    >("/transactions/bulk-review", {
      method: "PUT",
      body: JSON.stringify({ transactionIds, reviewed }),
    });
    return response.data;
  },

  /**
   * Bulk add tags to transactions
   */
  async bulkAddTags(
    transactionIds: string[],
    tagIds: string[],
  ): Promise<{ successCount: number; totalCount: number }> {
    const response = await apiCall<
      ApiResponse<{ successCount: number; totalCount: number }>
    >("/transactions/bulk-tags", {
      method: "PUT",
      body: JSON.stringify({ transactionIds, tagIds }),
    });
    return response.data;
  },

  /**
   * Bulk delete transactions
   */
  async bulkDelete(
    transactionIds: string[],
  ): Promise<{ successCount: number; totalCount: number }> {
    const response = await apiCall<
      ApiResponse<{ successCount: number; totalCount: number }>
    >("/transactions/bulk", {
      method: "DELETE",
      body: JSON.stringify({ transactionIds }),
    });
    return response.data;
  },
};

// ============================================================================
// TAGS API
// ============================================================================

// Tag types
export interface Tag {
  id: string;
  householdId: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  memberSpecific: boolean;
  memberId?: string | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTagInput {
  name: string;
  color?: string | null;
  icon?: string | null;
  memberSpecific?: boolean;
  memberId?: string | null;
}

export interface UpdateTagInput {
  name?: string;
  color?: string | null;
  icon?: string | null;
}

export interface TransactionTagInfo {
  id: string;
  name: string;
  color?: string | null;
  icon?: string | null;
}

export const tagsApi = {
  /**
   * List all tags for household
   */
  async list(): Promise<Tag[]> {
    const response =
      await apiCall<ApiResponse<Tag[] | { tags: Tag[] }>>("/tags");
    const data = response.data;
    if (Array.isArray(data)) {
      return data;
    }
    return data?.tags ?? [];
  },

  /**
   * Get a single tag by ID
   */
  async get(id: string): Promise<Tag> {
    const response = await apiCall<ApiResponse<Tag>>(`/tags/${id}`);
    return response.data;
  },

  /**
   * Create a new tag
   */
  async create(data: CreateTagInput): Promise<Tag> {
    const response = await apiCall<ApiResponse<Tag>>("/tags", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  /**
   * Update a tag
   */
  async update(id: string, data: UpdateTagInput): Promise<Tag> {
    const response = await apiCall<ApiResponse<Tag>>(`/tags/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  /**
   * Delete a tag
   */
  async delete(id: string): Promise<void> {
    await apiCall<ApiResponse<{ message: string }>>(`/tags/${id}`, {
      method: "DELETE",
    });
  },

  /**
   * Get transactions with a specific tag
   */
  async getTransactions(
    id: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      date: string;
      name: string;
      amount: string;
      type: string;
    }>
  > {
    const response = await apiCall<
      ApiResponse<
        Array<{
          id: string;
          date: string;
          name: string;
          amount: string;
          type: string;
        }>
      >
    >(`/tags/${id}/transactions?limit=${limit}`);
    return response.data;
  },

  /**
   * Get all tags for a transaction
   */
  async getTransactionTags(
    transactionId: string,
  ): Promise<TransactionTagInfo[]> {
    const response = await apiCall<ApiResponse<TransactionTagInfo[]>>(
      `/tags/transaction/${transactionId}`,
    );
    return response.data;
  },

  /**
   * Add tags to a transaction
   */
  async addTagsToTransaction(
    transactionId: string,
    tagIds: string[],
  ): Promise<TransactionTagInfo[]> {
    const response = await apiCall<ApiResponse<TransactionTagInfo[]>>(
      `/tags/transaction/${transactionId}`,
      {
        method: "POST",
        body: JSON.stringify({ tagIds }),
      },
    );
    return response.data;
  },

  /**
   * Replace all tags on a transaction
   */
  async setTransactionTags(
    transactionId: string,
    tagIds: string[],
  ): Promise<TransactionTagInfo[]> {
    const response = await apiCall<ApiResponse<TransactionTagInfo[]>>(
      `/tags/transaction/${transactionId}`,
      {
        method: "PUT",
        body: JSON.stringify({ tagIds }),
      },
    );
    return response.data;
  },

  /**
   * Remove a tag from a transaction
   */
  async removeTagFromTransaction(
    transactionId: string,
    tagId: string,
  ): Promise<void> {
    await apiCall<ApiResponse<{ message: string }>>(
      `/tags/transaction/${transactionId}/${tagId}`,
      {
        method: "DELETE",
      },
    );
  },

  /**
   * Merge multiple tags into a target tag
   * All transaction associations from source tags are moved to target tag
   */
  async merge(
    sourceTagIds: string[],
    targetTagId: string,
  ): Promise<{
    targetTag: Tag;
    mergedTagIds: string[];
    mergedTagNames: string[];
  }> {
    const response = await apiCall<
      ApiResponse<{
        targetTag: Tag;
        mergedTagIds: string[];
        mergedTagNames: string[];
      }>
    >("/tags/merge", {
      method: "POST",
      body: JSON.stringify({ sourceTagIds, targetTagId }),
    });
    return response.data;
  },

  /**
   * Archive a tag (removes from active list)
   */
  async archive(id: string): Promise<Tag> {
    const response = await apiCall<ApiResponse<Tag>>(`/tags/${id}/archive`, {
      method: "POST",
    });
    return response.data;
  },

  /**
   * Get tag analytics (top tags by usage)
   */
  async getAnalytics(limit = 20): Promise<{
    topTags: Array<{
      id: string;
      name: string;
      color: string | null;
      usageCount: number;
      percentage: number;
    }>;
    summary: {
      totalTags: number;
      totalUsage: number;
      averageUsage: number;
    };
  }> {
    const response = await apiCall<
      ApiResponse<{
        topTags: Array<{
          id: string;
          name: string;
          color: string | null;
          usageCount: number;
          percentage: number;
        }>;
        summary: {
          totalTags: number;
          totalUsage: number;
          averageUsage: number;
        };
      }>
    >(`/tags/analytics?limit=${limit}`);
    return response.data;
  },
};

// ============================================================================
// RULES API (Auto-Categorization)
// ============================================================================

export interface RuleCondition {
  type: ConditionType;
  operator: Operator;
  value: string | number | string[];
  value2?: string | number;
  enabled?: boolean;
}

export interface SplitConfig {
  categoryId?: string;
  amount?: string; // decimal money string ("25.00"), never a float
  percentage?: number;
  note?: string;
  merchantName?: string;
}

export interface RuleAction {
  type: ActionType;
  value?: string | string[];
  enabled?: boolean;
  splitConfig?: SplitConfig[];
}

export interface Rule {
  id: string;
  householdId: string;
  name: string;
  conditions: RuleCondition[];
  conditionLogic: "all" | "any";
  actions: RuleAction[];
  enabled: boolean;
  applyToPast?: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
  splitConfig?: SplitConfig[];
}

export interface CreateRuleInput {
  name: string;
  conditions: RuleCondition[];
  conditionLogic?: "all" | "any";
  actions: RuleAction[];
  enabled?: boolean;
  priority?: number;
  applyToPast?: boolean;
}

export const rulesApi = {
  async list(): Promise<Rule[]> {
    const response = await apiCall<ApiResponse<{ rules: Rule[] }>>("/rules");
    return response.data.rules;
  },

  async get(id: string): Promise<Rule> {
    const response = await apiCall<ApiResponse<{ rule: Rule }>>(`/rules/${id}`);
    return response.data.rule;
  },

  async create(data: CreateRuleInput): Promise<Rule> {
    const response = await apiCall<ApiResponse<{ rule: Rule }>>("/rules", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.data.rule;
  },

  async update(id: string, data: Partial<CreateRuleInput>): Promise<Rule> {
    const response = await apiCall<ApiResponse<{ rule: Rule }>>(
      `/rules/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
    return response.data.rule;
  },

  async delete(id: string): Promise<void> {
    await apiCall<ApiResponse<{ rule: Rule }>>(`/rules/${id}`, {
      method: "DELETE",
    });
  },
};

// ============================================================================
// RECURRING API
// ============================================================================

export interface RecurringRule {
  id: string;
  householdId: string;
  name: string;
  amount: MoneyDto;
  frequency:
    | "daily"
    | "weekly"
    | "biweekly"
    | "monthly"
    | "quarterly"
    | "yearly";
  nextDueDate: string;
  categoryId?: string;
  accountId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecurringInput {
  name: string;
  amount: MoneyDto;
  frequency:
    | "daily"
    | "weekly"
    | "biweekly"
    | "monthly"
    | "quarterly"
    | "yearly";
  nextDueDate?: string;
  categoryId?: string;
  accountId?: string;
}

export interface CreateRecurringFromTransactionInput {
  frequency:
    | "daily"
    | "weekly"
    | "biweekly"
    | "monthly"
    | "quarterly"
    | "yearly";
  name?: string;
}

export const recurringApi = {
  async list(): Promise<RecurringRule[]> {
    const response = await apiCall<ApiResponse<RecurringRule[]>>("/recurring");
    return response.data;
  },

  async get(id: string): Promise<RecurringRule> {
    const response = await apiCall<ApiResponse<RecurringRule>>(
      `/recurring/${id}`,
    );
    return response.data;
  },

  async create(data: CreateRecurringInput): Promise<RecurringRule> {
    const response = await apiCall<ApiResponse<RecurringRule>>("/recurring", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return response.data;
  },

  async createFromTransaction(
    transactionId: string,
    data: CreateRecurringFromTransactionInput,
  ): Promise<RecurringRule> {
    const response = await apiCall<ApiResponse<RecurringRule>>(
      `/recurring/transaction/${transactionId}`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
    return response.data;
  },

  async update(
    id: string,
    data: Partial<CreateRecurringInput>,
  ): Promise<RecurringRule> {
    const response = await apiCall<ApiResponse<RecurringRule>>(
      `/recurring/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      },
    );
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiCall<ApiResponse<{ message: string }>>(`/recurring/${id}`, {
      method: "DELETE",
    });
  },
};

// ============================================================================
// SECURITY API (step-up re-authentication)
// ============================================================================

export const securityApi = {
  /**
   * Verify step-up ("sudo mode") with the current password (works for all
   * users) or an emailed MFA code (for enrolled users). Passes
   * retryOnStepUp=false so the step-up call never recurses into step-up
   * handling.
   */
  async stepUp(payload: { password?: string; code?: string }): Promise<void> {
    await apiCall<ApiResponse<unknown>>(
      "/settings/security/step-up",
      { method: "POST", body: JSON.stringify(payload) },
      false,
    );
  },

  /**
   * Revoke a single session. Step-up gated → the 401 triggers the dialog and
   * the request retries automatically after re-auth.
   */
  async revokeSession(sessionId: string): Promise<void> {
    await apiCall(`/settings/security/sessions/${sessionId}`, {
      method: "DELETE",
    });
  },

  /**
   * Revoke all sessions except the current one. Step-up gated.
   */
  async revokeAllOtherSessions(): Promise<void> {
    await apiCall("/settings/security/sessions", { method: "DELETE" });
  },

  /**
   * Change the account password. Step-up gated. Sends confirmPassword to match
   * the server's changePasswordSchema.
   */
  async changePassword(input: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<void> {
    await apiCall("/settings/security/password", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
};

/**
 * Combined API object for convenience
 * Provides access to all API endpoints
 */
export const api = {
  auth: authApi,
  accounts: accountsApi,
  transactions: transactionsApi,
  tags: tagsApi,
  rules: rulesApi,
  recurring: recurringApi,
  security: securityApi,
};
