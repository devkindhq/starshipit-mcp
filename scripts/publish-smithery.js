#!/usr/bin/env node
// Publishes a release's MCPB bundle to Smithery as devkind/starshipit-mcp.
// Smithery builds its listing from manifest.json `tools` and needs full tool
// definitions (inputSchema etc.), which the strict MCPB schema rejects. So this
// rewrites manifest.json in a copy of the bundle; the release is not changed.
// Needs `gh` and `smithery` logged in.
// Usage: node scripts/publish-smithery.js <tag> [--dry-run]
//        node scripts/publish-smithery.js --bundle <file.mcpb> [--dry-run]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync, zipSync } from 'fflate';

const SERVER = 'devkind/starshipit-mcp';
const REPO = 'devkindhq/starshipit-mcp';
const ASSET = 'starshipit-mcp.mcpb';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bundleArg = args.includes('--bundle') ? args[args.indexOf('--bundle') + 1] : undefined;
const tag = args.find((arg) => !arg.startsWith('--') && arg !== bundleArg);
if (!tag === !bundleArg) {
	console.error('Usage: node scripts/publish-smithery.js <tag> | --bundle <file.mcpb> [--dry-run]');
	process.exit(1);
}

const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { stdio: 'inherit' });
const names = (tools) => tools.map((tool) => tool.name).join(',');
const readBundle = (file) =>
	Object.fromEntries(Object.entries(unzipSync(fs.readFileSync(file))).filter(([name]) => !name.endsWith('/')));
const extract = (files, dir) => {
	for (const [name, data] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
		fs.writeFileSync(path.join(dir, name), data);
	}
};

// Starts the bundled server (no credentials) with the bundled SDK and lists its tools.
const listTools = async (dir) => {
	const sdk = (file) => pathToFileURL(path.join(dir, 'node_modules/@modelcontextprotocol/sdk/dist/esm', file)).href;
	const { Client } = await import(sdk('client/index.js'));
	const { StdioClientTransport } = await import(sdk('client/stdio.js'));
	const client = new Client({ name: 'publish-smithery', version: '1.0.0' });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: [path.join(dir, 'dist/index.js')],
			env: { PATH: process.env.PATH ?? '' },
			stderr: 'ignore',
		}),
	);
	const { tools } = await client.listTools();
	await client.close();
	return tools;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starshipit-smithery-'));
try {
	if (bundleArg) fs.copyFileSync(path.resolve(bundleArg), path.join(tmp, ASSET));
	else run('gh', ['release', 'download', tag, '--repo', REPO, '--pattern', ASSET, '--dir', tmp]);

	const files = readBundle(path.join(tmp, ASSET));
	const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
	if (tag && `v${manifest.version}` !== tag) {
		throw new Error(`Bundle version ${manifest.version} does not match tag ${tag}`);
	}

	extract(files, path.join(tmp, 'release'));
	const tools = await listTools(path.join(tmp, 'release'));
	if (names(tools) !== names(manifest.tools ?? [])) throw new Error('Server tools differ from the bundle manifest');

	manifest.tools = tools.map(({ name, title, description, inputSchema, outputSchema, annotations }) => ({
		name,
		title,
		description,
		inputSchema,
		outputSchema,
		annotations,
	}));
	files['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, '\t') + '\n');
	const bundle = path.join(tmp, 'smithery.mcpb');
	fs.writeFileSync(bundle, zipSync(files, { level: 9 }));

	// The rebuilt bundle must start and list the same tools before it is published.
	extract(readBundle(bundle), path.join(tmp, 'check'));
	if (names(await listTools(path.join(tmp, 'check'))) !== names(tools)) {
		throw new Error('Rebuilt bundle does not list the same tools');
	}

	console.log(`Prepared ${SERVER} ${manifest.version} with ${tools.length} tools`);
	if (dryRun) console.log('Dry run: not published');
	else run('smithery', ['mcp', 'publish', bundle, '-n', SERVER]);
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}
