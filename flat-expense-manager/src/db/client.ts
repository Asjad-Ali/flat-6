/**
 * Minimal database contract used by every repository.
 * expo-sqlite's SQLiteDatabase satisfies it in the app; tests use a node:sqlite adapter,
 * which lets the real SQL and business rules be tested without a device.
 */
export type SqlValue = string | number | null;

export interface Db {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export type AppErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'DUPLICATE' | 'LOCKED' | 'CONFLICT' | 'OFFLINE' | 'FORBIDDEN';

/** A user-facing error: its message is safe to show in the UI. */
export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

/** Checks by `code` rather than `instanceof`, which is unreliable for transpiled Error subclasses. */
export function isAppError(error: unknown, code?: AppErrorCode): error is AppError {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const c = (error as { code: unknown }).code;
  return code ? c === code : typeof c === 'string';
}

export function errorMessage(error: unknown): string {
  if (isAppError(error)) return error.message;
  if (error instanceof Error) return `Something went wrong: ${error.message}`;
  return 'Something went wrong. Please try again.';
}

/** Runs `task` in a transaction and returns its result. */
export async function transaction<T>(db: Db, task: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  await db.withTransactionAsync(async () => {
    result = await task();
  });
  return result as T;
}
