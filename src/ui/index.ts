#!/usr/bin/env node
import { startMattermostHttpServer } from './server';

async function main() {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Mattermost Agent - Web UI & API Gateway');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const server = await startMattermostHttpServer({ port, host });

  console.log(`\n🌐 Web Dashboard:  http://localhost:${port}`);
  console.log(`📡 REST API Docs:   http://localhost:${port}#api`);
  console.log(`📋 OpenAPI Spec:    http://localhost:${port}/api/openapi.json`);
  console.log('\n💡 Press Ctrl+C to stop the server.\n');

  const shutdown = async () => {
    console.log('\nShutting down Mattermost Web UI...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start Mattermost UI server:', err);
  process.exit(1);
});
