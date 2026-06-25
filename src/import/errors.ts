/**
 * Error classes for the import pipeline. All inherit from `ImportError` so the
 * worker can detect "expected" failures vs. unhandled exceptions and report a
 * stable error code to the page.
 */

export class ImportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

export class FileTooLargeError extends ImportError {
  readonly sizeBytes: number;
  readonly maxBytes: number;
  constructor(sizeBytes: number, maxBytes: number) {
    super('file_too_large', `File is ${sizeBytes} bytes; maximum is ${maxBytes}`);
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

export class UnsupportedFormatError extends ImportError {
  constructor(detail: string) {
    super('unsupported_format', `Unsupported file format: ${detail}`);
  }
}

export class ParserTimeoutError extends ImportError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super('parser_timeout', `Parser exceeded ${timeoutMs}ms timeout`);
    this.timeoutMs = timeoutMs;
  }
}

export class ImportValidationError extends ImportError {
  readonly issues: string[];
  constructor(issues: string[]) {
    super('validation_failed', `IR validation failed: ${issues.join('; ')}`);
    this.issues = issues;
  }
}

export class ParserCrashedError extends ImportError {
  constructor(detail: string) {
    super('parser_crashed', `Parser crashed: ${detail}`);
  }
}
