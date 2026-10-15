# StarShipIt MCP

[![npm](https://img.shields.io/npm/v/@devkind/starshipit-mcp)](https://www.npmjs.com/package/@devkind/starshipit-mcp)

MCP server for the [StarShipIt](https://starshipit.com) shipping API. It lets an AI client manage orders, shipments, labels, tracking, rates, manifests, the address book and products.

## Tools (40)

| Domain | Count | Tools |
|---|---|---|
| Orders | 18 | list unshipped/printed/shipped/delivered, summary, search, get, create, create bulk, update, update bulk, batch update, delete, archive, restore, merge, suggested merges, assign |
| Shipments | 6 | print label, print labels, print packing slips, manifest, clone, replace |
| Tracking | 2 | track shipment, create tracking-only order |
| Rates | 2 | get rates, get delivery services |
| Address book | 4 | list, add, update, delete |
| Manifests | 4 | list, get files, manifest by tracking number, manifest by carrier |
| Products | 4 | list/search, add, update, delete |

15 tools only read data. The others change live data, and 5 are marked destructive: `starshipit_delete_order`, `starshipit_merge_orders`, `starshipit_replace_shipment`, `starshipit_delete_addresses`, `starshipit_delete_products`. Each tool declares MCP annotations (`readOnlyHint`, `destructiveHint`), so clients can ask for confirmation.

## Credentials

In StarShipIt, open **Settings → API** and copy two values:

| Variable | StarShipIt field |
|---|---|
| `STARSHIPIT_API_KEY` | API Key |
| `STARSHIPIT_SUBSCRIPTION_KEY` | Subscription key |

The server starts without them and lists its tools. Each tool call returns an error until both are set.

## Install

Requires Node.js 22 or later.

### Claude Desktop (MCPB bundle)

Download `starshipit-mcp.mcpb` from the [latest release](https://github.com/devkindhq/starshipit-mcp/releases/latest) and open it. Claude Desktop asks for the two keys.

### Claude Code

```bash
claude mcp add starshipit -e STARSHIPIT_API_KEY=... -e STARSHIPIT_SUBSCRIPTION_KEY=... -- npx -y @devkind/starshipit-mcp
```

### Other MCP clients (JSON config)

```json
{
  "mcpServers": {
    "starshipit": {
      "command": "npx",
      "args": ["-y", "@devkind/starshipit-mcp"],
      "env": {
        "STARSHIPIT_API_KEY": "your_api_key",
        "STARSHIPIT_SUBSCRIPTION_KEY": "your_subscription_key"
      }
    }
  }
}
```

### HTTP mode

```bash
TRANSPORT=http PORT=3000 STARSHIPIT_API_KEY=... STARSHIPIT_SUBSCRIPTION_KEY=... npx -y @devkind/starshipit-mcp
```

The endpoint is `http://127.0.0.1:3000/mcp` (stateless Streamable HTTP), and `GET /health` returns the status and version.

By default the server listens on `127.0.0.1` only, and rejects requests whose `Host` header is not `localhost`, `127.0.0.1` or `::1` (protection against DNS rebinding from a web page). Set `MCP_HOST=0.0.0.0` to listen on all interfaces, for example in a container.

> **Warning:** HTTP mode has no authentication, and it uses the server's own StarShipIt keys for every request. With `MCP_HOST=0.0.0.0`, put an authenticating proxy in front of it.

## Development

```bash
npm ci
cp .env.example .env   # add your keys; .env is git-ignored
npm run build
node --env-file=.env dist/index.js
```

| Script | Purpose |
|---|---|
| `npm run dev` | Run from source with reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run lint` | ESLint with type-aware rules |
| `npm run sync-tools` | Write the tool list into `manifest.json` (run after you add, rename or remove a tool) |
| `npm run bundle` | Build `starshipit-mcp.mcpb` (production dependencies only) |

CI runs lint, build and the tool-list check on Node 22 and 24, and builds the bundle on every pull request.

## Releases

Merges to `main` release automatically with [semantic-release](https://semantic-release.gitbook.io/), based on [Conventional Commits](https://www.conventionalcommits.org/):

| Commit type | Release |
|---|---|
| `fix:` | patch |
| `feat:` | minor |
| `feat!:` or `BREAKING CHANGE:` | major |
| `docs:`, `chore:`, `ci:`, `refactor:`, `test:` | none |

A release publishes to npm, then creates a GitHub release with the MCPB bundle attached. Git tags and GitHub releases record the versions; `package.json` in git stays at `1.0.0`.

To list a release on [Smithery](https://smithery.ai) (needs `gh` and `smithery` logged in):

```bash
node scripts/publish-smithery.js v1.2.3 --dry-run
node scripts/publish-smithery.js v1.2.3
```

## License

[ISC](LICENSE) © Devkind
