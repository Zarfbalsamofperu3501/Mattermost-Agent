import { z } from 'zod';

export const CronJobDefinitionSchema = z.object({
  schedule: z.string().min(1, 'Cron schedule expression is required (e.g. "0 9 * * 1-5")'),
  channel: z.string().min(1, 'Target channel is required'),
  message: z.string().min(1, 'Message body is required'),
  from: z.string().optional(),
  rootId: z.string().optional(),
  team: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  timezone: z.string().optional(),
  description: z.string().optional(),
});

export type RawCronJobDefinition = z.infer<typeof CronJobDefinitionSchema>;

export const CronConfigFileSchema = z.object({
  default_timezone: z.string().optional().default('UTC'),
  jobs: z.record(CronJobDefinitionSchema).default({}),
});

export type RawCronConfigFile = z.infer<typeof CronConfigFileSchema>;

export interface NormalizedCronJob {
  name: string;
  schedule: string;
  channel: string;
  message: string;
  from?: string;
  rootId?: string;
  team?: string;
  enabled: boolean;
  timezone?: string;
  description?: string;
}

export interface CronJobExecutionState {
  name: string;
  lastRunAt?: string;
  lastStatus?: 'success' | 'failed';
  lastError?: string;
  lastMessageId?: string;
  executionCount: number;
  failureCount: number;
}

export interface CronJobSummary {
  name: string;
  schedule: string;
  channel: string;
  message: string;
  from?: string;
  enabled: boolean;
  timezone: string;
  description?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: 'success' | 'failed' | 'never';
  executionCount: number;
}
