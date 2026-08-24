import { Channel } from '../../../domain/mattermost/entities';
import { MattermostChannelNotFoundError } from '../../../domain/mattermost/errors';
import { MattermostProvider } from '../../../domain/mattermost/providers/mattermost-provider.interface';
import { Logger, defaultLogger } from './logger';

export interface ChannelResolverOptions {
  cacheTtlMs?: number;
  defaultTeamId?: string;
  logger?: Logger;
}

interface CacheEntry {
  channel: Channel;
  expiresAt: number;
}

export class ChannelResolver {
  private provider: MattermostProvider;
  private cache = new Map<string, CacheEntry>();
  private cacheTtlMs: number;
  private defaultTeamId?: string;
  private logger: Logger;

  constructor(provider: MattermostProvider, options: ChannelResolverOptions = {}) {
    this.provider = provider;
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000; // 5 minutes default
    this.defaultTeamId = options.defaultTeamId;
    this.logger = options.logger ?? defaultLogger;
  }

  public setProvider(provider: MattermostProvider): void {
    this.provider = provider;
    this.clearCache();
  }

  public clearCache(): void {
    this.cache.clear();
  }

  private isChannelId(identifier: string): boolean {
    // Mattermost IDs are 26 character base32/alphanumeric strings (e.g. 7abc1234567890abcdef12345)
    return /^[a-z0-9]{26}$/i.test(identifier);
  }

  private normalizeIdentifier(identifier: string): string {
    return identifier.trim().replace(/^~/, ''); // remove leading ~ if passed like ~engineering
  }

  private getCacheKey(identifier: string, teamId?: string): string {
    return `${teamId ?? 'global'}:${identifier.toLowerCase()}`;
  }

  /**
   * Resolves a channel name, display name, or channel ID to a Channel entity.
   */
  public async resolve(identifier: string, teamId?: string): Promise<Channel> {
    const cleanId = this.normalizeIdentifier(identifier);
    const effectiveTeamId = teamId || this.defaultTeamId;
    const cacheKey = this.getCacheKey(cleanId, effectiveTeamId);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Channel cache hit for '${identifier}' -> '${cached.channel.id}'`);
      return cached.channel;
    }

    this.logger.debug(`Resolving channel '${identifier}' (team: ${effectiveTeamId || 'any'})...`);

    // 1. If it looks like a direct Channel ID
    if (this.isChannelId(cleanId)) {
      try {
        const channel = await this.provider.getChannel({ channelId: cleanId });
        if (channel) {
          this.setCache(channel, effectiveTeamId);
          return channel;
        }
      } catch (err) {
        this.logger.debug(`Direct channel ID lookup failed for '${cleanId}', falling back to name search`);
      }
    }

    // 2. Try direct lookup by name with teamId if provided
    if (effectiveTeamId) {
      try {
        const channel = await this.provider.getChannel({ channelName: cleanId, teamId: effectiveTeamId });
        if (channel) {
          this.setCache(channel, effectiveTeamId);
          return channel;
        }
      } catch {
        // Fallback to channel list matching
      }
    }

    // 3. Search channels list
    try {
      const channels = await this.provider.listChannels(effectiveTeamId);
      const lower = cleanId.toLowerCase();

      // Exact match on name or ID or display name
      const matched = channels.find(
        (c) =>
          c.id.toLowerCase() === lower ||
          c.name.toLowerCase() === lower ||
          c.displayName.toLowerCase() === lower
      );

      if (matched) {
        this.setCache(matched, effectiveTeamId);
        return matched;
      }
    } catch (err) {
      this.logger.warn(`Failed to list channels while resolving '${identifier}'`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    throw new MattermostChannelNotFoundError(identifier, {
      teamId: effectiveTeamId,
      resolvedIdentifier: cleanId,
    });
  }

  private setCache(channel: Channel, teamId?: string): void {
    const expiresAt = Date.now() + this.cacheTtlMs;
    const entry: CacheEntry = { channel, expiresAt };

    // Cache by ID
    this.cache.set(this.getCacheKey(channel.id, teamId), entry);
    // Cache by Name
    this.cache.set(this.getCacheKey(channel.name, teamId), entry);
    // Cache by Display Name
    this.cache.set(this.getCacheKey(channel.displayName, teamId), entry);
  }
}
