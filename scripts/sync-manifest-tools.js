#!/usr/bin/env node
// Writes the server's tools (name + summary) into manifest.json, so the MCPB
// bundle and Smithery can list tools without starting the server. The strict
// MCPB schema allows only these two fields. Starts dist/index.js with no
// credentials. CI runs this and fails on a diff. Run after `npm run build`.
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'sync-manifest-tools', version: '1.0.0' });
await client.connect(
	new StdioClientTransport({
		command: process.execPath,
		args: ['dist/index.js'],
		env: { PATH: process.env.PATH ?? '' },
		stderr: 'ignore',
	}),
);
const { tools } = await client.listTools();
await client.close();
if (!tools.length) throw new Error('Server listed 0 tools');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
manifest.tools = tools.map((tool) => ({
	name: tool.name,
	description: (tool.description ?? '').split('\n\n')[0].trim(),
}));
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');
console.log(`Wrote ${tools.length} tools to manifest.json`);
