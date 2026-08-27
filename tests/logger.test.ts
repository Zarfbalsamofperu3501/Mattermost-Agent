import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../src/infrastructure/mattermost/services/logger';

describe('Logger (MCP Stdio Cleanliness)', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('outputs info logs to console.error (stderr) and never console.log (stdout)', () => {
    const logger = new Logger('info');
    logger.info('Test info message', { detail: 'data' });

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO] Test info message'));
  });

  it('outputs structured event logs to console.error (stderr) and never console.log (stdout)', () => {
    const logger = new Logger('info');
    logger.event('mattermost.message.send', { channelId: 'chan_123' });

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('"event":"mattermost.message.send"'));
  });

  it('redacts sensitive credentials before logging to stderr', () => {
    const logger = new Logger('info');
    logger.info('User login', { password: 'secretpassword123', token: 'mmauthtoken' });

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[REDACTED]'));
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('secretpassword123'));
  });
});
