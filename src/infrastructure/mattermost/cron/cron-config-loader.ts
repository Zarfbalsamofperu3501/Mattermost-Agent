import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  CronConfigFileSchema,
  NormalizedCronJob,
  RawCronConfigFile,
  RawCronJobDefinition,
} from './cron-config-schema';
import { MattermostValidationError } from '../../../domain/mattermost/errors';
import { Logger, defaultLogger } from '../services/logger';

export interface CronConfigLoaderOptions {
  configPath?: string;
  defaultTimezone?: string;
  logger?: Logger;
}

export class CronConfigLoader {
  public static readonly DEFAULT_CONFIG_LOCATIONS = [
    'cron.yml',
    'cron.yaml',
    '.mattermost/cron.yml',
    '.mattermost/cron.yaml',
    'config/cron.yml',
  ];

  private configPath?: string;
  private defaultTimezone: string = 'UTC';
  private jobs: Map<string, NormalizedCronJob> = new Map();
  private logger: Logger;

  constructor(options: CronConfigLoaderOptions = {}) {
    this.logger = options.logger ?? defaultLogger;
    this.defaultTimezone = options.defaultTimezone ?? 'UTC';
    this.configPath = options.configPath;

    this.autoLoad();
  }

  private autoLoad(): void {
    if (this.configPath) {
      this.loadFromFile(this.configPath);
      return;
    }

    const envPath = process.env.MATTERMOST_CRON_CONFIG;
    if (envPath && this.loadFromFile(envPath)) {
      return;
    }

    for (const loc of CronConfigLoader.DEFAULT_CONFIG_LOCATIONS) {
      if (this.loadFromFile(loc)) {
        return;
      }
    }
  }

  public loadFromFile(filePath: string): boolean {
    const resolved = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) {
      return false;
    }

    try {
      const content = fs.readFileSync(resolved, 'utf-8');
      this.loadFromContent(content);
      this.configPath = resolved;
      return true;
    } catch (err) {
      if (err instanceof MattermostValidationError) {
        throw err;
      }
      throw new MattermostValidationError(
        `Failed to read cron config at '${filePath}': ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  public loadFromContent(yamlContent: string): this {
    let parsed: unknown;
    try {
      parsed = YAML.parse(yamlContent);
    } catch (err) {
      throw new MattermostValidationError(
        `Failed to parse YAML cron config: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      return this;
    }

    const result = CronConfigFileSchema.safeParse(parsed);
    if (!result.success) {
      const details = result.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`).join('; ');
      throw new MattermostValidationError(`Invalid cron configuration schema: ${details}`);
    }

    const data = result.data;
    if (data.default_timezone) {
      this.defaultTimezone = data.default_timezone;
    }

    this.jobs.clear();
    for (const [name, def] of Object.entries(data.jobs || {})) {
      this.jobs.set(name.toLowerCase(), {
        name,
        schedule: def.schedule,
        channel: def.channel,
        message: def.message,
        from: def.from,
        rootId: def.rootId,
        team: def.team,
        enabled: def.enabled !== false,
        timezone: def.timezone || this.defaultTimezone,
        description: def.description,
      });
    }

    return this;
  }

  public getJobs(): NormalizedCronJob[] {
    return Array.from(this.jobs.values());
  }

  public getJob(name: string): NormalizedCronJob | undefined {
    return this.jobs.get(name.toLowerCase().trim());
  }

  public setJob(name: string, def: RawCronJobDefinition): void {
    this.jobs.set(name.toLowerCase().trim(), {
      name,
      schedule: def.schedule,
      channel: def.channel,
      message: def.message,
      from: def.from,
      rootId: def.rootId,
      team: def.team,
      enabled: def.enabled !== false,
      timezone: def.timezone || this.defaultTimezone,
      description: def.description,
    });
  }

  public toggleJob(name: string, enabled: boolean): boolean {
    const job = this.jobs.get(name.toLowerCase().trim());
    if (!job) {
      return false;
    }
    job.enabled = enabled;
    this.jobs.set(name.toLowerCase().trim(), job);

    const targetPath = this.configPath || 'cron.yml';
    this.saveToFile(targetPath);
    return true;
  }

  public getDefaultTimezone(): string {
    return this.defaultTimezone;
  }

  public getConfigPath(): string | undefined {
    return this.configPath;
  }

  public toYamlObject(): RawCronConfigFile {
    const jobsObj: Record<string, RawCronJobDefinition> = {};
    for (const job of this.jobs.values()) {
      jobsObj[job.name] = {
        schedule: job.schedule,
        channel: job.channel,
        message: job.message,
        from: job.from,
        rootId: job.rootId,
        team: job.team,
        enabled: job.enabled,
        timezone: job.timezone,
        description: job.description,
      };
    }

    return {
      default_timezone: this.defaultTimezone,
      jobs: jobsObj,
    };
  }

  public saveToFile(filePath?: string): void {
    const target = path.resolve(process.cwd(), filePath || this.configPath || 'cron.yml');
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const doc = new YAML.Document(this.toYamlObject());
    fs.writeFileSync(target, doc.toString(), 'utf-8');
    this.configPath = target;
    this.logger.debug(`Saved cron configuration to '${target}'`);
  }
}
