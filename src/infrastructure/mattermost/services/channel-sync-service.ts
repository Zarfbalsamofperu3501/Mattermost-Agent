import { Channel } from '../../../domain/mattermost/entities';
import { MattermostProvider } from '../../../domain/mattermost/providers/mattermost-provider.interface';
import { ChannelConfigLoader, NormalizedChannelMapping } from './channel-config-loader';
import { Logger, defaultLogger } from './logger';

export interface ChannelSyncOptions {
  filePath?: string;
  defaultEnabled?: boolean;
  mergeExisting?: boolean;
}

export interface ChannelSyncResult {
  totalDiscovered: number;
  totalTeams: number;
  enabledCount: number;
  disabledCount: number;
  filePath: string;
  mappings: NormalizedChannelMapping[];
}

export class ChannelSyncService {
  private provider: MattermostProvider;
  private logger: Logger;

  constructor(provider: MattermostProvider, logger?: Logger) {
    this.provider = provider;
    this.logger = logger ?? defaultLogger;
  }

  /**
   * Fetches all accessible channels across all user teams.
   */
  public async discoverChannels(): Promise<Channel[]> {
    this.logger.info('Discovering accessible Mattermost channels...');
    return this.provider.listChannels();
  }

  /**
   * Syncs all discovered channels into a YAML configuration file, preserving any
   * user-configured `enabled: false`, custom aliases, or descriptions if mergeExisting is true.
   */
  public async syncToYaml(options: ChannelSyncOptions = {}): Promise<ChannelSyncResult> {
    const targetFile = options.filePath || 'channels.yml';
    const defaultEnabled = options.defaultEnabled ?? true;
    const mergeExisting = options.mergeExisting ?? true;

    this.logger.info(`Syncing Mattermost channels to '${targetFile}'...`);

    // 1. Load existing config if present
    const configLoader = new ChannelConfigLoader({ configPath: targetFile, logger: this.logger });
    const existingMap = new Map<string, NormalizedChannelMapping>();

    if (mergeExisting) {
      for (const mapping of configLoader.getAllMappings()) {
        existingMap.set(mapping.alias.toLowerCase(), mapping);
        // Also map by target channel name for robust lookup
        existingMap.set(mapping.channel.toLowerCase(), mapping);
      }
    }

    // 2. Discover channels from server
    const discoveredChannels = await this.discoverChannels();
    const uniqueTeams = new Set<string>();

    let townSquareFound = false;

    // 3. Process and merge channels
    for (const ch of discoveredChannels) {
      if (ch.teamId) {
        uniqueTeams.add(ch.teamId);
      }
      if (ch.name === 'town-square') {
        townSquareFound = true;
      }

      const alias = ch.name.toLowerCase();
      const existing = existingMap.get(alias) || existingMap.get(ch.id.toLowerCase());

      const mapping: NormalizedChannelMapping = {
        alias,
        channel: ch.name,
        team: ch.teamId || configLoader.getDefaultTeam(),
        displayName: ch.displayName,
        description: existing?.description || (ch.purpose || ch.header || `${ch.displayName} channel`),
        enabled: existing ? existing.enabled : defaultEnabled,
        type: ch.type === 'P' ? 'private' : 'public',
        defaultRootId: existing?.defaultRootId,
        tags: existing?.tags,
      };

      configLoader.setMapping(mapping);
    }

    // Set fallback channel if not already set
    if (!configLoader.getFallbackChannel() && townSquareFound) {
      configLoader.setFallbackChannel('town-square');
    }

    // 4. Save to YAML file
    configLoader.saveToFile(targetFile);

    const allMappings = configLoader.getAllMappings();
    const enabledCount = allMappings.filter((m) => m.enabled).length;
    const disabledCount = allMappings.filter((m) => !m.enabled).length;

    this.logger.info(
      `Successfully synced ${allMappings.length} channels (${enabledCount} enabled, ${disabledCount} disabled) to '${targetFile}'`
    );

    return {
      totalDiscovered: discoveredChannels.length,
      totalTeams: uniqueTeams.size || 1,
      enabledCount,
      disabledCount,
      filePath: targetFile,
      mappings: allMappings,
    };
  }
}
