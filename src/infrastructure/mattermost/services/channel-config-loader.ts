import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { z } from 'zod';
import { MattermostValidationError } from '../../../domain/mattermost/errors';
import { Logger, defaultLogger } from './logger';

export const ChannelDefinitionObjectSchema = z.object({
  channel: z.string().min(1, 'Target channel cannot be empty.'),
  team: z.string().optional(),
  description: z.string().optional(),
  default_root_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const ChannelDefinitionSchema = z.union([
  z.string().min(1, 'Channel string cannot be empty.'),
  ChannelDefinitionObjectSchema,
]);

export type ChannelDefinition = z.infer<typeof ChannelDefinitionSchema>;
export type ChannelDefinitionObject = z.infer<typeof ChannelDefinitionObjectSchema>;

export const ChannelMappingConfigSchema = z.object({
  default_team: z.string().optional(),
  fallback_channel: z.string().optional(),
  channels: z.record(ChannelDefinitionSchema).default({}),
  environments: z.record(z.record(ChannelDefinitionSchema)).optional(),
});

export type RawChannelMappingConfig = z.infer<typeof ChannelMappingConfigSchema>;

export interface NormalizedChannelMapping {
  alias: string;
  channel: string;
  team?: string;
  description?: string;
  defaultRootId?: string;
  tags?: string[];
}

export interface ChannelConfigLoaderOptions {
  configPath?: string;
  envName?: string;
  logger?: Logger;
}

export class ChannelConfigLoader {
  private configPath?: string;
  private envName?: string;
  private logger: Logger;
  private defaultTeam?: string;
  private fallbackChannel?: string;
  private mappings = new Map<string, NormalizedChannelMapping>();

  private static readonly DEFAULT_CONFIG_LOCATIONS = [
    'channels.yml',
    'channels.yaml',
    '.mattermost/channels.yml',
    '.mattermost/channels.yaml',
    'config/channels.yml',
    'config/channels.yaml',
  ];

  constructor(options: ChannelConfigLoaderOptions = {}) {
    this.configPath = options.configPath;
    this.envName = options.envName || process.env.MATTERMOST_ENV || process.env.APP_ENV || process.env.NODE_ENV;
    this.logger = options.logger ?? defaultLogger;

    this.autoLoad();
  }

  private normalizeDefinition(alias: string, def: ChannelDefinition): NormalizedChannelMapping {
    if (typeof def === 'string') {
      return {
        alias,
        channel: def,
        team: this.defaultTeam,
      };
    }

    return {
      alias,
      channel: def.channel,
      team: def.team || this.defaultTeam,
      description: def.description,
      defaultRootId: def.default_root_id,
      tags: def.tags,
    };
  }

  private parseAndApply(rawYaml: string): void {
    let parsed: unknown;
    try {
      parsed = YAML.parse(rawYaml);
    } catch (err) {
      throw new MattermostValidationError(
        `Failed to parse YAML channels configuration: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      return;
    }

    const validateResult = ChannelMappingConfigSchema.safeParse(parsed);
    if (!validateResult.success) {
      const details = validateResult.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`).join('; ');
      throw new MattermostValidationError(`Invalid channel mapping schema: ${details}`);
    }

    const data = validateResult.data;
    this.defaultTeam = data.default_team;
    this.fallbackChannel = data.fallback_channel;
    this.mappings.clear();

    // 1. Load base channels
    for (const [alias, def] of Object.entries(data.channels || {})) {
      this.mappings.set(alias.toLowerCase(), this.normalizeDefinition(alias, def));
    }

    // 2. Overlay environment channels if matched
    if (this.envName && data.environments && data.environments[this.envName]) {
      this.logger.debug(`Applying channel mappings for environment: '${this.envName}'`);
      const envChannels = data.environments[this.envName];
      for (const [alias, def] of Object.entries(envChannels)) {
        this.mappings.set(alias.toLowerCase(), this.normalizeDefinition(alias, def));
      }
    }
  }

  public loadFromContent(yamlContent: string): this {
    this.parseAndApply(yamlContent);
    return this;
  }

  public loadFromFile(filePath: string): boolean {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolvedPath)) {
      return false;
    }

    try {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      this.parseAndApply(content);
      this.configPath = resolvedPath;
      this.logger.debug(`Loaded YAML channel mapping from '${resolvedPath}' (${this.mappings.size} mappings)`);
      return true;
    } catch (err) {
      if (err instanceof MattermostValidationError) {
        throw err;
      }
      throw new MattermostValidationError(
        `Error reading channel config file at '${filePath}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private autoLoad(): void {
    if (this.configPath) {
      this.loadFromFile(this.configPath);
      return;
    }

    // Check env var
    const envPath = process.env.MATTERMOST_CHANNELS_CONFIG;
    if (envPath) {
      this.loadFromFile(envPath);
      return;
    }

    // Check default locations
    for (const relativePath of ChannelConfigLoader.DEFAULT_CONFIG_LOCATIONS) {
      if (this.loadFromFile(relativePath)) {
        return;
      }
    }
  }

  public getMapping(alias: string): NormalizedChannelMapping | undefined {
    return this.mappings.get(alias.toLowerCase().trim().replace(/^~/, ''));
  }

  public getAllMappings(): NormalizedChannelMapping[] {
    return Array.from(this.mappings.values());
  }

  public getDefaultTeam(): string | undefined {
    return this.defaultTeam;
  }

  public getFallbackChannel(): string | undefined {
    return this.fallbackChannel;
  }

  public hasMappings(): boolean {
    return this.mappings.size > 0;
  }
}
