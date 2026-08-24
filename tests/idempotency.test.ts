import { describe, it, expect, vi } from 'vitest';
import { IdempotencyManager } from '../src/infrastructure/mattermost/services/idempotency';

describe('IdempotencyManager', () => {
  it('executes function and caches the result for identical key', async () => {
    const manager = new IdempotencyManager({ ttlMs: 5000 });
    let executionCount = 0;

    const fn = vi.fn().mockImplementation(async () => {
      executionCount++;
      return { id: `post-${executionCount}`, success: true };
    });

    const res1 = await manager.execute('test-key-1', fn);
    const res2 = await manager.execute('test-key-1', fn);

    expect(res1.id).toBe('post-1');
    expect(res2.id).toBe('post-1');
    expect(executionCount).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs independently without key', async () => {
    const manager = new IdempotencyManager();
    let counter = 0;
    const fn = async () => ++counter;

    const res1 = await manager.execute(undefined, fn);
    const res2 = await manager.execute(undefined, fn);

    expect(res1).toBe(1);
    expect(res2).toBe(2);
  });

  it('shares in-flight promise for concurrent identical executions', async () => {
    const manager = new IdempotencyManager();
    let callCount = 0;

    const slowFn = vi.fn().mockImplementation(async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { count: callCount };
    });

    // Trigger two executions in parallel with same key
    const [res1, res2] = await Promise.all([
      manager.execute('concurrent-key', slowFn),
      manager.execute('concurrent-key', slowFn),
    ]);

    expect(res1.count).toBe(1);
    expect(res2.count).toBe(1);
    expect(callCount).toBe(1);
  });
});
