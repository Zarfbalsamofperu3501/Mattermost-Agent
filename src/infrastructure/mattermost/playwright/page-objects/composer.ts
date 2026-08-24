import { Page } from 'playwright';
import { MattermostProviderError } from '../../../../domain/mattermost/errors';
import { Logger, defaultLogger } from '../../services/logger';

export class MattermostComposer {
  private page: Page;
  private logger: Logger;

  // DOM Selectors encapsulated inside Page Object
  private readonly MAIN_COMPOSER_SELECTORS = [
    '#post_textbox',
    'textarea[data-testid="post_textbox"]',
    'div[data-testid="post_textbox"]',
    'textarea[placeholder*="Write a message"]',
    'textarea[aria-label="write to channel"]',
    '[contenteditable="true"][data-testid="post_textbox"]',
  ];

  private readonly REPLY_COMPOSER_SELECTORS = [
    '#reply_textbox',
    'textarea[data-testid="reply_textbox"]',
    'div[data-testid="reply_textbox"]',
    'textarea[placeholder*="Reply to this thread"]',
    '[contenteditable="true"][data-testid="reply_textbox"]',
  ];

  private readonly SEND_BUTTON_SELECTORS = [
    'button[data-testid="SendMessageButton"]',
    'button.send-button',
    'button[aria-label="Send message"]',
    'button.post-message-btn',
  ];

  constructor(page: Page, logger?: Logger) {
    this.page = page;
    this.logger = logger ?? defaultLogger;
  }

  private async findComposerElement(isReply = false) {
    const selectors = isReply ? this.REPLY_COMPOSER_SELECTORS : this.MAIN_COMPOSER_SELECTORS;
    for (const selector of selectors) {
      try {
        const el = this.page.locator(selector).first();
        if (await el.isVisible({ timeout: 1500 })) {
          return el;
        }
      } catch {
        // try next selector
      }
    }
    return null;
  }

  /**
   * Types the message and submits it in the channel.
   */
  public async submitMessage(message: string, isReply = false): Promise<void> {
    this.logger.debug(`Locating composer (isReply: ${isReply})...`);
    const composer = await this.findComposerElement(isReply);

    if (!composer) {
      throw new MattermostProviderError(
        'Could not locate Mattermost message composer in DOM.',
        'COMPOSER_NOT_FOUND'
      );
    }

    await composer.click();
    await composer.fill('');
    await composer.fill(message);

    // Give UI a moment to update state
    await this.page.waitForTimeout(200);

    // Try finding send button first
    let submitted = false;
    for (const sendSelector of this.SEND_BUTTON_SELECTORS) {
      try {
        const btn = this.page.locator(sendSelector).first();
        if (await btn.isVisible({ timeout: 500 })) {
          await btn.click();
          submitted = true;
          break;
        }
      } catch {
        // try next
      }
    }

    // Fallback: press Enter on keyboard
    if (!submitted) {
      await composer.press('Enter');
    }

    // Wait for composer to clear or settle
    await this.page.waitForTimeout(500);
    this.logger.debug('Message submitted through Playwright composer');
  }
}
