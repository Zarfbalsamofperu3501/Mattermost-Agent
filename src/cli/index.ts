#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import { MattermostAutomationService } from '../application/mattermost/services/automation-service';
import { ChannelConfigLoader } from '../infrastructure/mattermost/services/channel-config-loader';
import { loadConfig } from '../config/env';
import { MattermostError } from '../domain/mattermost/errors';

const program = new Command();

program
  .name('mattermost')
  .description('Personal Account Automation CLI for Mattermost')
  .version('1.0.0')
  .option('--json', 'Output results formatted as JSON')
  .option('-u, --url <url>', 'Mattermost server URL')
  .option('-t, --token <token>', 'Mattermost Personal Access Token')
  .option('-p, --provider <provider>', 'Provider to use: "api" or "playwright"')
  .option('--team-id <teamId>', 'Mattermost Team ID')
  .option('--channels-config <path>', 'Path to YAML channel mapping configuration file')
  .option('--env <environment>', 'Active environment overlay for channel mappings (e.g. dev, staging, prod)');

function getService(cmdOpts: Record<string, unknown> = {}): MattermostAutomationService {
  const globalOpts = program.opts();
  const overrides: Record<string, string | undefined> = {};

  if (globalOpts.url) overrides.MATTERMOST_URL = globalOpts.url;
  if (globalOpts.token) overrides.MATTERMOST_TOKEN = globalOpts.token;
  if (globalOpts.provider) overrides.MATTERMOST_PROVIDER = globalOpts.provider;
  if (globalOpts.teamId) overrides.MATTERMOST_TEAM_ID = globalOpts.teamId;
  if (globalOpts.channelsConfig) overrides.MATTERMOST_CHANNELS_CONFIG = globalOpts.channelsConfig;
  if (globalOpts.env) overrides.MATTERMOST_ENV = globalOpts.env;

  try {
    const config = loadConfig(overrides);
    return new MattermostAutomationService({ config });
  } catch (err) {
    console.error(`\n❌ Configuration Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

function handleOutput(data: unknown, jsonMode = false): void {
  if (jsonMode || program.opts().json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    if (typeof data === 'string') {
      console.log(data);
    } else {
      console.log(data);
    }
  }
}

function handleError(err: unknown): void {
  const isJson = program.opts().json;
  if (err instanceof MattermostError) {
    if (isJson) {
      console.error(JSON.stringify({ success: false, error: { code: err.code, message: err.message, details: err.details } }, null, 2));
    } else {
      console.error(`\n❌ Error [${err.code}]: ${err.message}`);
      if (err.details && Object.keys(err.details).length > 0) {
        console.error(`   Details:`, err.details);
      }
    }
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    if (isJson) {
      console.error(JSON.stringify({ success: false, error: { code: 'UNEXPECTED_ERROR', message: msg } }, null, 2));
    } else {
      console.error(`\n❌ Unexpected Error: ${msg}`);
    }
  }
  process.exit(1);
}

// whoami
program
  .command('whoami')
  .description('Verify personal identity and display current authenticated account')
  .action(async () => {
    const service = getService();
    try {
      const user = await service.whoami();
      if (program.opts().json) {
        handleOutput(user, true);
      } else {
        console.log('\n✅ Mattermost Identity Verified');
        console.log(`   User ID:   ${user.id}`);
        console.log(`   Username:  ${user.username}`);
        if (user.firstName || user.lastName) {
          console.log(`   Name:      ${[user.firstName, user.lastName].filter(Boolean).join(' ')}`);
        }
        if (user.email) {
          console.log(`   Email:     ${user.email}`);
        }
        if (user.roles) {
          console.log(`   Roles:     ${user.roles}`);
        }
        console.log('');
      }
    } catch (err) {
      handleError(err);
    } finally {
      await service.close();
    }
  });

// send
program
  .command('send')
  .description('Send a message to a channel as personal user')
  .requiredOption('-c, --channel <channel>', 'Channel name, slug, or ID')
  .requiredOption('-m, --message <message>', 'Message body to send')
  .option('-r, --root-id <rootId>', 'Root ID to reply inside a thread')
  .option('--team <teamId>', 'Team ID or slug')
  .option('--idempotency-key <key>', 'Custom idempotency key to avoid duplicate sends')
  .action(async (opts) => {
    const service = getService();
    try {
      const result = await service.sendMessage({
        channel: opts.channel,
        message: opts.message,
        rootId: opts.rootId,
        teamId: opts.team,
        idempotencyKey: opts.idempotencyKey,
      });

      if (program.opts().json) {
        handleOutput(result, true);
      } else {
        console.log('\n✅ Message sent successfully');
        console.log(`   Message ID:  ${result.id}`);
        console.log(`   Channel ID:  ${result.channelId}`);
        console.log(`   User ID:     ${result.userId}`);
        if (result.rootId) console.log(`   Root ID:     ${result.rootId}`);
        console.log(`   Created At:  ${result.createdAt.toISOString()}`);
        console.log('');
      }
    } catch (err) {
      handleError(err);
    } finally {
      await service.close();
    }
  });

// reply
program
  .command('reply')
  .description('Reply to a message thread in a channel')
  .requiredOption('-c, --channel <channel>', 'Channel name, slug, or ID')
  .requiredOption('-r, --root-id <rootId>', 'Root thread ID to reply to')
  .requiredOption('-m, --message <message>', 'Message body to send')
  .option('--team <teamId>', 'Team ID or slug')
  .option('--idempotency-key <key>', 'Custom idempotency key')
  .action(async (opts) => {
    const service = getService();
    try {
      const result = await service.replyToMessage({
        channel: opts.channel,
        rootId: opts.rootId,
        message: opts.message,
        teamId: opts.team,
        idempotencyKey: opts.idempotencyKey,
      });

      if (program.opts().json) {
        handleOutput(result, true);
      } else {
        console.log('\n✅ Thread reply sent successfully');
        console.log(`   Message ID:  ${result.id}`);
        console.log(`   Root ID:     ${result.rootId}`);
        console.log(`   Channel ID:  ${result.channelId}`);
        console.log('');
      }
    } catch (err) {
      handleError(err);
    } finally {
      await service.close();
    }
  });

// channel
program
  .command('channel')
  .description('Look up and resolve a channel by name or ID')
  .argument('<channel>', 'Channel name, slug, or ID')
  .option('--team <teamId>', 'Team ID or slug')
  .action(async (channelArg, opts) => {
    const service = getService();
    try {
      const channel = await service.getChannel(channelArg, opts.team);
      if (program.opts().json) {
        handleOutput(channel, true);
      } else {
        console.log('\n📁 Mattermost Channel Details');
        console.log(`   ID:           ${channel.id}`);
        console.log(`   Name:         ${channel.name}`);
        console.log(`   Display Name: ${channel.displayName}`);
        console.log(`   Type:         ${channel.type}`);
        if (channel.header) console.log(`   Header:       ${channel.header}`);
        if (channel.purpose) console.log(`   Purpose:      ${channel.purpose}`);
        console.log('');
      }
    } catch (err) {
      handleError(err);
    } finally {
      await service.close();
    }
  });

// read
program
  .command('read')
  .description('Read recent messages from a channel')
  .argument('<channel>', 'Channel name, slug, or ID')
  .option('-l, --limit <limit>', 'Number of messages to retrieve (max 100)', '10')
  .option('--since <timestamp>', 'Retrieve posts created after epoch timestamp ms')
  .option('--team <teamId>', 'Team ID or slug')
  .action(async (channelArg, opts) => {
    const service = getService();
    try {
      const result = await service.readChannel({
        channel: channelArg,
        limit: parseInt(opts.limit, 10),
        since: opts.since ? parseInt(opts.since, 10) : undefined,
        teamId: opts.team,
      });

      if (program.opts().json) {
        handleOutput(result, true);
      } else {
        console.log(`\n💬 Recent messages in #${result.channel.displayName} (${result.messages.length} posts):`);
        console.log('-------------------------------------------------------------');
        for (const msg of result.messages) {
          const dateStr = new Date(msg.createAt).toLocaleTimeString();
          console.log(`[${dateStr}] [${msg.userId}]: ${msg.message}`);
          if (msg.rootId) console.log(`   ↳ (thread reply to ${msg.rootId})`);
        }
        console.log('-------------------------------------------------------------\n');
      }
    } catch (err) {
      handleError(err);
    } finally {
      await service.close();
    }
  });

