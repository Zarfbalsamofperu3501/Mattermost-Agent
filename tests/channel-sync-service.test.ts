import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ChannelSyncService } from '../src/infrastructure/mattermost/services/channel-sync-service';
import { ChannelResolver } from '../src/infrastructure/mattermost/services/channel-resolver';
import { ChannelConfigLoader } from '../src/infrastructure/mattermost/services/channel-config-loader';
import { MattermostProvider } from '../src/domain/mattermost/providers/mattermost-provider.interface';
import { MattermostChannelDisabledError } from '../src/domain/mattermost/errors';
import { Channel } from '../src/domain/mattermost/entities';

describe('ChannelSyncService & Enabled Toggles', () => {
  const tempConfigFile = path.resolve(__dirname, 'temp-channels-test.yml');
  let mockProvider: MattermostProvider;
  let sampleChannels: Channel[];

  beforeEach(() => {
    if (fs.existsSync(tempConfigFile)) {
      fs.unlinkSync(tempConfigFile);
    }

    sampleChannels = [
      { id: 'chan_1', name: 'town-square', displayName: 'Town Square', type: 'O', teamId: 'team-eng' },
      { id: 'chan_2', name: 'backend-dev', displayName: 'Backend Dev', type: 'P', teamId: 'team-eng' },
      { id: 'chan_3', name: 'secret-ops', displayName: 'Secret Ops', type: 'P', teamId: 'team-ops' },
    ];

    mockProvider = {
      getMe: vi.fn(),
      getChannel: vi.fn().mockImplementation(async (input) => {
        const found = sampleChannels.find((c) => c.id === input.channelId || c.name === input.channelName);
        if (found) return found;
        throw new Error('Not found');
      }),
      listChannels: vi.fn().mockResolvedValue(sampleChannels),
      sendMessage: vi.fn(),
      replyToMessage: vi.fn(),
      getMessages: vi.fn(),
    };
  });

  afterEach(() => {
    if (fs.existsSync(tempConfigFile)) {
      fs.unlinkSync(tempConfigFile);
    }
  });

  it('discovers and generates channels YAML file with all channels enabled by default', async () => {
    const syncService = new ChannelSyncService(mockProvider);
    const result = await syncService.syncToYaml({ filePath: tempConfigFile });

    expect(result.totalDiscovered).toBe(3);
    expect(result.enabledCount).toBe(3);
    expect(result.disabledCount).toBe(0);
    expect(fs.existsSync(tempConfigFile)).toBe(true);

    const loader = new ChannelConfigLoader({ configPath: tempConfigFile });
    expect(loader.getAllMappings()).toHaveLength(3);
    expect(loader.getMapping('backend-dev')?.enabled).toBe(true);
    expect(loader.getMapping('town-square')?.enabled).toBe(true);
  });

  it('preserves existing user disabled toggle (enabled: false) when re-syncing', async () => {
    // 1. First sync
    const syncService = new ChannelSyncService(mockProvider);
    await syncService.syncToYaml({ filePath: tempConfigFile });

    // 2. User manually toggles secret-ops to enabled: false in the file
    const loader = new ChannelConfigLoader({ configPath: tempConfigFile });
    const secretOpsMapping = loader.getMapping('secret-ops');
    if (secretOpsMapping) {
      secretOpsMapping.enabled = false;
      secretOpsMapping.description = 'Custom user description';
      loader.setMapping(secretOpsMapping);
      loader.saveToFile(tempConfigFile);
    }

    // 3. Provider now returns an additional new channel
    sampleChannels.push({
      id: 'chan_4',
      name: 'frontend-dev',
      displayName: 'Frontend Dev',
      type: 'P',
      teamId: 'team-eng',
    });

    // 4. Re-sync with mergeExisting: true
    const resyncResult = await syncService.syncToYaml({ filePath: tempConfigFile, mergeExisting: true });

    expect(resyncResult.totalDiscovered).toBe(4);
    expect(resyncResult.enabledCount).toBe(3); // 3 enabled, 1 disabled
    expect(resyncResult.disabledCount).toBe(1);

    const reloaded = new ChannelConfigLoader({ configPath: tempConfigFile });
    expect(reloaded.getMapping('secret-ops')?.enabled).toBe(false);
    expect(reloaded.getMapping('secret-ops')?.description).toBe('Custom user description');
    expect(reloaded.getMapping('frontend-dev')?.enabled).toBe(true);
  });

  it('blocks sending to disabled channel in ChannelResolver', async () => {
    const configLoader = new ChannelConfigLoader();
    configLoader.loadFromContent(`
channels:
  backend:
    channel: backend-dev
    enabled: true
  disabled-chan:
    channel: secret-ops
    enabled: false
`);

    const resolver = new ChannelResolver(mockProvider, { configLoader });

    // Enabled channel resolves normally
    const enabledCh = await resolver.resolve('backend');
    expect(enabledCh.name).toBe('backend-dev');

    // Disabled channel throws MattermostChannelDisabledError
    await expect(resolver.resolve('disabled-chan')).rejects.toThrow(MattermostChannelDisabledError);
  });
});
