import { describe, it, expect } from 'vitest';
import {
  MattermostActionSchema,
  ReadChannelActionSchema,
  ReplyToMessageActionSchema,
  SendMessageActionSchema,
} from '../src/application/mattermost/dto/action-schemas';

describe('Action Schemas', () => {
  it('validates a correct send_message action', () => {
    const payload = {
      action: 'send_message',
      channel: 'engineering',
      message: 'MR !123 is ready for review.',
    };

    const parsed = SendMessageActionSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.channel).toBe('engineering');
      expect(parsed.data.message).toBe('MR !123 is ready for review.');
    }
  });

  it('fails send_message when message is empty', () => {
    const payload = {
      action: 'send_message',
      channel: 'engineering',
      message: '',
    };

    const parsed = SendMessageActionSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('validates a reply_to_message action', () => {
    const payload = {
      action: 'reply_to_message',
      channel: 'engineering',
      rootId: 'post_1234567890abcdef',
      message: 'Looks great to me!',
    };

    const parsed = ReplyToMessageActionSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('fails reply_to_message when rootId is missing', () => {
    const payload = {
      action: 'reply_to_message',
      channel: 'engineering',
      message: 'Looks great to me!',
    };

    const parsed = ReplyToMessageActionSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it('validates read_channel with default limit', () => {
    const payload = {
      action: 'read_channel',
      channel: 'town-square',
    };

    const parsed = ReadChannelActionSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.limit).toBe(30);
    }
  });

  it('discriminated union parses all supported actions', () => {
    const actions = [
      { action: 'send_message', channel: 'c1', message: 'm1' },
      { action: 'reply_to_message', channel: 'c1', rootId: 'r1', message: 'm1' },
      { action: 'read_channel', channel: 'c1' },
      { action: 'get_channel', channel: 'c1' },
      { action: 'whoami' },
    ];

    for (const act of actions) {
      const parsed = MattermostActionSchema.safeParse(act);
      expect(parsed.success).toBe(true);
    }
  });

  it('fails on unknown action', () => {
    const payload = {
      action: 'unknown_action',
      foo: 'bar',
    };

    const parsed = MattermostActionSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});
