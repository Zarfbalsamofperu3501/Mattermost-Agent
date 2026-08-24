import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdempotencyManager } from '../src/infrastructure/mattermost/services/idempotency';

describe('IdempotencyManager', () => {
  let manager: IdempotencyManager;

  beforeEach(() => {
    manager = new IdempotencyManager({ ttlMs: 100 });
  });

  it('executes function and caches the result for identical key', async () => {
    let executionCount = 0;

    const fn = vi.fn().mockImplementation(async () => {
      executionCount++;
      return { id: `post-${executionCount}`, success: true };
    });

    const res1 = await manager.execute<{ id: string; success: boolean }>('test-key-1', fn);
    const res2 = await manager.execute<{ id: string; success: boolean }>('test-key-1', fn);

    expect(res1.id).toBe('post-1');
    expect(res2.id).toBe('post-1');
    expect(executionCount).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs independently without key (undefined or empty)', async () => {
    let counter = 0;
    const fn = async () => ++counter;

    const res1 = await manager.execute<number>(undefined, fn);
    const res2 = await manager.execute<number>(undefined, fn);

    expect(res1).toBe(1);
    expect(res2).toBe(2);
  });

  it('shares in-flight promise for concurrent identical executions', async () => {
    let callCount = 0;

    const slowFn = vi.fn().mockImplementation(async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { count: callCount };
    });

    // Trigger two executions in parallel with same key
    const [res1, res2] = await Promise.all([
      manager.execute<{ count: number }>('concurrent-key', slowFn),
      manager.execute<{ count: number }>('concurrent-key', slowFn),
    ]);

    expect(res1.count).toBe(1);
    expect(res2.count).toBe(1);
    expect(callCount).toBe(1);
    expect(slowFn).toHaveBeenCalledTimes(1);
  });

  it('re-executes when cached result expires after TTL', async () => {
    const shortTtlManager = new IdempotencyManager({ ttlMs: 20 });
    let runCount = 0;

    const fn = vi.fn().mockImplementation(async () => {
      runCount++;
      return { run: runCount };
    });

    const res1 = await shortTtlManager.execute<{ run: number }>('ttl-key', fn);
    expect(res1.run).toBe(1);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 35));

    const res2 = await shortTtlManager.execute<{ run: number }>('ttl-key', fn);
    expect(res2.run).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears cache and allows immediate re-execution via clear()', async () => {
    let count = 0;
    const fn = async () => ++count;

    const res1 = await manager.execute<number>('clear-test-key', fn);
    expect(res1).toBe(1);

    manager.clear();

    const res2 = await manager.execute<number>('clear-test-key', fn);
    expect(res2).toBe(2);
  });

  it('handles and cleans up in-flight execution when function throws error', async () => {
    let attempts = 0;
    const failingFn = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('Temporary network glitch');
      }
      return { status: 'recovered' };
    });

    // First attempt fails
    await expect(manager.execute('failing-key', failingFn)).rejects.toThrow('Temporary network glitch');

    // Second attempt should not be blocked and should re-execute
    const res = await manager.execute<{ status: string }>('failing-key', failingFn);
    expect(res.status).toBe('recovered');
    expect(attempts).toBe(2);
  });
});
