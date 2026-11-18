/**
 * HTTP Response Helpers
 *
 * Standardized API response functions.
 *
 * @module core/http/responses
 */

import { Response } from "express";

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface CursorPaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    nextCursor: string | null;
    prevCursor: string | null;
    hasMore: boolean;
  };
}

/**
 * Send a successful response
 */
export function success<T>(
  res: Response,
  data: T,
  statusCode: number = 200,
  meta?: Record<string, unknown>
): void {
  res.status(statusCode).json({
    success: true,
    data,
    meta,
  } as ApiResponse<T>);
}

/**
 * Send a created response (201)
 */
export function created<T>(res: Response, data: T): void {
  success(res, data, 201);
}

/**
 * Send a no-content response (204)
 */
export function noContent(res: Response): void {
  res.status(204).send();
}

/**
 * Send a paginated response
 */
export function paginated<T>(
  res: Response,
  data: T[],
  pagination: {
    total: number;
    page: number;
    pageSize: number;
  }
): void {
  const totalPages = Math.ceil(pagination.total / pagination.pageSize);

  res.status(200).json({
    success: true,
    data,
    pagination: {
      ...pagination,
      totalPages,
      hasNext: pagination.page < totalPages,
      hasPrev: pagination.page > 1,
    },
  } as PaginatedResponse<T>);
}

/**
 * Send a cursor-paginated response
 */
export function cursorPaginated<T>(
  res: Response,
  data: T[],
  pagination: {
    nextCursor: string | null;
    prevCursor?: string | null;
    hasMore: boolean;
  }
): void {
  res.status(200).json({
    success: true,
    data,
    pagination: {
      nextCursor: pagination.nextCursor,
      prevCursor: pagination.prevCursor ?? null,
      hasMore: pagination.hasMore,
    },
  } as CursorPaginatedResponse<T>);
}
