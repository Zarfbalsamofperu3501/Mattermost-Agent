import { Logger, defaultLogger } from './logger';

export interface IdempotencyOptions {
  ttlMs?: number;
  logger?: Logger;
}

interface StoredResult<T> {
  value: T;
  expiresAt: number;
}

export class IdempotencyManager {
  private store = new Map<string, StoredResult<unknown>>();
  private inFlight = new Map<string, Promise<unknown>>();
  private ttlMs: number;
  private logger: Logger;

  constructor(options: IdempotencyOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000; // 10 minutes default
    this.logger = options.logger ?? defaultLogger;
  }

  public clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  /**
   * Executes a function protected by an idempotency key.
   * If the key already has a cached result, returns it immediately.
   * If an execution is currently in-flight for this key, awaits the existing promise.
   */
  public async execute<T>(key: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!key) {
      return fn();
    }

    const now = Date.now();

    // 1. Check cached completed result
    const cached = this.store.get(key);
    if (cached) {
      if (cached.expiresAt > now) {
        this.logger.info(`Idempotent hit for key '${key}'. Returning cached result.`);
        return cached.value as T;
      }
      this.store.delete(key);
    }

    // 2. Check in-flight promise
    const active = this.inFlight.get(key);
    if (active) {
      this.logger.info(`Concurrent duplicate execution for key '${key}'. Awaiting in-flight execution.`);
      return (await active) as T;
    }

    // 3. Start execution
    const executionPromise = (async () => {
      try {
        const result = await fn();
        this.store.set(key, {
          value: result,
          expiresAt: Date.now() + this.ttlMs,
        });
        return result;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, executionPromise);
    return executionPromise;
  }
}
