import { describe, it, expect } from 'vitest';
import { ChannelConfigLoader } from '../src/infrastructure/mattermost/services/channel-config-loader';
import { MattermostValidationError } from '../src/domain/mattermost/errors';

describe('ChannelConfigLoader', () => {
  it('parses simple string mappings from YAML content', () => {
    const yaml = `
default_team: team-core
fallback_channel: town-square
channels:
  eng: engineering-core
  general: town-square
`;
    const loader = new ChannelConfigLoader({ configPath: undefined });
    loader.loadFromContent(yaml);

    expect(loader.getDefaultTeam()).toBe('team-core');
    expect(loader.getFallbackChannel()).toBe('town-square');

    const engMapping = loader.getMapping('eng');
    expect(engMapping?.channel).toBe('engineering-core');
    expect(engMapping?.team).toBe('team-core');

    const generalMapping = loader.getMapping('~general');
    expect(generalMapping?.channel).toBe('town-square');
  });

  it('parses rich object mappings with team and description', () => {
    const yaml = `
channels:
  backend-dev:
    channel: dotify-backend
    team: dot-dev
    description: "Backend development notifications"
    default_root_id: "root_post_123"
    tags: ["dev", "backend"]
`;
    const loader = new ChannelConfigLoader();
    loader.loadFromContent(yaml);

    const mapping = loader.getMapping('backend-dev');
    expect(mapping).toBeDefined();
    expect(mapping?.channel).toBe('dotify-backend');
    expect(mapping?.team).toBe('dot-dev');
    expect(mapping?.description).toBe('Backend development notifications');
    expect(mapping?.defaultRootId).toBe('root_post_123');
    expect(mapping?.tags).toEqual(['dev', 'backend']);
  });

  it('applies environment-specific overlays correctly', () => {
    const yaml = `
channels:
  backend: dotify-backend-default
  alerts: general-alerts
environments:
  prod:
    backend:
      channel: dotify-backend-prod
      team: dot-prod
    alerts: prod-incidents
`;
    // Load with env = prod
    const loader = new ChannelConfigLoader({ envName: 'prod' });
    loader.loadFromContent(yaml);

    const backend = loader.getMapping('backend');
    expect(backend?.channel).toBe('dotify-backend-prod');
    expect(backend?.team).toBe('dot-prod');

    const alerts = loader.getMapping('alerts');
    expect(alerts?.channel).toBe('prod-incidents');
  });

  it('throws MattermostValidationError for invalid YAML syntax', () => {
    const badYaml = `
channels:
  - invalid list instead of key-value
`;
    const loader = new ChannelConfigLoader();
    expect(() => loader.loadFromContent(badYaml)).toThrow(MattermostValidationError);
  });

  it('handles missing file gracefully without crashing', () => {
    const loader = new ChannelConfigLoader({ configPath: 'non-existent-channels.yml' });
    expect(loader.hasMappings()).toBe(false);
    expect(loader.getAllMappings()).toEqual([]);
  });
});
