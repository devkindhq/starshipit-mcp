# starshipit-mcp-server

MCP server for the [StarShipIt](https://starshipit.com) API — gives LLMs full access to orders, shipments, tracking, rates, manifests, address book, and products.

## Tools (40 total)

| Domain | Count | Tools |
|---|---|---|
| Orders | 18 | list unshipped/printed/shipped/delivered, summary, search, get, create, create bulk, update, update bulk, batch update, delete, archive, restore, merge, suggested merges, assign |
| Shipments | 6 | print label, print labels, print packing slips, manifest, clone, replace |
| Tracking | 2 | track shipment, create tracking-only order |
| Rates | 2 | get rates, get delivery services |
| Address Book | 4 | list, add, update, delete |
| Manifests | 4 | list manifests, get manifest files, manifest by tracking number, manifest by carrier |
| Products | 4 | list/search, add, update, delete |

## Setup

### 1. Get API credentials

In your StarShipIt account go to **Settings → API** and copy:
- **API Key** → `STARSHIPIT_API_KEY`
- **Subscription Key** → `STARSHIPIT_SUBSCRIPTION_KEY`

### 2. Install & build

```bash
npm install
npm run build
```

### 3. Configure Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "starshipit": {
      "command": "node",
      "args": ["/absolute/path/to/starshipit-mcp-server/dist/index.js"],
      "env": {
        "STARSHIPIT_API_KEY": "your_api_key",
        "STARSHIPIT_SUBSCRIPTION_KEY": "your_subscription_key"
      }
    }
  }
}
```

### 4. Or run as HTTP server

```bash
STARSHIPIT_API_KEY=... STARSHIPIT_SUBSCRIPTION_KEY=... TRANSPORT=http PORT=3000 npm start
```

Then point your MCP client at `http://localhost:3000/mcp`.

## Development

```bash
# Watch mode
STARSHIPIT_API_KEY=... STARSHIPIT_SUBSCRIPTION_KEY=... npm run dev

# Build
npm run build
```
