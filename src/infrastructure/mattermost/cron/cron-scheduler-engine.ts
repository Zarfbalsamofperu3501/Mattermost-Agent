import { Cron } from 'croner';
import { CronConfigLoader } from './cron-config-loader';
import { CronJobSummary, NormalizedCronJob } from './cron-config-schema';
import { CronStateManager } from './cron-state-manager';
import { MattermostAutomationService } from '../../../application/mattermost/services/automation-service';
import { Logger, defaultLogger } from '../services/logger';

export interface CronSchedulerEngineOptions {
  configLoader?: CronConfigLoader;
  stateManager?: CronStateManager;
  automationService?: MattermostAutomationService;
  logger?: Logger;
}

export class CronSchedulerEngine {
  private configLoader: CronConfigLoader;
  private stateManager: CronStateManager;
  private automationService: MattermostAutomationService;
  private logger: Logger;

  private runningCroners: Map<string, Cron> = new Map();
  private inFlightJobs: Set<string> = new Set();
  private isRunning: boolean = false;

  constructor(options: CronSchedulerEngineOptions = {}) {
    this.logger = options.logger ?? defaultLogger;
    this.configLoader = options.configLoader ?? new CronConfigLoader({ logger: this.logger });
    this.stateManager = options.stateManager ?? new CronStateManager(undefined, this.logger);
    this.automationService =
      options.automationService ?? new MattermostAutomationService({ logger: this.logger });
  }

  public getConfigLoader(): CronConfigLoader {
    return this.configLoader;
  }

  public getStateManager(): CronStateManager {
    return this.stateManager;
  }

  /**
   * Starts all enabled cron jobs according to configuration.
   */
  public start(attachProcessSignals = false): void {
    if (this.isRunning) {
      this.logger.warn('Cron scheduler is already running.');
      return;
    }

    this.stop(); // Clean up any existing instances
    const jobs = this.configLoader.getJobs();

    let scheduledCount = 0;
    for (const job of jobs) {
      if (!job.enabled) {
        continue;
      }

      this.scheduleJob(job);
      scheduledCount++;
    }

    this.isRunning = true;
    this.logger.info(`Cron Scheduler started with ${scheduledCount} active scheduled jobs.`);

    if (attachProcessSignals) {
      const shutdown = () => {
        this.logger.info('Received termination signal. Gracefully stopping Cron Scheduler...');
        this.stop();
        process.exit(0);
      };

      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    }
  }

  /**
   * Stops all active cron schedules.
   */
  public stop(): void {
    for (const [name, cronInstance] of this.runningCroners.entries()) {
      try {
        cronInstance.stop();
      } catch (err) {
        this.logger.warn(`Error stopping cron job '${name}': ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.runningCroners.clear();
    this.isRunning = false;
    this.logger.info('Cron Scheduler stopped.');
  }

  /**
   * Schedules an individual job using Croner.
   */
  private scheduleJob(job: NormalizedCronJob): void {
    try {
      const cronInstance = new Cron(
        job.schedule,
        {
          timezone: job.timezone,
          name: job.name,
          protect: true, // Prevents concurrent overlap if execution takes longer than interval
        },
        async () => {
          await this.executeJob(job.name);
        }
      );

      this.runningCroners.set(job.name.toLowerCase(), cronInstance);
      const nextRun = cronInstance.nextRun();
      this.logger.debug(
        `Scheduled job '${job.name}' [${job.schedule}] -> Next run: ${nextRun ? nextRun.toISOString() : 'never'}`
      );
    } catch (err) {
      this.logger.error(
        `Failed to schedule job '${job.name}' with pattern '${job.schedule}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Executes a job by name immediately (called by scheduler or manually via CLI/MCP).
   */
  public async executeJob(jobName: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const job = this.configLoader.getJob(jobName);
    if (!job) {
      const errorMsg = `Job '${jobName}' not found in cron configuration.`;
      this.logger.error(errorMsg);
      return { success: false, error: errorMsg };
    }

    const cleanName = job.name.toLowerCase();
    if (this.inFlightJobs.has(cleanName)) {
      this.logger.warn(`Job '${job.name}' is already running. Skipping overlapping execution.`);
      return { success: false, error: 'Job is already in-flight' };
    }

    this.inFlightJobs.add(cleanName);
    const startTime = Date.now();
    this.logger.info(`Executing cron job '${job.name}' -> sending to #${job.channel}...`);

    try {
      let result;
      if (job.rootId) {
        result = await this.automationService.replyToMessage({
          channel: job.channel,
          rootId: job.rootId,
          message: job.message,
          from: job.from,
          teamId: job.team,
        });
      } else {
        result = await this.automationService.sendMessage({
          channel: job.channel,
          message: job.message,
          from: job.from,
          teamId: job.team,
        });
      }

      const durationMs = Date.now() - startTime;
      this.stateManager.recordSuccess(job.name, result.id);
      this.logger.info(`Cron job '${job.name}' executed successfully in ${durationMs}ms (Message ID: ${result.id})`);

      return { success: true, messageId: result.id };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.stateManager.recordFailure(job.name, errorMsg);
      this.logger.error(`Cron job '${job.name}' execution failed: ${errorMsg}`);

      return { success: false, error: errorMsg };
    } finally {
      this.inFlightJobs.delete(cleanName);
    }
  }

  /**
   * Returns a complete summary of all configured jobs with live schedule status and history.
   */
  public listJobSummaries(): CronJobSummary[] {
    const jobs = this.configLoader.getJobs();
    const summaries: CronJobSummary[] = [];

    for (const job of jobs) {
      const state = this.stateManager.getState(job.name);
      const cronInstance = this.runningCroners.get(job.name.toLowerCase());

      let nextRunAt: string | undefined;
      if (cronInstance && job.enabled) {
        const next = cronInstance.nextRun();
        if (next) nextRunAt = next.toISOString();
      } else if (job.enabled) {
        try {
          const tempCron = new Cron(job.schedule, { timezone: job.timezone });
          const next = tempCron.nextRun();
          if (next) nextRunAt = next.toISOString();
          tempCron.stop();
        } catch {
          nextRunAt = undefined;
        }
      }

      summaries.push({
        name: job.name,
        schedule: job.schedule,
        channel: job.channel,
        message: job.message,
        from: job.from,
        enabled: job.enabled,
        timezone: job.timezone || this.configLoader.getDefaultTimezone(),
        description: job.description,
        nextRunAt,
        lastRunAt: state?.lastRunAt,
        lastStatus: state ? state.lastStatus : 'never',
        executionCount: state?.executionCount || 0,
      });
    }

    return summaries;
  }
}
