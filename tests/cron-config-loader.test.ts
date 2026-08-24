import { describe, it, expect } from 'vitest';
import { CronConfigLoader } from '../src/infrastructure/mattermost/cron/cron-config-loader';
import { MattermostValidationError } from '../src/domain/mattermost/errors';

describe('CronConfigLoader', () => {
  it('parses valid YAML cron configuration content correctly', () => {
    const yaml = `
default_timezone: Asia/Jakarta
jobs:
  daily-standup:
    schedule: "0 9 * * 1-5"
    channel: per-fe-an
    message: "Standup reminder"
    from: "Daily Reminder"
    enabled: true
    timezone: Asia/Jakarta
    description: "Daily reminder for standup"

  healthcheck:
    schedule: "*/15 * * * *"
    channel: devops
    message: "Ping"
    enabled: false
`;

    const loader = new CronConfigLoader();
    loader.loadFromContent(yaml);

    expect(loader.getDefaultTimezone()).toBe('Asia/Jakarta');
    expect(loader.getJobs()).toHaveLength(2);

    const standup = loader.getJob('daily-standup');
    expect(standup).toBeDefined();
    expect(standup?.schedule).toBe('0 9 * * 1-5');
    expect(standup?.channel).toBe('per-fe-an');
    expect(standup?.from).toBe('Daily Reminder');
    expect(standup?.enabled).toBe(true);

    const healthcheck = loader.getJob('healthcheck');
    expect(healthcheck?.enabled).toBe(false);
  });

  it('throws MattermostValidationError on invalid YAML syntax or schema', () => {
    const invalidYaml = `
jobs:
  invalid-job:
    schedule: 12345
`;
    const loader = new CronConfigLoader();
    expect(() => loader.loadFromContent(invalidYaml)).toThrow(MattermostValidationError);
  });

  it('updates job enabled state and serializes back to YAML object', () => {
    const yaml = `
jobs:
  my-job:
    schedule: "0 10 * * *"
    channel: general
    message: "Hello"
    enabled: true
`;

    const loader = new CronConfigLoader();
    loader.loadFromContent(yaml);

    loader.toggleJob('my-job', false);
    expect(loader.getJob('my-job')?.enabled).toBe(false);

    const yamlObj = loader.toYamlObject();
    expect(yamlObj.jobs['my-job'].enabled).toBe(false);
  });
});
