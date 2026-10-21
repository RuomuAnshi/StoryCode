/**
 * Typed error hierarchy so the UI can render actionable messages instead of
 * "Something went wrong", and so tests can assert on failure modes.
 */

export type StoryCodeErrorCode =
  | 'PATH_UNSAFE'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'VERSION_CONFLICT'
  | 'VALIDATION_FAILED'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_UNSUPPORTED'
  | 'NETWORK_ERROR'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'PERMISSION_DENIED'
  | 'STORAGE_ERROR'
  | 'CONFIG_ERROR'
  | 'INTERNAL';

export class StoryCodeError extends Error {
  override readonly name: string = 'StoryCodeError';
  constructor(
    readonly code: StoryCodeErrorCode,
    message: string,
    readonly detail?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }

  /** Safe, secret-free serialization for logging and UI display. */
  toJSON(): { code: StoryCodeErrorCode; message: string; detail?: Record<string, unknown> } {
    return this.detail
      ? { code: this.code, message: this.message, detail: this.detail }
      : { code: this.code, message: this.message };
  }
}

export class NotFoundError extends StoryCodeError {
  override readonly name = 'NotFoundError';
  constructor(what: string, detail?: Record<string, unknown>) {
    super('NOT_FOUND', `${what} not found`, detail);
  }
}

export class VersionConflictError extends StoryCodeError {
  override readonly name = 'VersionConflictError';
  constructor(
    readonly filePath: string,
    readonly expectedHash: string | null,
    readonly actualHash: string | null,
  ) {
    super('VERSION_CONFLICT', `File changed since the proposal was generated: ${filePath}`, {
      filePath,
      expectedHash,
      actualHash,
    });
  }
}

export class ValidationError extends StoryCodeError {
  override readonly name = 'ValidationError';
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super('VALIDATION_FAILED', message, { issues });
  }
}

export class CancelledError extends StoryCodeError {
  override readonly name = 'CancelledError';
  constructor(message = 'Operation cancelled') {
    super('CANCELLED', message);
  }
}

export class ProviderError extends StoryCodeError {
  override readonly name = 'ProviderError';
  constructor(message: string, detail?: Record<string, unknown>, options?: { cause?: unknown }) {
    super('PROVIDER_ERROR', message, detail, options);
  }
}

/** Converts unknown thrown values into a StoryCodeError. */
export function toStoryCodeError(error: unknown): StoryCodeError {
  if (error instanceof StoryCodeError) return error;
  if (error instanceof Error) {
    return new StoryCodeError('INTERNAL', error.message, undefined, { cause: error });
  }
  return new StoryCodeError('INTERNAL', String(error));
}

/** User-facing message; never includes stack traces or secrets. */
export function describeError(error: unknown): string {
  const e = toStoryCodeError(error);
  switch (e.code) {
    case 'VERSION_CONFLICT':
      return '文件在生成建议后已被修改，请重新生成。';
    case 'NOT_FOUND':
      return `未找到：${e.message}`;
    case 'PATH_UNSAFE':
      return `路径不安全，已拒绝：${e.message}`;
    case 'PROVIDER_ERROR':
      return `模型请求失败：${e.message}`;
    case 'PROVIDER_UNSUPPORTED':
      return '当前模型不支持工具调用，无法执行文件修改。';
    case 'NETWORK_ERROR':
      return '网络连接失败，请检查网络或模型配置。';
    case 'CANCELLED':
      return '已取消。';
    case 'TIMEOUT':
      return '请求超时，请重试。';
    case 'VALIDATION_FAILED':
      return `数据结构校验失败：${e.message}`;
    default:
      return e.message;
  }
}
