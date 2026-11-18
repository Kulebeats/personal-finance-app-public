/**
 * Pagination Utilities
 *
 * Helper functions for offset and cursor-based pagination.
 *
 * @module core/http/pagination
 */

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface CursorParams {
  cursor?: string;
  limit: number;
}

/**
 * Calculate offset from pagination params
 */
export function getOffset(params: PaginationParams): number {
  return (params.page - 1) * params.pageSize;
}

/**
 * Encode cursor data to base64url string
 */
export function encodeCursor(data: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

/**
 * Decode cursor string to data object
 */
export function decodeCursor<T = Record<string, unknown>>(
  cursor: string
): T | null {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
}
