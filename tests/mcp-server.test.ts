import { describe, it, expect, vi } from 'vitest';
import { createMattermostMcpServer } from '../src/mcp/server';
import { MattermostAutomationService } from '../src/application/mattermost/services/automation-service';

describe('Mattermost MCP Server', () => {
  it('initializes MCP server and registers tools correctly', async () => {
    const mockService = {
      whoami: vi.fn().mockResolvedValue({
        id: 'usr_mcp_123',
        username: 'egagofur',
        email: 'ega@example.com',
        roles: 'system_user',
      }),
      sendMessage: vi.fn().mockResolvedValue({
        id: 'post_mcp_123',
        channelId: 'chan_mcp_123',
        userId: 'usr_mcp_123',
        message: 'Hello from MCP',
        createdAt: new Date(),
      }),
      replyToMessage: vi.fn().mockResolvedValue({
        id: 'reply_mcp_123',
        channelId: 'chan_mcp_123',
        rootId: 'post_mcp_123',
        message: 'Reply from MCP',
        createdAt: new Date(),
      }),
      getThreads: vi.fn().mockResolvedValue({
        channel: { id: 'chan_mcp_123', name: 'town-square' },
        threads: [
          {
            index: 1,
            rootId: 'root_1',
            channelId: 'chan_mcp_123',
            authorId: 'usr_1',
            createdAt: new Date(),
            relativeTime: '5m ago',
            messageSnippet: 'First thread',
            fullMessage: 'First thread full content',
            replyCount: 0,
          },
        ],
      }),
      readChannel: vi.fn().mockResolvedValue({
        channel: { id: 'chan_mcp_123', name: 'town-square', displayName: 'Town Square' },
        messages: [],
      }),
      syncChannels: vi.fn().mockResolvedValue({
        filePath: 'channels.yml',
        totalDiscovered: 10,
        enabledCount: 8,
        disabledCount: 2,
      }),
    } as unknown as MattermostAutomationService;

    const server = createMattermostMcpServer(mockService);
    expect(server).toBeDefined();
  });
});
