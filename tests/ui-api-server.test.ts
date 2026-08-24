import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { MattermostHttpServer } from '../src/ui/server';
import { MattermostAutomationService } from '../src/application/mattermost/services/automation-service';

describe('MattermostHttpServer (REST API Gateway)', () => {
  let serverInstance: MattermostHttpServer;
  let mockService: MattermostAutomationService;
  const testPort = 3999;

  beforeAll(async () => {
    mockService = {
      whoami: vi.fn().mockResolvedValue({
        id: 'usr_test_123',
        username: 'egagofur',
        email: 'ega@example.com',
        roles: 'system_user',
      }),
      sendMessage: vi.fn().mockResolvedValue({
        id: 'msg_api_123',
        channelId: 'chan_town_square',
        createdAt: new Date().toISOString(),
      }),
      replyToMessage: vi.fn().mockResolvedValue({
        id: 'reply_api_123',
        channelId: 'chan_town_square',
        rootId: 'post_root_123',
      }),
      readChannel: vi.fn().mockResolvedValue({
        channel: { id: 'chan_1', name: 'town-square' },
        messages: [{ id: 'post_1', message: 'Hello world', userId: 'usr_test_123' }],
      }),
      getThreads: vi.fn().mockResolvedValue({
        channel: { id: 'chan_1', name: 'town-square' },
        threads: [{ rootId: 'post_1', messagePreview: 'Hello', replyCount: 2 }],
      }),
      listCronJobs: vi.fn().mockReturnValue([
        { name: 'daily-standup', schedule: '0 9 * * 1-5', channel: 'per-fe-an', enabled: true },
      ]),
      runCronJob: vi.fn().mockResolvedValue({ success: true, messageId: 'cron_msg_1' }),
      toggleCronJob: vi.fn().mockReturnValue(true),
      interactiveLogin: vi.fn().mockResolvedValue(undefined),
      syncChannels: vi.fn().mockResolvedValue({ totalDiscovered: 5 }),
    } as unknown as MattermostAutomationService;

    serverInstance = new MattermostHttpServer({
      port: testPort,
      host: '127.0.0.1',
      automationService: mockService,
    });

    await serverInstance.start();
  });

  afterAll(async () => {
    await serverInstance.stop();
  });

  async function request(path: string, options: { method?: string; body?: any } = {}): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const payload = options.body ? JSON.stringify(options.body) : undefined;
      const headers: Record<string, string | number> = {
        'Content-Type': 'application/json',
        'Connection': 'close',
      };
      if (payload) {
        headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: testPort,
          path,
          method: options.method || 'GET',
          headers,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode || 200, body: JSON.parse(data) });
            } catch {
              resolve({ status: res.statusCode || 200, body: data });
            }
          });
        }
      );
      req.on('error', reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  it('GET /api/status returns authentication state and user details', async () => {
    const res = await request('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user.username).toBe('egagofur');
  });

  it('GET /api/whoami returns active user identity', async () => {
    const res = await request('/api/whoami');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('usr_test_123');
  });

  it('POST /api/messages/send delivers message via automation service', async () => {
    const res = await request('/api/messages/send', {
      method: 'POST',
      body: {
        channel: 'town-square',
        message: 'Hello via HTTP API',
        from: 'API Agent',
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('msg_api_123');
    expect(mockService.sendMessage).toHaveBeenCalledWith({
      channel: 'town-square',
      message: 'Hello via HTTP API',
      from: 'API Agent',
      teamId: undefined,
    });
  });

  it('POST /api/messages/reply posts thread reply', async () => {
    const res = await request('/api/messages/reply', {
      method: 'POST',
      body: {
        channel: 'town-square',
        rootId: ':1',
        message: 'Thread reply via API',
        from: 'API Agent',
      },
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('reply_api_123');
  });

  it('GET /api/cron lists configured cron jobs', async () => {
    const res = await request('/api/cron');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].name).toBe('daily-standup');
  });

  it('GET /api/openapi.json returns valid OpenAPI 3.0 specification', async () => {
    const res = await request('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toContain('Mattermost Agent REST API');
  });
});
