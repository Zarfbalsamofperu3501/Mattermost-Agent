import {
  Channel,
  GetChannelInput,
  GetMessagesInput,
  Post,
  ReplyToMessageInput,
  SendMessageInput,
  SendMessageResult,
  User,
} from '../../../domain/mattermost/entities';
import { MattermostAuthenticationError, MattermostProviderError } from '../../../domain/mattermost/errors';
import { MattermostProvider } from '../../../domain/mattermost/providers/mattermost-provider.interface';
import { Logger, defaultLogger } from '../services/logger';
import { MattermostChannelPage } from './page-objects/channel-page';
import { MattermostComposer } from './page-objects/composer';
import { MattermostWebClient } from './web-client';

export interface PlaywrightProviderOptions {
  webClient: MattermostWebClient;
  baseUrl: string;
  defaultTeamName?: string;
  logger?: Logger;
}

export class MattermostPlaywrightProvider implements MattermostProvider {
  private webClient: MattermostWebClient;
  private baseUrl: string;
  private defaultTeamName?: string;
  private logger: Logger;

  constructor(options: PlaywrightProviderOptions) {
    this.webClient = options.webClient;
    this.baseUrl = options.baseUrl;
    this.defaultTeamName = options.defaultTeamName;
    this.logger = options.logger ?? defaultLogger;
  }

  private async ensureAuthenticated(): Promise<User> {
    const session = await this.webClient.verifySession();
    if (!session.authenticated) {
      throw new MattermostAuthenticationError(
        'MATTERMOST_SESSION_EXPIRED: Persistent browser session is not authenticated or has expired. Please run "npm run cli -- login" to authenticate.',
        { profileDir: this.webClient }
      );
    }
    return {
      id: session.userId || 'browser-user-id',
      username: session.username || 'personal-account',
      roles: 'system_user',
    };
  }

  public async getMe(): Promise<User> {
    return this.ensureAuthenticated();
  }

  public async getChannel(input: GetChannelInput): Promise<Channel> {
    await this.ensureAuthenticated();
    const page = await this.webClient.getPage();
    const channelPage = new MattermostChannelPage(page, this.baseUrl, this.logger);

    const channelIdentifier = input.channelName || input.channelId || 'town-square';
    await channelPage.navigateToChannel(channelIdentifier, input.teamId || this.defaultTeamName);
    const title = await channelPage.getChannelTitle();

    return {
      id: input.channelId || channelIdentifier,
      name: channelIdentifier,
      displayName: title || channelIdentifier,
      type: 'O',
    };
  }

  public async listChannels(teamId?: string): Promise<Channel[]> {
    await this.ensureAuthenticated();
    const page = await this.webClient.getPage();
    const channelElements = await page.locator('.sidebar-item, a[data-testid="channel-list-item"]').all();

    const channels: Channel[] = [];
    for (const el of channelElements) {
      const text = (await el.innerText().catch(() => '')).trim();
      const href = (await el.getAttribute('href').catch(() => '')) || '';
      if (text) {
        const parts = href.split('/channels/');
        const name = parts[1] || text.toLowerCase().replace(/\s+/g, '-');
        channels.push({
          id: name,
          name,
          displayName: text,
          type: 'O',
        });
      }
    }

    if (channels.length === 0) {
      channels.push(
        { id: 'town-square', name: 'town-square', displayName: 'Town Square', type: 'O' },
        { id: 'off-topic', name: 'off-topic', displayName: 'Off-Topic', type: 'O' }
      );
    }

    return channels;
  }

  public async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const user = await this.ensureAuthenticated();
    const page = await this.webClient.getPage();
    const channelPage = new MattermostChannelPage(page, this.baseUrl, this.logger);
    const composer = new MattermostComposer(page, this.logger);

    this.logger.debug(`Playwright: Navigating to channel '${input.channelId}'...`);
    await channelPage.navigateToChannel(input.channelId, this.defaultTeamName);

    this.logger.debug(`Playwright: Submitting message...`);
    await composer.submitMessage(input.message, false);

    return {
      id: `browser_post_${Date.now()}`,
      channelId: input.channelId,
      userId: user.id,
      message: input.message,
      rootId: input.rootId,
      createdAt: new Date(),
    };
  }

  public async replyToMessage(input: ReplyToMessageInput): Promise<SendMessageResult> {
    const user = await this.ensureAuthenticated();
    const page = await this.webClient.getPage();
    const channelPage = new MattermostChannelPage(page, this.baseUrl, this.logger);
    const composer = new MattermostComposer(page, this.logger);

    this.logger.debug(`Playwright: Navigating to channel '${input.channelId}' for reply...`);
    await channelPage.navigateToChannel(input.channelId, this.defaultTeamName);

    this.logger.debug(`Playwright: Submitting reply to thread...`);
    await composer.submitMessage(input.message, true);

    return {
      id: `browser_reply_${Date.now()}`,
      channelId: input.channelId,
      userId: user.id,
      message: input.message,
      rootId: input.rootId,
      createdAt: new Date(),
    };
  }

  public async getMessages(input: GetMessagesInput): Promise<Post[]> {
    await this.ensureAuthenticated();
    const page = await this.webClient.getPage();
    const channelPage = new MattermostChannelPage(page, this.baseUrl, this.logger);

    await channelPage.navigateToChannel(input.channelId, this.defaultTeamName);
    const rawPosts = await channelPage.getRecentPosts(input.limit || 10);

    return rawPosts.map((p) => ({
      id: p.id,
      createAt: p.timestamp.getTime(),
      updateAt: p.timestamp.getTime(),
      userId: p.author,
      channelId: input.channelId,
      message: p.message,
    }));
  }

  public async close(): Promise<void> {
    await this.webClient.close();
  }
}
