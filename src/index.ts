#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { createRequire } from 'node:module';

import { registerOrderTools } from './tools/orders.js';
import { registerShipmentTools } from './tools/shipments.js';
import { registerTrackingTools } from './tools/tracking.js';
import { registerRatesTools } from './tools/rates.js';
import { registerAddressBookTools } from './tools/address-book.js';
import { registerManifestTools } from './tools/manifests.js';
import { registerProductTools } from './tools/products.js';

// package.json is the single source of the version; releases set it in CI.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

function createServer(): McpServer {
  const server = new McpServer({
    name: 'starshipit-mcp',
    version,
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
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('StarShipIt MCP server running via stdio');
}

function runHttp(): void {
  // Local only by default; the SDK then rejects other Host headers (DNS rebinding).
  const host = process.env.MCP_HOST ?? '127.0.0.1';
  const app = createMcpExpressApp({ host });

  // Stateless mode: one server per request, because a server holds only one transport.
  app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', server: 'starshipit-mcp', version });
  });

  const port = parseInt(process.env.PORT ?? '3000', 10);
  // Express 5 passes listen errors (e.g. EADDRINUSE) to this callback.
  app.listen(port, host, (err?: Error) => {
    if (err) {
      console.error('Server error:', err);
      process.exit(1);
    }
    console.error(`StarShipIt MCP server running on http://${host}:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT ?? 'stdio';
if (transport === 'http') {
  runHttp();
} else {
  runStdio().catch((err: unknown) => {
    console.error('Server error:', err);
    process.exit(1);
  });
}
