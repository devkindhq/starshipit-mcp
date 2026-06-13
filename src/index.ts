#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

import { registerOrderTools } from './tools/orders.js';
import { registerShipmentTools } from './tools/shipments.js';
import { registerTrackingTools } from './tools/tracking.js';
import { registerRatesTools } from './tools/rates.js';
import { registerAddressBookTools } from './tools/address-book.js';
import { registerManifestTools } from './tools/manifests.js';
import { registerProductTools } from './tools/products.js';

function validateEnv(): void {
  const missing: string[] = [];
  if (!process.env.STARSHIPIT_API_KEY) missing.push('STARSHIPIT_API_KEY');
  if (!process.env.STARSHIPIT_SUBSCRIPTION_KEY) missing.push('STARSHIPIT_SUBSCRIPTION_KEY');
  if (missing.length > 0) {
    console.error(
      `ERROR: Missing required environment variables: ${missing.join(', ')}\n` +
        'Set them in your environment or .env file:\n' +
        '  STARSHIPIT_API_KEY       — from Settings > API > API Key\n' +
        '  STARSHIPIT_SUBSCRIPTION_KEY — from Settings > API > Subscription key'
    );
    process.exit(1);
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: 'starshipit-mcp-server',
    version: '1.0.0',
  });

  registerOrderTools(server);
  registerShipmentTools(server);
  registerTrackingTools(server);
  registerRatesTools(server);
  registerAddressBookTools(server);
  registerManifestTools(server);
  registerProductTools(server);

  return server;
}

async function runStdio(): Promise<void> {
  validateEnv();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('StarShipIt MCP server running via stdio');
}

async function runHttp(): Promise<void> {
  validateEnv();
  const server = createServer();
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', server: 'starshipit-mcp-server' });
  });

  const port = parseInt(process.env.PORT ?? '3000', 10);
  app.listen(port, () => {
    console.error(`StarShipIt MCP server running on http://localhost:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT ?? 'stdio';
if (transport === 'http') {
  runHttp().catch((err: unknown) => {
    console.error('Server error:', err);
    process.exit(1);
  });
} else {
  runStdio().catch((err: unknown) => {
    console.error('Server error:', err);
    process.exit(1);
  });
}
