export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_NOT_AUTHORIZED'
  | 'CATALOG_EPOCH_MISMATCH'
  | 'INTERNAL';

export interface ApiError {
  code: ErrorCode;
  message: string;
  retryAfterSec?: number;
  fieldErrors?: Record<string, string[]>;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };
