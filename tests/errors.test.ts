import { describe, it, expect } from 'vitest';
import {
  MattermostAuthenticationError,
  MattermostAuthorizationError,
  MattermostChannelNotFoundError,
  MattermostError,
  MattermostIdentityMismatchError,
  MattermostNetworkError,
  MattermostRateLimitError,
  sanitizeSecret,
} from '../src/domain/mattermost/errors';

describe('Errors & Sanitization', () => {
  it('sanitizes Bearer tokens in error messages and strings', () => {
    const raw = 'Request failed with Authorization: Bearer abcdef1234567890xyz and token="secret1234567890"';
    const sanitized = sanitizeSecret(raw);

    expect(sanitized).not.toContain('abcdef1234567890xyz');
    expect(sanitized).not.toContain('secret1234567890');
    expect(sanitized).toContain('Bearer [REDACTED]');
    expect(sanitized).toContain('token=[REDACTED]');
  });

  it('sanitizes MMAUTHTOKEN cookies and passwords', () => {
    const raw = 'Cookie: MMAUTHTOKEN=abc1234567890; password="mySecretPassword123"';
    const sanitized = sanitizeSecret(raw);

    expect(sanitized).not.toContain('abc1234567890');
    expect(sanitized).not.toContain('mySecretPassword123');
    expect(sanitized).toContain('MMAUTHTOKEN=[REDACTED]');
    expect(sanitized).toContain('password=[REDACTED]');
  });

  it('MattermostError sanitizes its own message on creation', () => {
    const err = new MattermostError('Failed with Bearer secret-token-12345', {
      code: 'CUSTOM_ERR',
      statusCode: 500,
    });

    expect(err.message).toBe('Failed with Bearer [REDACTED]');
    expect(err.code).toBe('CUSTOM_ERR');
    expect(err.statusCode).toBe(500);
    expect(err.isRetryable).toBe(false);
  });

  it('marks rate limits and network errors as retryable', () => {
    const rateLimit = new MattermostRateLimitError('Rate limited', 3000);
    expect(rateLimit.isRetryable).toBe(true);
    expect(rateLimit.statusCode).toBe(429);
    expect(rateLimit.retryAfterMs).toBe(3000);

    const networkErr = new MattermostNetworkError('Connection timeout', 504);
    expect(networkErr.isRetryable).toBe(true);
    expect(networkErr.statusCode).toBe(504);
  });

  it('marks auth and not found errors as non-retryable', () => {
    const authErr = new MattermostAuthenticationError('Invalid token');
    expect(authErr.isRetryable).toBe(false);
    expect(authErr.statusCode).toBe(401);

    const forbiddenErr = new MattermostAuthorizationError();
    expect(forbiddenErr.isRetryable).toBe(false);
    expect(forbiddenErr.statusCode).toBe(403);

    const notFoundErr = new MattermostChannelNotFoundError('dev-ops');
    expect(notFoundErr.isRetryable).toBe(false);
    expect(notFoundErr.statusCode).toBe(404);
    expect(notFoundErr.message).toContain("channel 'dev-ops' was not found");

    const mismatch = new MattermostIdentityMismatchError('user-1', 'user-2');
    expect(mismatch.isRetryable).toBe(false);
    expect(mismatch.statusCode).toBe(403);
  });
});
