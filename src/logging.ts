/**
 * Logging utilities with sensitive data redaction
 */

const SENSITIVE_PATTERNS = [
  /password/i,
  /privatekey/i,
  /passphrase/i,
  /sudopassword/i,
  /secret/i,
  /token/i,
  /credential/i,
  /auth/i,
  /api.?key/i,
  /bearer/i,
  /private.?key/i,
  /pem/i,
];
const REDACTED = "****";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && !!value;
}

function shouldPreserveSensitiveValue(value: unknown): boolean {
  return value === null || value === undefined || value === "" || typeof value === "boolean";
}

/**
 * Redacts sensitive information from an object
 */
export function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData);
  }

  if (isRecord(obj)) {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(key))) {
        redacted[key] = shouldPreserveSensitiveValue(value) ? value : REDACTED;
      } else {
        redacted[key] = redactSensitiveData(value);
      }
    }
    return redacted;
  }

  return obj;
}

/**
 * Redacts sensitive information from error messages and stack traces
 */
export function redactErrorMessage(message: string): string {
  // Common patterns that might contain sensitive data
  const patterns = [
    /password[=:\s]+[^\s]+/gi,
    /key[=:\s]+[^\s]+/gi,
    /passphrase[=:\s]+[^\s]+/gi,
    /auth[=:\s]+[^\s]+/gi,
    /token[=:\s]+[^\s]+/gi,
    /api.?key[=:\s]+[^\s]+/gi,
    /bearer\s+[^\s]+/gi,
    /private.?key[=:\s]+[^\s]+/gi,
    /pem[=:\s]+[^\s]+/gi,
    /-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/gi,
  ];

  let redacted = message;
  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, REDACTED);
  }

  return redacted;
}

/**
 * Logger levels
 */
export enum LogLevel {
  SILENT = -1,
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export type LogFormat = "plain" | "json";

/**
 * Simple logger with redaction
 */
export class Logger {
  constructor(
    private readonly level: LogLevel = LogLevel.INFO,
    private readonly format: LogFormat = "plain",
  ) {}

  private writePlain(timestamp: string, levelName: string, message: string, data?: unknown): void {
    let output = `[${timestamp}] ${levelName}: ${message}`;

    if (data !== undefined) {
      output += ` ${JSON.stringify(data)}`;
    }

    process.stderr.write(`${output}\n`);
  }

  private writeJson(timestamp: string, levelName: string, message: string, data?: unknown): void {
    const output = {
      timestamp,
      level: levelName.toLowerCase(),
      message,
      ...(data !== undefined ? { data } : {}),
    };

    process.stderr.write(`${JSON.stringify(output)}\n`);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (level > this.level) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    const redactedData = data !== undefined ? redactSensitiveData(data) : undefined;

    if (this.format === "json") {
      this.writeJson(timestamp, levelName, message, redactedData);
      return;
    }

    this.writePlain(timestamp, levelName, message, redactedData);
  }

  error(message: string, data?: unknown): void {
    const redactedMessage = redactErrorMessage(message);
    this.log(LogLevel.ERROR, redactedMessage, data);
  }

  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data);
  }

  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }
}

// Global logger instance
const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  none: LogLevel.SILENT,
  off: LogLevel.SILENT,
  silent: LogLevel.SILENT,
  error: LogLevel.ERROR,
  warn: LogLevel.WARN,
  info: LogLevel.INFO,
  debug: LogLevel.DEBUG,
};
const LOG_FORMAT_MAP: Record<string, LogFormat> = {
  plain: "plain",
  pretty: "plain",
  json: "json",
};

const envLogLevel = process.env.LOG_LEVEL?.toLowerCase() ?? "info";
const logLevel = LOG_LEVEL_MAP[envLogLevel] ?? LogLevel.INFO;
const envLogFormat = process.env.LOG_FORMAT?.toLowerCase() ?? "plain";
const logFormat = LOG_FORMAT_MAP[envLogFormat] ?? "plain";

export const logger = new Logger(logLevel, logFormat);

/**
 * Performance measurement utilities
 */
export class Timer {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  elapsed(): number {
    return Date.now() - this.startTime;
  }

  reset(): void {
    this.startTime = Date.now();
  }
}

/**
 * Creates a timer for measuring operation duration
 */
export function createTimer(): Timer {
  return new Timer();
}
