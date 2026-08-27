import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MattermostApiClient } from '../src/infrastructure/mattermost/api/client';
import { MattermostApiProvider } from '../src/infrastructure/mattermost/api/api-provider';
import {
  MattermostAuthenticationError,
  MattermostAuthorizationError,
  MattermostChannelNotFoundError,
} from '../src/domain/mattermost/errors';

describe('MattermostApiProvider & ApiClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps getMe() user response correctly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'user_123',
        username: 'ega',
        email: 'ega@example.com',
        first_name: 'Ega',
        last_name: 'Gofur',
        roles: 'system_user system_admin',
        create_at: 1600000000000,
      }),
    });

    const client = new MattermostApiClient({
      baseUrl: 'https://mattermost.example.com',
      token: 'fake-token-12345',
    });
    const provider = new MattermostApiProvider(client);

    const me = await provider.getMe();
    expect(me.id).toBe('user_123');
    expect(me.username).toBe('ega');
    expect(me.firstName).toBe('Ega');
    expect(me.lastName).toBe('Gofur');
    expect(me.createAt).toBe(1600000000000);
  });

  it('sends message via POST /api/v4/posts', async () => {
    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      const parsedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: 'post_999',
          channel_id: parsedBody.channel_id,
          user_id: 'user_123',
          message: parsedBody.message,
          root_id: parsedBody.root_id,
          create_at: 1700000000000,
        }),
      };
    });

    const client = new MattermostApiClient({
      baseUrl: 'https://mattermost.example.com',
      token: 'fake-token-12345',
    });
    const provider = new MattermostApiProvider(client);

    const result = await provider.sendMessage({
      channelId: 'channel_abc',
      message: 'Hello Mattermost',
      rootId: 'root_xyz',
    });

    expect(result.id).toBe('post_999');
    expect(result.channelId).toBe('channel_abc');
    expect(result.userId).toBe('user_123');
    expect(result.message).toBe('Hello Mattermost');
    expect(result.rootId).toBe('root_xyz');
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it('maps 401 HTTP response to MattermostAuthenticationError', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers(),
      json: async () => ({ id: 'api.context.session_expired.app_error', message: 'Invalid session token' }),
    });

    const client = new MattermostApiClient({
      baseUrl: 'https://mattermost.example.com',
      token: 'invalid-token',
    });
    const provider = new MattermostApiProvider(client);

    await expect(provider.getMe()).rejects.toThrow(MattermostAuthenticationError);
  });

  it('maps 403 HTTP response to MattermostAuthorizationError', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers(),
      json: async () => ({ id: 'api.context.permissions.app_error', message: 'Forbidden' }),
    });

    const client = new MattermostApiClient({
      baseUrl: 'https://mattermost.example.com',
      token: 'some-token',
    });
    const provider = new MattermostApiProvider(client);

    await expect(provider.getMe()).rejects.toThrow(MattermostAuthorizationError);
  });

  it('maps 404 HTTP response to MattermostChannelNotFoundError', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers(),
      json: async () => ({ id: 'store.sql_channel.get.existing.app_error', message: 'Channel not found' }),
    });

    const client = new MattermostApiClient({
      baseUrl: 'https://mattermost.example.com',
      token: 'some-token',
    });
    const provider = new MattermostApiProvider(client);

    await expect(provider.getChannel({ channelId: 'non_existent_channel' })).rejects.toThrow(
      MattermostChannelNotFoundError
    );
  });

  it('edits message via PUT /api/v4/posts/:id/patch', async () => {
    global.fetch = vi.fn().mockImplementation(async (url, init) => {
      expect(url).toContain('/api/v4/posts/post_to_edit_123/patch');
      expect(init.method).toBe('PUT');
      const body = JSON.parse(init.body);
      expect(body.id).toBe('post_to_edit_123');
      expect(body.message).toBe('Revised content');

      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'post_to_edit_123',
          channel_id: 'channel_abc',
          user_id: 'user_123',
          message: body.message,
          update_at: 1700000005000,
        }),
      };
    });

    const client = new MattermostApiClient({
      baseUrl: 'https://mattermost.example.com',
      token: 'fake-token-12345',
    });
    const provider = new MattermostApiProvider(client);

    const result = await provider.editMessage({
      postId: 'post_to_edit_123',
      message: 'Revised content',
    });

    expect(result.id).toBe('post_to_edit_123');
    expect(result.message).toBe('Revised content');
    expect(result.channelId).toBe('channel_abc');
    expect(result.updatedAt).toBeInstanceOf(Date);
  });
});
