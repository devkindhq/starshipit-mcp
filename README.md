# StarShipIt MCP Server

A Model Context Protocol (MCP) server for the [StarShipIt](https://starshipit.com) shipping API. It lets an AI assistant manage orders, print labels, track shipments, compare rates, manifest with carriers, and maintain the address book and product catalogue through any MCP client.

Built by [Devkind](https://devkind.com.au).

[![NPM Version](https://img.shields.io/npm/v/%40devkind%2Fstarshipit-mcp)](https://www.npmjs.com/package/@devkind/starshipit-mcp)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

## Features

- **40 tools** across orders, shipments, tracking, rates, address book, manifests and products
- **Tool annotations**: every tool declares MCP annotations. 15 tools are read-only and 5 are marked destructive, so clients can ask before they change data
- **Markdown or JSON output** on list and lookup tools
- **stdio and HTTP transports**. HTTP mode listens on `127.0.0.1` by default and rejects foreign `Host` headers
- **Runs with npx**. No clone or global install. Needs Node.js 22 or later

## Available Tools

| Domain | Count | Tools |
|---|---|---|
| Orders | 18 | list unshipped, printed, shipped and delivered; summary; search; get; create; create bulk; update; update bulk; batch update; delete; archive; restore; merge; suggested merges; assign |
| Shipments | 6 | print label, print labels, print packing slips, manifest, clone, replace |
| Tracking | 2 | track shipment, create tracking-only order |
| Rates | 2 | get rates, get delivery services |
| Address book | 4 | list, add, update, delete |
| Manifests | 4 | list, get files, manifest by tracking number, manifest by carrier |
| Products | 4 | list and search, add, update, delete |

Destructive tools: `starshipit_delete_order`, `starshipit_merge_orders`, `starshipit_replace_shipment`, `starshipit_delete_addresses`, `starshipit_delete_products`.

## Quick Start

You need Node.js 22 or later and two keys from StarShipIt.

**Step 1. Get your API keys**

1. Log in to StarShipIt.
2. Go to **Settings > API**.
3. Copy the **API Key** (`STARSHIPIT_API_KEY`) and the **Subscription key** (`STARSHIPIT_SUBSCRIPTION_KEY`).

**Step 2. Add the server to your MCP client** (see [Client Setup](#client-setup)).

**Step 3. Restart the client and try it**

Ask: _"List my unshipped StarShipIt orders."_

The server starts and lists its tools without keys. Without valid keys, each tool call returns an error that names the missing variable.

## Client Setup

### Claude Desktop

Open **Settings > Developer > Edit Config**, or edit the file directly:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "starshipit": {
      "command": "npx",
      "args": ["-y", "@devkind/starshipit-mcp"],
      "env": {
        "STARSHIPIT_API_KEY": "your-api-key",
        "STARSHIPIT_SUBSCRIPTION_KEY": "your-subscription-key"
      }
    }
  }
}
```

Restart Claude Desktop. The StarShipIt tools appear in the tools menu.

### Claude Code

```bash
# Prompts for each key without echoing it or saving it to shell history
read -rsp 'StarShipIt API key: ' STARSHIPIT_API_KEY; echo
read -rsp 'StarShipIt subscription key: ' STARSHIPIT_SUBSCRIPTION_KEY; echo
claude mcp add --scope local starshipit \
  -e STARSHIPIT_API_KEY="$STARSHIPIT_API_KEY" \
  -e STARSHIPIT_SUBSCRIPTION_KEY="$STARSHIPIT_SUBSCRIPTION_KEY" \
  -- npx -y @devkind/starshipit-mcp
```

`--scope local` keeps the keys in your user config, outside the repository. Do not put the keys in a project `.mcp.json`, because that file is meant to be committed.

<details>
<summary>Cursor</summary>

Add this to your Cursor `mcp.json`:

```json
{
  "mcpServers": {
    "starshipit": {
      "command": "npx",
      "args": ["-y", "@devkind/starshipit-mcp"],
      "env": {
        "STARSHIPIT_API_KEY": "your-api-key",
        "STARSHIPIT_SUBSCRIPTION_KEY": "your-subscription-key"
      }
    }
  }
}
```

</details>

<details>
<summary>VS Code</summary>

```bash
code --add-mcp '{"name":"starshipit","command":"npx","args":["-y","@devkind/starshipit-mcp"],"env":{"STARSHIPIT_API_KEY":"your-api-key","STARSHIPIT_SUBSCRIPTION_KEY":"your-subscription-key"}}'
```

</details>

<details>
<summary>Other MCP clients</summary>

Most clients accept the same `mcpServers` entry as Claude Desktop above: command `npx`, arguments `-y @devkind/starshipit-mcp`, and the two environment variables.

</details>

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `STARSHIPIT_API_KEY` | Yes | | StarShipIt API key (Settings > API) |
| `STARSHIPIT_SUBSCRIPTION_KEY` | Yes | | StarShipIt subscription key (Settings > API) |
| `TRANSPORT` | No | `stdio` | `stdio` or `http` |
| `MCP_HOST` | No | `127.0.0.1` | HTTP bind address (when `TRANSPORT=http`) |
| `PORT` | No | `3000` | HTTP port (when `TRANSPORT=http`) |

## Example Prompts

```
"Show my unshipped orders from the last 7 days"
"Track shipment 2XD198209601000935102"
"Compare rates for a 2 kg parcel from Melbourne 3000 to Paddington 2021"
"Which orders can be merged?"
"Print the label for order 398667087"
"Manifest all unmanifested Australia Post shipments"
"Find the product with SKU AMZ-BLK-SHOES-US11"
```

## HTTP Mode

```bash
TRANSPORT=http STARSHIPIT_API_KEY=... STARSHIPIT_SUBSCRIPTION_KEY=... npx -y @devkind/starshipit-mcp
# MCP endpoint: http://127.0.0.1:3000/mcp  (stateless Streamable HTTP)
# Health check: http://127.0.0.1:3000/health
```

By default the server listens on `127.0.0.1` only and rejects requests whose `Host` header is not `localhost`, `127.0.0.1` or `::1`. This blocks DNS rebinding attacks from web pages. Set `MCP_HOST=0.0.0.0` to listen on all interfaces, for example in a container.

> **Warning:** HTTP mode has no authentication, and every request runs with the server's StarShipIt keys. If you set `MCP_HOST` to anything other than a loopback address, put an authenticating proxy in front of the server.

## Development

Development uses npm (`package-lock.json`) and Node.js 22 or later.

```bash
git clone https://github.com/devkindhq/starshipit-mcp.git
cd starshipit-mcp
npm ci
cp .env.example .env   # add your keys; .env is git-ignored
npm run build
node --env-file=.env dist/index.js
```

| Script | Purpose |
|---|---|
| `npm run dev` | Run from source with reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run lint` | ESLint with type-aware rules |
| `npm run sync-tools` | Write the tool list into `manifest.json`. Run it after you add, rename or remove a tool |
| `npm run bundle` | Build `starshipit-mcp.mcpb` with production dependencies only |

CI runs lint, build and the tool-list check on Node.js 22 and 24, and builds the bundle, on every pull request.

### Releases

A merge to `main` releases automatically with [semantic-release](https://semantic-release.gitbook.io/), based on [Conventional Commits](https://www.conventionalcommits.org/):

| Commit type | Release |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or `BREAKING CHANGE:` | major |
| `docs:`, `chore:`, `ci:`, `refactor:`, `test:` | none |

Each release publishes to npm and creates a GitHub release with the MCPB bundle (`starshipit-mcp.mcpb`) attached. Git tags record the versions; `package.json` in git stays at `1.0.0`.

To publish a release to [Smithery](https://smithery.ai) (needs `gh` and `smithery` logged in):

```bash
node scripts/publish-smithery.js v1.2.3 --dry-run
node scripts/publish-smithery.js v1.2.3
```

## License

[ISC](LICENSE)

## Resources

- [MCP Specification](https://modelcontextprotocol.io/specification/2025-06-18)
- [StarShipIt API Documentation](https://api-docs.starshipit.com/)
- [Devkind](https://devkind.com.au)
