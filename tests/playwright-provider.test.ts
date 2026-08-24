import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MattermostPlaywrightProvider } from '../src/infrastructure/mattermost/playwright/playwright-provider';
import { MattermostWebClient } from '../src/infrastructure/mattermost/playwright/web-client';
import { MattermostAuthenticationError } from '../src/domain/mattermost/errors';

describe('MattermostPlaywrightProvider', () => {
  let mockWebClient: MattermostWebClient;
  let mockPage: any;

  beforeEach(() => {
    mockPage = {
      goto: vi.fn().mockResolvedValue(null),
      url: vi.fn().mockReturnValue('https://mattermost.example.com/team/channels/town-square'),
      waitForTimeout: vi.fn().mockResolvedValue(null),
      waitForSelector: vi.fn().mockResolvedValue(null),
      locator: vi.fn().mockReturnValue({
        first: vi.fn().mockReturnValue({
          isVisible: vi.fn().mockResolvedValue(true),
          click: vi.fn().mockResolvedValue(null),
          fill: vi.fn().mockResolvedValue(null),
          press: vi.fn().mockResolvedValue(null),
          innerText: vi.fn().mockResolvedValue('Town Square'),
        }),
        all: vi.fn().mockResolvedValue([]),
      }),
    };

    mockWebClient = {
      verifySession: vi.fn().mockResolvedValue({
        authenticated: true,
        username: 'personal-user',
        userId: 'user_browser_123',
      }),
      getPage: vi.fn().mockResolvedValue(mockPage),
      getContext: vi.fn(),
      runInteractiveLogin: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as MattermostWebClient;
  });

  it('throws MattermostAuthenticationError when session is not authenticated', async () => {
    mockWebClient.verifySession = vi.fn().mockResolvedValue({ authenticated: false });

    const provider = new MattermostPlaywrightProvider({
      webClient: mockWebClient,
      baseUrl: 'https://mattermost.example.com',
    });

    await expect(provider.getMe()).rejects.toThrow(MattermostAuthenticationError);
  });

  it('sends message by navigating to channel and filling composer', async () => {
    const provider = new MattermostPlaywrightProvider({
      webClient: mockWebClient,
      baseUrl: 'https://mattermost.example.com',
    });

    const result = await provider.sendMessage({
      channelId: 'town-square',
      message: 'Hello from Playwright',
    });

    expect(result.channelId).toBe('town-square');
    expect(result.message).toBe('Hello from Playwright');
    expect(result.userId).toBe('user_browser_123');
    expect(mockPage.goto).toHaveBeenCalledWith(
      expect.stringContaining('/channels/town-square'),
      expect.any(Object)
    );
  });
});
