export type AppErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'DUPLICATE'
  | 'LIMIT'
  | 'PARSE'
  | 'STORAGE'
  | 'SUBSCRIPTION'
  | 'PERMISSION'
  | 'UNSUPPORTED';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly detail: string | undefined;

  constructor(code: AppErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
