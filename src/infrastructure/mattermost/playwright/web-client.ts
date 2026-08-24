import { BrowserContext, chromium, Page } from 'playwright';
import * as fs from 'fs';
import { MattermostAuthenticationError, MattermostProviderError } from '../../../domain/mattermost/errors';
import { Logger, defaultLogger } from '../services/logger';

export interface WebClientOptions {
  baseUrl: string;
  profileDir: string;
  headless?: boolean;
  logger?: Logger;
}

export class MattermostWebClient {
  private baseUrl: string;
  private profileDir: string;
  private headless: boolean;
  private context: BrowserContext | null = null;
  private logger: Logger;

  constructor(options: WebClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.profileDir = options.profileDir;
    this.headless = options.headless ?? true;
    this.logger = options.logger ?? defaultLogger;
  }

  private ensureProfileDir(): void {
    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }
  }

  public async getContext(): Promise<BrowserContext> {
    if (!this.context) {
      this.ensureProfileDir();
      this.logger.debug(`Launching persistent browser context from '${this.profileDir}' (headless: ${this.headless})...`);

      this.context = await chromium.launchPersistentContext(this.profileDir, {
        headless: this.headless,
        viewport: { width: 1280, height: 800 },
        args: ['--disable-blink-features=AutomationControlled'],
      });
    }
    return this.context;
  }

  public async getPage(): Promise<Page> {
    const context = await this.getContext();
    const pages = context.pages();
    if (pages.length > 0) {
      return pages[0];
    }
    return context.newPage();
  }

  /**
   * Verifies that the browser profile holds an active, authenticated Mattermost session.
   */
  public async verifySession(): Promise<{ authenticated: boolean; username?: string; userId?: string }> {
    const page = await this.getPage();
    this.logger.debug(`Navigating to ${this.baseUrl} to verify session...`);

    try {
      await page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);

      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/landing')) {
        return { authenticated: false };
      }

      // Check for presence of sidebar / user status
      const userStatusEl = page.locator('#statusDropdown, .status-wrapper, [data-testid="user-avatar"]').first();
      const isVisible = await userStatusEl.isVisible({ timeout: 5000 }).catch(() => false);

      let username = 'browser-user';
      try {
        const nameEl = page.locator('.sidebar-header__username, .user__name, #statusDropdown').first();
        if (await nameEl.isVisible({ timeout: 1000 })) {
          const text = await nameEl.innerText();
          if (text) username = text.replace(/^@/, '').trim();
        }
      } catch {
        // fallback
      }

      return {
        authenticated: isVisible || !currentUrl.includes('/login'),
        username,
        userId: 'browser-authenticated-user',
      };
    } catch (err) {
      this.logger.error('Failed while verifying browser session', { error: String(err) });
      return { authenticated: false };
    }
  }

  /**
   * Interactive login session helper: opens a non-headless browser to allow the user
   * to log in manually, enter credentials and MFA, and saves the session on completion.
   */
  public async runInteractiveLogin(): Promise<void> {
    await this.close();
    this.ensureProfileDir();

    console.log('\n=============================================================');
    console.log(' MATTERMOST BROWSER LOGIN HELPER');
    console.log(' Opening browser window for manual authentication...');
    console.log(' Please log in and complete MFA in the browser window.');
    console.log('=============================================================\n');

    const context = await chromium.launchPersistentContext(this.profileDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    await page.goto(this.baseUrl);

    console.log('Waiting for login to complete... (Will close once channels view is detected)');

    // Wait until URL moves away from /login and sidebar/post composer is present
    try {
      await page.waitForURL((url) => !url.toString().includes('/login') && !url.toString().includes('/landing'), {
        timeout: 180000, // 3 minutes timeout for manual login
      });

      await page.waitForSelector('#post_textbox, #statusDropdown, .sidebar--left', { timeout: 30000 });
      console.log('\n✅ Login successfully detected! Browser session profile has been saved.');
    } catch (err) {
      throw new MattermostProviderError('Timed out waiting for manual login to complete in browser.', 'LOGIN_TIMEOUT');
    } finally {
      await context.close();
    }
  }

  public async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}
