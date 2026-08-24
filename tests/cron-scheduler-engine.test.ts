import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CronSchedulerEngine } from '../src/infrastructure/mattermost/cron/cron-scheduler-engine';
import { CronConfigLoader } from '../src/infrastructure/mattermost/cron/cron-config-loader';
import { CronStateManager } from '../src/infrastructure/mattermost/cron/cron-state-manager';
import { MattermostAutomationService } from '../src/application/mattermost/services/automation-service';

describe('CronSchedulerEngine', () => {
  const tempDir = path.resolve(__dirname, 'temp_cron_test');
  const tempStateFile = path.resolve(tempDir, 'cron_state.json');
  let mockAutomationService: MattermostAutomationService;
  let configLoader: CronConfigLoader;
  let stateManager: CronStateManager;

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    mockAutomationService = {
      sendMessage: vi.fn().mockResolvedValue({ id: 'msg_cron_123', channelId: 'chan_fe' }),
      replyToMessage: vi.fn().mockResolvedValue({ id: 'reply_cron_123', channelId: 'chan_fe' }),
    } as unknown as MattermostAutomationService;

    configLoader = new CronConfigLoader();
    configLoader.loadFromContent(`
default_timezone: UTC
jobs:
  standup:
    schedule: "0 9 * * 1-5"
    channel: per-fe-an
    message: "Standup time"
    from: "Cron"
    enabled: true
    timezone: UTC
  weekly-report:
    schedule: "0 17 * * 5"
    channel: general
    message: "Weekly report"
    enabled: false
`);

    stateManager = new CronStateManager(tempStateFile);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('starts and calculates next execution times for enabled jobs', () => {
    const engine = new CronSchedulerEngine({
      configLoader,
      stateManager,
      automationService: mockAutomationService,
    });

    engine.start();
    const summaries = engine.listJobSummaries();

    expect(summaries).toHaveLength(2);
    const standup = summaries.find((s) => s.name === 'standup');
    expect(standup).toBeDefined();
    expect(standup?.enabled).toBe(true);
    expect(standup?.nextRunAt).toBeDefined();

    const weekly = summaries.find((s) => s.name === 'weekly-report');
    expect(weekly?.enabled).toBe(false);

    engine.stop();
  });

  it('executes a job immediately by name and records state', async () => {
    const engine = new CronSchedulerEngine({
      configLoader,
      stateManager,
      automationService: mockAutomationService,
    });

    const result = await engine.executeJob('standup');
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg_cron_123');
    expect(mockAutomationService.sendMessage).toHaveBeenCalledWith({
      channel: 'per-fe-an',
      message: 'Standup time',
      from: 'Cron',
      teamId: undefined,
    });

    const state = stateManager.getState('standup');
    expect(state?.lastStatus).toBe('success');
    expect(state?.executionCount).toBe(1);
  });

  it('records failure gracefully when job execution throws', async () => {
    const failingService = {
      sendMessage: vi.fn().mockRejectedValue(new Error('Network connection timeout')),
    } as unknown as MattermostAutomationService;

    const engine = new CronSchedulerEngine({
      configLoader,
      stateManager,
      automationService: failingService,
    });

    const result = await engine.executeJob('standup');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network connection timeout');

    const state = stateManager.getState('standup');
    expect(state?.lastStatus).toBe('failed');
    expect(state?.lastError).toContain('Network connection timeout');
    expect(state?.failureCount).toBe(1);
  });
});
