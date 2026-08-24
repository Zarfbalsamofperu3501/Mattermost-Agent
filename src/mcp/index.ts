#!/usr/bin/env node

import { runStdioMcpServer } from './server';

runStdioMcpServer().catch((error) => {
  console.error('Fatal MCP Server Error:', error);
  process.exit(1);
});