// action (JSON input / agent execution)
program
  .command('action')
  .description('Execute a domain action directly via JSON argument or stdin')
  .argument('[jsonPayload]', 'Action payload as JSON string')
  .action(async (jsonArg) => {
    const service = getService();
    try {
      let rawJson = jsonArg;

      if (!rawJson) {
        // Read from stdin
        rawJson = fs.readFileSync(0, 'utf-8');
      }

      const payload = JSON.parse(rawJson);
      const actionResult = await service.executeAction(payload);
      handleOutput(actionResult, true);

      if (!actionResult.success) {
        process.exit(1);
      }
    } catch (err) {
      handleError(err);
    } finally {
      await service.close();
    }
  });

// login (Playwright interactive setup)
program
  .command('login')
  .description('Open browser window for one-time manual login (Playwright provider)')
  .action(async () => {
    const service = getService({ MATTERMOST_PROVIDER: 'playwright', MATTERMOST_HEADLESS: false });
    try {
      await service.interactiveLogin();
    } catch (err) {
      handleError(err);
    } finally {
      await service.close();
    }
  });

// aliases
program
  .command('aliases')
  .alias('channels-map')
  .description('List all channel aliases configured in YAML mapping')
  .action(async () => {
    try {
      const globalOpts = program.opts();
      const configLoader = new ChannelConfigLoader({
        configPath: globalOpts.channelsConfig || process.env.MATTERMOST_CHANNELS_CONFIG,
        envName: globalOpts.env || process.env.MATTERMOST_ENV,
      });

      const aliases = configLoader.getAllMappings();
      if (program.opts().json) {
        handleOutput(aliases, true);
      } else {
        console.log(`\n📋 Configured Channel Aliases (${aliases.length} aliases):`);
        if (configLoader.getDefaultTeam()) {
          console.log(`   Default Team: ${configLoader.getDefaultTeam()}`);
        }
        if (configLoader.getFallbackChannel()) {
          console.log(`   Fallback Channel: #${configLoader.getFallbackChannel()}`);
        }
        console.log('-------------------------------------------------------------');
        if (aliases.length === 0) {
          console.log('   No aliases loaded. Create channels.yml to define friendly aliases.');
        } else {
          for (const a of aliases) {
            const teamInfo = a.team ? ` (team: ${a.team})` : '';
            const desc = a.description ? ` - ${a.description}` : '';
            console.log(`   • ${a.alias.padEnd(16)} ➔ #${a.channel}${teamInfo}${desc}`);
          }
        }
        console.log('-------------------------------------------------------------\n');
      }
    } catch (err) {
      handleError(err);
    }
  });

program.parse(process.argv);
