# StarShipIt MCP Server: shipping orders, labels and tracking for AI agents

[![npm](https://img.shields.io/npm/v/%40devkind%2Fstarshipit-mcp)](https://www.npmjs.com/package/@devkind/starshipit-mcp)
[![CI](https://img.shields.io/github/actions/workflow/status/devkindhq/starshipit-mcp/ci.yml?label=CI)](https://github.com/devkindhq/starshipit-mcp/actions/workflows/ci.yml)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

StarShipIt MCP server lets Claude Desktop, Claude Code, Cursor, VS Code and any MCP client manage [StarShipIt](https://starshipit.com) orders, print labels, track shipments, compare rates and manifest with carriers. It runs with `npx` on Node.js 22 or later, over stdio or local HTTP, and calls the StarShipIt API with your own keys.

## Quickstart

Get your keys in StarShipIt under **Settings > API**: the **API Key** and the **Subscription key**. Then, for Claude Code:

```bash
read -rsp 'StarShipIt API key: ' STARSHIPIT_API_KEY; echo
read -rsp 'StarShipIt subscription key: ' STARSHIPIT_SUBSCRIPTION_KEY; echo
claude mcp add --scope local starshipit \
  -e STARSHIPIT_API_KEY="$STARSHIPIT_API_KEY" \
  -e STARSHIPIT_SUBSCRIPTION_KEY="$STARSHIPIT_SUBSCRIPTION_KEY" \
  -- npx -y @devkind/starshipit-mcp
```

`read -rsp` keeps the keys out of your shell history. `--scope local` stores them in your user config, outside the repository.

Then ask: *"List my unshipped StarShipIt orders."*

### Install in your client

Requirements:

- Node.js 22 or later (the server runs with `npx`)
- A StarShipIt API key and subscription key
- Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, or another MCP client

**Standard config** works in most MCP clients:

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

Do not put real keys in a project `.mcp.json` or any other file that you commit.

<details>
<summary>Claude Desktop</summary>

Open **Settings > Developer > Edit Config**, or edit the file directly:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add the standard config, then restart Claude Desktop. The StarShipIt tools appear in the tools menu.

</details>

<details>
<summary>Claude Code</summary>

Use the `claude mcp add` command from the [Quickstart](#quickstart), or install the [Claude Code plugin](#claude-code-plugin).

</details>

<details>
<summary>Cursor</summary>

Add the standard config to your Cursor `mcp.json`.

</details>

<details>
<summary>VS Code</summary>

```bash
code --add-mcp '{"name":"starshipit","command":"npx","args":["-y","@devkind/starshipit-mcp"],"env":{"STARSHIPIT_API_KEY":"your-api-key","STARSHIPIT_SUBSCRIPTION_KEY":"your-subscription-key"}}'
```

</details>

<details>
<summary>Windsurf</summary>

Follow the Windsurf MCP [documentation](https://docs.windsurf.com/windsurf/cascade/mcp) and use the standard config above.

</details>

<details>
<summary>Other MCP clients</summary>

Most clients accept the standard config: command `npx`, arguments `-y @devkind/starshipit-mcp`, and the two environment variables.

</details>

## Tools

The server has 40 tools. Every tool declares MCP annotations: 15 are read-only and 5 are destructive, so a client can ask before it changes data. 20 list and lookup tools accept `response_format` (`markdown` or `json`). Every tool also returns the full API response as structured content.

| Area | Count | Tools |
|---|---|---|
| Orders | 18 | list unshipped, printed, shipped and delivered; summary; search; get; create; create bulk; update; update bulk; batch update; delete; archive; restore; merge; suggested merges; assign |
| Shipments | 6 | print label, print labels, print packing slips, manifest, clone, replace |
| Tracking | 2 | track shipment, create tracking-only order |
| Rates | 2 | get rates, get delivery services |
| Address book | 4 | list, add, update, delete |
| Manifests | 4 | list, get files, manifest by tracking number, manifest by carrier |
| Products | 4 | list and search, add, update, delete |

Destructive tools: `starshipit_delete_order`, `starshipit_merge_orders`, `starshipit_replace_shipment`, `starshipit_delete_addresses`, `starshipit_delete_products`. Archive is reversible with `starshipit_restore_order`.

## Example

```json
{ "tool": "starshipit_track_shipment", "arguments": { "tracking_number": "2XD198209601000935102" } }
```

Illustrative output (the values are not real):

```markdown
## Tracking: 2XD198209601000935102

**Status:** InTransit
**Order:** 1001 (Shipped)
**Carrier:** Australia Post

### Tracking Events

- **2026-10-30T09:12:00Z — InTransit:** Item processed at facility
```

Other prompts: *"Compare rates for a 2 kg parcel from Melbourne 3000 to Paddington 2021"*, *"Which orders can be merged?"*, *"Manifest all unmanifested Australia Post shipments"*.

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `STARSHIPIT_API_KEY` | Yes | | StarShipIt API key (Settings > API) |
| `STARSHIPIT_SUBSCRIPTION_KEY` | Yes | | StarShipIt subscription key (Settings > API) |
| `TRANSPORT` | No | `stdio` | `stdio` or `http` |
| `MCP_HOST` | No | `127.0.0.1` | HTTP bind address (when `TRANSPORT=http`) |
| `PORT` | No | `3000` | HTTP port (when `TRANSPORT=http`) |

The server starts and lists its tools without keys. Each tool call without keys returns an error that names the missing variable.

## Claude Code plugin

The repository root is a Claude Code plugin. It adds the StarShipIt MCP server, pinned to the release version, and prompts for the two keys when you enable it. Claude Code stores the keys in your system credential store, not in `settings.json`.

The plugin also ships the `starshipit-shipping` skill. The skill teaches Claude the fulfilment order: find the order, pick a service, print the label, manifest and track. Claude asks you before it prints a label, manifests or runs a destructive tool.

Install it now (Claude Code 2.1.275 or later):

```
/plugin install starshipit --marketplace devkindhq/starshipit-mcp
```

On older Claude Code versions, use the `claude mcp add` command in the [Quickstart](#quickstart). A listing in the Claude plugin directory comes later.

## HTTP mode

```bash
TRANSPORT=http STARSHIPIT_API_KEY=... STARSHIPIT_SUBSCRIPTION_KEY=... npx -y @devkind/starshipit-mcp
# MCP endpoint: http://127.0.0.1:3000/mcp  (stateless Streamable HTTP)
# Health check: http://127.0.0.1:3000/health
```

By default the server listens on `127.0.0.1` only. It rejects requests whose `Host` header is not `localhost`, `127.0.0.1` or `::1`, which blocks DNS rebinding attacks from web pages. Set `MCP_HOST=0.0.0.0` to listen on all interfaces, for example in a container.

> **Warning:** HTTP mode has no authentication, and every request runs with the server's StarShipIt keys. If you set `MCP_HOST` to anything other than a loopback address, put an authenticating proxy in front of the server.

## Development

```bash
git clone https://github.com/devkindhq/starshipit-mcp.git
cd starshipit-mcp
yarn install --frozen-lockfile
yarn build
node --env-file=.env dist/index.js
```

Put your keys in `.env` (`STARSHIPIT_API_KEY=` and `STARSHIPIT_SUBSCRIPTION_KEY=`). Git ignores that file. See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks, commit style and release process.

## Built by

Built by [Devkind](https://devkind.com.au). Maintained by the Devkind team.

## License

[ISC](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## Shipping with StarShipIt?

Devkind builds the store and fulfilment side around it. We work with [Shopify](https://devkind.com.au/services/shopify), [Swell](https://devkind.com.au/services/swell) and [headless commerce](https://devkind.com.au/services/headless-ecommerce) stacks, and build custom MCP servers and AI agent workflows for operations teams. [Talk to Devkind](https://devkind.com.au/services) or email [hello@devkind.com.au](mailto:hello@devkind.com.au).
