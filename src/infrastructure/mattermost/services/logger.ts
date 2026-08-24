import { sanitizeSecret } from '../../../domain/mattermost/errors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface StructuredLogPayload {
  action?: string;
  channelId?: string;
  messageId?: string;
  requestId?: string;
  durationMs?: number;
  errorCode?: string;
  [key: string]: unknown;
}

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'info') {
    this.level = level;
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private sanitizePayload(payload?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!payload) return undefined;
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(payload)) {
      const lowerKey = key.toLowerCase();
      // Exclude tokens, authorization headers, cookies, passwords, session data
      if (
        lowerKey.includes('token') ||
        lowerKey.includes('auth') ||
        lowerKey.includes('cookie') ||
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('session')
      ) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        sanitized[key] = sanitizeSecret(value);
      } else if (value instanceof Error) {
        sanitized[key] = {
          name: value.name,
          message: sanitizeSecret(value.message),
          stack: value.stack ? sanitizeSecret(value.stack) : undefined,
        };
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizePayload(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  public debug(message: string, payload?: Record<string, unknown>): void {
    if (!this.shouldLog('debug')) return;
    this.logOutput('DEBUG', message, payload);
  }

  public info(message: string, payload?: Record<string, unknown>): void {
    if (!this.shouldLog('info')) return;
    this.logOutput('INFO', message, payload);
  }

  public warn(message: string, payload?: Record<string, unknown>): void {
    if (!this.shouldLog('warn')) return;
    this.logOutput('WARN', message, payload);
  }

  public error(message: string, payload?: Record<string, unknown>): void {
    if (!this.shouldLog('error')) return;
    this.logOutput('ERROR', message, payload);
  }

  public event(eventName: string, payload?: StructuredLogPayload): void {
    if (!this.shouldLog('info')) return;
    const sanitized = this.sanitizePayload(payload);
    const logLine = JSON.stringify({
      timestamp: new Date().toISOString(),
      event: eventName,
      ...sanitized,
    });
    console.log(logLine);
  }

  private logOutput(levelStr: string, message: string, payload?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const sanitizedMsg = sanitizeSecret(message);
    const sanitizedPayload = this.sanitizePayload(payload);

    if (sanitizedPayload && Object.keys(sanitizedPayload).length > 0) {
      console.log(`[${timestamp}] [${levelStr}] ${sanitizedMsg} ${JSON.stringify(sanitizedPayload)}`);
    } else {
      console.log(`[${timestamp}] [${levelStr}] ${sanitizedMsg}`);
    }
  }
}

export const defaultLogger = new Logger();
