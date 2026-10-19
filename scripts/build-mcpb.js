#!/usr/bin/env node
// Builds starshipit-mcp.mcpb from a staging copy with production dependencies
// only, so dev tooling never ships. The bundle takes its version from
// package.json, which semantic-release sets before this runs. Run after
// `npm run build`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const stage = path.resolve('.mcpb-stage');
const out = path.resolve('starshipit-mcp.mcpb');
const mcpb = path.resolve('node_modules/.bin/mcpb');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

if (!fs.existsSync('dist/index.js')) throw new Error('dist/index.js not found; run `npm run build` first');

fs.rmSync(stage, { recursive: true, force: true });
try {
	for (const entry of ['dist', 'assets', 'manifest.json', 'package.json', 'package-lock.json', 'LICENSE', 'README.md']) {
		fs.cpSync(entry, path.join(stage, entry), { recursive: true });
	}
	const manifestPath = path.join(stage, 'manifest.json');
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	manifest.version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');

	run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
	run(mcpb, ['validate', manifestPath]);
	fs.rmSync(out, { force: true });
	run(mcpb, ['pack', stage, out]);
} finally {
	fs.rmSync(stage, { recursive: true, force: true });
}
console.log(`Bundle written to ${path.basename(out)}`);
