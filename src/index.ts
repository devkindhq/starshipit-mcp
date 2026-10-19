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
  const server = new McpServer(
    { name: 'starshipit-mcp', version },
    {
      instructions: `Tools for the StarShipIt shipping API. Typical flow:
1. starshipit_create_order (or starshipit_create_orders_bulk) adds orders; starshipit_list_unshipped_orders reviews them.
2. starshipit_get_delivery_services (for an order_id) or starshipit_get_rates (for a route) returns service codes and prices.
3. starshipit_print_label generates a label; pass reprint: true if the order already has one.
4. starshipit_manifest_shipment or starshipit_manifest_by_carrier sends shipments to the carrier.
5. starshipit_track_shipment tracks a shipment.
Notes: delete tools are permanent; archive is reversible with starshipit_restore_order. Text output is capped at 25,000 characters; the full API response is in structuredContent.`,
    },
  );

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
  // Stateless: no SSE stream or session to delete. Clients treat 405 as "not offered".
  app.all('/mcp', (_req, res) => {
    res.status(405).set('Allow', 'POST').end();
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
