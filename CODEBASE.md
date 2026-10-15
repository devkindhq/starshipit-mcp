# Starshipit MCP Codebase Reference (`CODEBASE.md`)

This document is the authoritative technical reference for the `starshipit-mcp` codebase (npm package `@devkind/starshipit-mcp`), written for AI agents and automated tools.

---

## 1. System Architecture & Runtime

### 1.1 Overview & Purpose
`starshipit-mcp` is a Model Context Protocol (MCP) server written in TypeScript that exposes the Starshipit Shipping and Logistics REST API to AI agents and LLM clients. It provides a structured interface comprising **40 distinct MCP tools** across 7 logistics domains: Orders, Shipments, Rates, Tracking, Manifests, Products (Catalog), and Address Book.

### 1.2 Runtime & Module Specifications
- **Node.js Requirement:** `>=22` (`package.json` `engines`; CI tests Node 22 and 24).
- **Module System:** Pure ECMAScript Modules (`"type": "module"`).
- **TypeScript Configuration (`tsconfig.json`):**
  - Target: `ES2022`
  - Module & Resolution: `Node16` (requires `.js` extensions on relative imports in source code)
  - Output Directory: `./dist` (Source Root: `./src`)
  - Strict Mode: Enabled (`strict: true`)
  - Output: `.js` and source maps only (no `.d.ts`; this is a CLI, not a library)
- **Executable Binaries:**
  - Binary entry point: `starshipit-mcp` -> `dist/index.js`
  - Source entry point: `src/index.ts` with `#!/usr/bin/env node` shebang.
- **Key Dependencies:**
  - `@modelcontextprotocol/sdk` (`^1.32.1`): Core MCP server SDK (`McpServer`, `StdioServerTransport`, `StreamableHTTPServerTransport`).
  - `axios` (`^1.20.0`): HTTP client for the Starshipit REST API.
  - `zod` (`^3.25.76`): Schema definition and runtime validation for MCP tool inputs.
- **Version:** read at runtime from `package.json` (`src/index.ts`); no version constant in `src`. semantic-release sets it in CI at release time.

### 1.3 Transport Modes & Server Lifecycle (`src/index.ts`)
The server supports two mutually exclusive runtime transports, selected via `process.env.TRANSPORT`:

1. **Stdio Transport (`TRANSPORT=stdio` or unset, default):**
   - Implemented via `runStdio()` (`src/index.ts:36-41`).
   - Uses `StdioServerTransport` connected to process `stdin` and `stdout`.
   - **Critical Rule:** Standard output (`stdout`) is strictly reserved for JSON-RPC MCP framing. All logging, diagnostics, and errors MUST be routed to `console.error` (`stderr`).
2. **HTTP / SSE Transport (`TRANSPORT=http`):**
   - Implemented via `runHttp()` (`src/index.ts:43-70`).
   - Runs the SDK's `createMcpExpressApp({ host })` on `process.env.MCP_HOST` (default `127.0.0.1`) and `process.env.PORT` (default `3000`). For a localhost host the SDK rejects other `Host` headers with 403 (DNS rebinding protection); `MCP_HOST=0.0.0.0` disables that and the SDK prints a warning.
   - Endpoint `POST /mcp`: Stateless. Each request creates its own `McpServer` and `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`, and closes both when the response closes. An `McpServer` holds only one transport, so a shared server fails parallel requests with "Already connected to a transport".
   - Endpoint `GET /health`: Returns `{ status: 'ok', server: 'starshipit-mcp', version }`.
   - **Security:** no authentication. Every request uses the server's own StarShipIt keys, so a non-local `MCP_HOST` needs an authenticating proxy.

### 1.4 Packaging & Release
- **npm package:** `@devkind/starshipit-mcp`, public. `files` ships only `dist/`.
- **MCPB bundle:** `manifest.json` (MCPB `0.3`) defines `user_config` (both keys, `required` and `sensitive`) and a `tools` list (name + summary). `npm run sync-tools` (`scripts/sync-manifest-tools.js`) writes that list from the running server; CI fails if it is out of date. `npm run bundle` (`scripts/build-mcpb.js`) packs a staging copy with production dependencies only and copies the `package.json` version into the bundle manifest.
- **Release:** `.github/workflows/release.yml` runs semantic-release (`.releaserc.json`) on each push to `main`: version from Conventional Commits, npm publish (trusted publishing via OIDC, `NPM_TOKEN` fallback), then a GitHub release with `starshipit-mcp.mcpb`. Nothing is committed back to `main` (rulesets require PRs). The npm plugin runs before the bundle step, so the bundle gets the release version.
- **Smithery:** `scripts/publish-smithery.js <tag>` republishes a release bundle as `devkind/starshipit-mcp`, with full tool schemas added to its manifest copy (Smithery needs them; strict MCPB rejects them).

---

## 2. Authentication, Network Layer & Error Handling

### 2.1 Environment Configuration & API Keys
The server requires two distinct API credentials issued by Starshipit:
- `STARSHIPIT_API_KEY`: Account API key (configured in Starshipit under **Settings → API → API Key**).
- `STARSHIPIT_SUBSCRIPTION_KEY`: Azure API Management subscription key (configured in Starshipit under **Settings → API → Subscription key**).
- Optional variables:
  - `TRANSPORT`: `'stdio'` | `'http'` (default `'stdio'`)
  - `MCP_HOST`: HTTP bind address (default `'127.0.0.1'`)
  - `PORT`: HTTP port number (default `'3000'`)

There is no startup validation: the server starts and lists its tools without keys (registries and `sync-tools` need this). Each API call reads the keys in `src/services/api-client.ts:4-14` and throws `"<NAME> environment variable is not set"` when one is missing; the tool returns that text with `isError: true`.

### 2.2 Network Client (`src/services/api-client.ts`)
The API client is implemented as a functional module centered around `apiRequest<T>()`:
- **Base URL:** `https://api.starshipit.com/api` (`src/constants.ts:1`).
- **Target URL Construction:** `${API_BASE_URL}/${endpoint}` (endpoints must NOT have a leading slash).
- **Authentication Headers (`src/services/api-client.ts:25-30`):**
  - `Content-Type: application/json`
  - `Accept: application/json`
  - `StarShipIT-Api-Key`: Value of `process.env.STARSHIPIT_API_KEY` (case-sensitive header key)
  - `Ocp-Apim-Subscription-Key`: Value of `process.env.STARSHIPIT_SUBSCRIPTION_KEY`
- **Timeout:** 30,000 ms (30 seconds).
- **Query Parameter Sanitization (`src/services/api-client.ts:35-41`):**
  Strips all parameters where value is `undefined`, `null`, or `""` (empty string). Preserves `0` and `false`. This prevents Starshipit gateway `400 Bad Request` rejections caused by empty query keys.
- **Output Truncation Guard (`src/constants.ts:2`, `src/schemas/common.ts:62-66`):**
  All tool outputs are capped at `CHARACTER_LIMIT = 25000` via `truncateIfNeeded(text, 25000)`. If output exceeds 25,000 characters, it is truncated and appended with pagination instructions to preserve LLM context windows.

### 2.3 Status Code Mapping & Error Protocol
Errors are formatted via `handleApiError(error)` (`src/services/api-client.ts:47-87`):
- `400`: `Error: Bad request: <detail>. Check all required fields are provided and valid.`
- `401`: `Error: Unauthorized. Check STARSHIPIT_API_KEY and STARSHIPIT_SUBSCRIPTION_KEY are set correctly.`
- `403`: `Error: Forbidden: <detail>. You don't have permission to perform this action.`
- `404`: `Error: Not found: <detail>. Check the ID or reference is correct.`
- `409`: `Error: Conflict: <detail>. The resource may already exist or be in an incompatible state.`
- `422`: `Error: Unprocessable entity: <detail>. Validate the request body schema.`
- `429`: `Error: Rate limit exceeded. Wait before making more requests.`
- `500`: `Error: StarShipIt server error: <detail>. Try again later.`
- `ECONNABORTED`: `Error: Request timed out. The StarShipIt API may be slow — try again.`
- `ECONNREFUSED`: `Error: Connection refused. Check network connectivity.`

**Tool Return Protocol:**
Tools catch exceptions and return `{ content: [{ type: 'text', text: handleApiError(error) }], isError: true }`.
All 40 tools follow this protocol.

---

## 3. Data Models, Schemas & Unit Conventions

### 3.1 Unit Conventions (Critical Gotchas)
1. **Weight:** Standardized in **Kilograms (kg)** across all tools. Must be positive (`> 0`) in orders and shipments, or non-negative (`>= 0`) in product records.
2. **Dimensions:** Standardized in **Metres (m)**, NOT centimetres.
   - Example: A parcel of 30 cm × 20 cm × 10 cm MUST be passed as `length: 0.3`, `width: 0.2`, `height: 0.1`.
   - Passing `30` instead of `0.3` produces a 1,000,000× volumetric weight calculation failure at the carrier rate engine.
3. **Currencies:** Numeric amounts. Currencies default to the Starshipit account currency (e.g. AUD, NZD, USD).
4. **Dates:** Input filters require strict UTC ISO 8601 strings (`z.string().datetime()`, e.g. `"2026-10-15T00:00:00Z"`). Starshipit returns .NET `DateTime` strings.

### 3.2 Address Schema Triage (Three Incompatible Models)
The codebase uses three different address schemas for distinct operational contexts:

| Schema Name | File Location | Key Purpose | Required Fields | Notable Peculiarities |
| :--- | :--- | :--- | :--- | :--- |
| **`AddressSchema`** | `src/schemas/common.ts:29-42` | Order destination | `name`, `street`, `post_code`, `country` | Uses `delivery_instructions`. `suburb` is optional. `country` can be full name or code. |
| **`RateAddressSchema`** | `src/tools/rates.ts:21-31` | Rate calculation / delivery services | `street`, `suburb`, `post_code`, `country_code` | **No contact fields** (`name`, `phone`, `email` omitted). Requires `suburb`. Requires strict 2-letter ISO code `country_code` (`z.string().length(2)`). |
| **`AddressBookEntrySchema`** | `src/tools/address-book.ts:19-52` | Address book master records | `name`, `street`, `post_code`, `country` | Uses `instructions` (NOT `delivery_instructions`). Adds `code` (string), `carrier` (integer carrier ID), `signature_required` (boolean). |

### 3.3 Core Shared Schemas (`src/schemas/common.ts`)
- **`ResponseFormatSchema`:** `z.nativeEnum(ResponseFormat)`. Values: `'markdown'` (default) or `'json'`.
- **`PaginationSchema`:**
  - `limit`: `z.number().int().min(1).max(250).default(50)`
  - `page`: `z.number().int().min(1).default(1)`
- **`PackageSchema`:**
  - `weight`: `z.number().positive()` (in kg)
  - `height`: `z.number().positive().optional()` (in metres)
  - `width`: `z.number().positive().optional()` (in metres)
  - `length`: `z.number().positive().optional()` (in metres)
- **`OrderItemSchema`:**
  - `description`: `z.string().min(1)` (required line item description)
  - `sku`: `z.string().optional()`
  - `quantity`: `z.number().int().positive().optional()`
  - `value`: `z.number().nonnegative().optional()` (declared customs value)
  - `weight`: `z.number().positive().optional()` (kg)
  - `hs_code`: `z.string().optional()` (Harmonized Tariff code)
  - `country_of_origin`: `z.string().optional()` (ISO alpha-2 code)
  - `dangerous_goods`: `z.boolean().optional()`

---

## 4. Comprehensive Tool Catalog (All 40 Tools)

### 4.1 Order Tools (`src/tools/orders.ts` — 18 Tools)

#### 1. `starshipit_list_unshipped_orders`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Retrieve pending orders waiting to be picked, packed, or labeled.
- **Parameters:**
  - `since_order_date` (optional, ISO datetime string)
  - `since_last_updated` (optional, ISO datetime string)
  - `limit` (optional integer [1..250], default: 50)
  - `page` (optional integer >= 1, default: 1)
  - `response_format` (optional `'markdown'` | `'json'`, default: `'markdown'`)
- **Endpoint:** `GET orders/unshipped`
- **Response:** Formatted markdown list of unshipped orders or JSON `{ orders, total, has_more, page }`.

#### 2. `starshipit_list_printed_orders`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** List orders that have generated shipping labels but may or may not be manifested.
- **Parameters:**
  - `status` (optional enum: `'recently_printed'` | `'unmanifested'`, default: `'recently_printed'`)
  - `since_created_date` (optional, ISO datetime string)
  - `limit`, `page`, `response_format` (standard pagination and format)
- **Endpoint:** `GET orders/shipments`
- **Response:** Markdown or JSON `{ orders, total, has_more, page }`.

#### 3. `starshipit_list_shipped_orders`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Retrieve orders that have been manifested and dispatched to the courier.
- **Parameters:**
  - `since_shipped_date` (optional, ISO datetime string)
  - `limit`, `page`, `response_format`
- **Endpoint:** `GET orders/shipped`
- **Response:** Markdown or JSON `{ orders, total, has_more, page }`.

#### 4. `starshipit_list_delivered_orders`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Retrieve orders where delivery has been confirmed by the carrier.
- **Parameters:**
  - `order_ref` (optional string — filter by merchant/customer reference)
  - `response_format`
- **Endpoint:** `GET orders/delivered`
- **Response:** Markdown or JSON `{ orders, total }`.

#### 5. `starshipit_get_orders_summary`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Retrieve order counts and dashboard summaries filtered by status.
- **Parameters:**
  - `order_status` (required string, min 1: e.g. `'unshipped'`, `'shipped'`, `'delivered'`, `'archived'`)
  - `sort` (optional string column name)
  - `limit`, `page`, `response_format`
- **Endpoint:** `GET orders/summary`
- **Response:** Markdown summary table or JSON `{ orders, total, has_more, page }`.

#### 6. `starshipit_search_orders`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Full-text search across order number, customer name, reference, and tracking number.
- **Parameters:**
  - `phrase` (required string, min 1)
  - `limit`, `page`, `response_format`
- **Endpoint:** `GET orders/search`
- **Response:** Search results list in markdown or JSON `{ orders, total, has_more, page }`.

#### 7. `starshipit_get_order`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Fetch single order details by internal `order_id` or merchant `order_number`.
- **Parameters:**
  - `order_id` (optional positive integer)
  - `order_number` (optional string)
  - `response_format`
- **Validation Rule:** At least one of `order_id` or `order_number` must be provided.
- **Endpoint:** `GET orders` (`?order_id=...` or `?order_number=...`)
- **Response:** Single order details object in JSON or detailed markdown report.

#### 8. `starshipit_create_order`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Ingest a single new order into Starshipit's unshipped queue.
- **Parameters:**
  - `order` (required object):
    - `order_number` (required string, min 1)
    - `destination` (required `AddressSchema`)
    - `order_date` (optional ISO datetime)
    - `reference`, `carrier`, `carrier_name`, `shipping_method`, `signature_required`, `return_order` (optional)
    - `items` (optional array of `OrderItemSchema`)
    - `packages` (optional array of `PackageSchema`)
- **Endpoint:** `POST orders`
- **Payload:** `{ order: <OrderPayload> }`
- **Response:** Confirmation text with assigned Starshipit `order_id` and `order_number`.

#### 9. `starshipit_create_orders_bulk`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Batch import multiple orders in a single API call.
- **Parameters:**
  - `orders` (required array of `CreateOrderPayloadSchema`, min 1)
- **Endpoint:** `POST orders/import`
- **Payload:** `{ orders: [ ... ] }`
- **Response:** Summary indicating total imported orders, created order IDs, and any per-order failure errors.

#### 10. `starshipit_update_order`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Partially update fields on an existing unshipped order.
- **Parameters:**
  - `order` (required object):
    - `order_id` (required positive integer)
    - `order_number`, `reference`, `carrier`, `shipping_method`, `signature_required`, `destination` (partial address), `items`, `packages` (optional)
- **Endpoint:** `PUT orders`
- **Payload:** `{ order: <UpdatePayload> }`
- **Response:** Text confirmation: `Order <order_id> updated successfully.`

#### 11. `starshipit_update_orders_bulk`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Update multiple existing orders in a single request.
- **Parameters:**
  - `orders` (required array of update payloads, min 1; each requires `order_id`)
- **Endpoint:** `PUT orders/update`
- **Payload:** `{ orders: [ ... ] }`
- **Response:** List of updated order IDs and any encountered errors.

#### 12. `starshipit_batch_update_orders`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Mass-assign a single carrier or product/service code across multiple order IDs.
- **Parameters:**
  - `order_ids` (required array of positive integers, min 1)
  - `product_code` (optional string — carrier service code)
  - `carrier_id` (optional string)
- **Endpoint:** `PUT orders/batchupdate`
- **Payload:** `{ order_ids, product_code, carrier_id }`
- **Response:** Text confirmation with updated order count.

#### 13. `starshipit_delete_order`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Permanently delete an unshipped order.
- **Parameters:**
  - `order_id` (required positive integer)
- **Endpoint:** `DELETE orders/delete`
- **Payload:** `{ order_id }` passed in the Axios DELETE body.
- **Response:** Confirmation of permanent deletion.

#### 14. `starshipit_archive_order`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Soft-archive an order, hiding it from the active queue while preserving historical records.
- **Parameters:**
  - `order_id` (required positive integer)
- **Endpoint:** `POST orders/archive`
- **Payload:** `{ order_id }`
- **Response:** Confirmation text.

#### 15. `starshipit_restore_order`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Restore an archived order back to the active unshipped queue.
- **Parameters:**
  - `order_id` (required positive integer)
- **Endpoint:** `POST orders/restore`
- **Payload:** `{ order_id }`
- **Response:** Confirmation text.

#### 16. `starshipit_merge_orders`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Consolidate multiple child orders into a single parent order to ship in a combined consignment.
- **Parameters:**
  - `parent_order_id` (required positive integer)
  - `child_order_ids` (required array of positive integers, min 1)
- **Endpoint:** `POST orders/merge`
- **Payload:** `{ parent_order_id, child_order_ids }`
- **Response:** Markdown confirmation of merged order ID and absorbed children.

#### 17. `starshipit_get_suggested_merges`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Automatically identify pending orders sharing the same recipient address for consolidation.
- **Parameters:**
  - `limit`, `page`, `response_format`
- **Endpoint:** `GET orders/mergeable`
- **Response:** Markdown grouping or JSON list of candidate parent and child orders.

#### 18. `starshipit_assign_orders`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Transfer orders between separate Starshipit accounts or sub-accounts.
- **Parameters:**
  - `orders` (required array, min 1): each element containing `order_id`, `current_api_key`, `new_api_key`.
- **Endpoint:** `POST orders/assign`
- **Payload:** `{ orders: [ { order_id, current_api_key, new_api_key } ] }`
- **Response:** Confirmation of reassigned order count.

---

### 4.2 Shipment Tools (`src/tools/shipments.ts` — 6 Tools)

#### 19. `starshipit_print_label`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Generate a carrier shipping label and tracking number for an order (transitions order from Unshipped to Printed).
- **Parameters:**
  - `order_id` (required positive integer)
  - `carrier` (optional string override)
  - `carrier_service_code` (optional string override)
  - `packages` (optional array of `PackageSchema` override)
  - `reprint` (optional boolean, default: false) — **Required to be `true`** if a label was previously generated.
- **Endpoint:** `POST orders/shipment`
- **Payload:** `{ order_id, carrier?, carrier_service_code?, packages?, reprint? }`
- **Response:** Raw JSON: `{ order_id, order_number, carrier_name, tracking_numbers[], labels[] (base64 strings), label_types[] }`.

#### 20. `starshipit_print_labels`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Generate shipping labels for multiple orders in a single bulk batch.
- **Parameters:**
  - `order_ids` (required array of positive integers, min 1)
  - `reprint` (optional boolean, default: false)
- **Endpoint:** `POST orders/shipments`
- **Payload:** `{ order_ids: [...], reprint? }`
- **Response:** Raw JSON: `{ labels: [{ label_type, label_base64_string }] }`.

#### 21. `starshipit_print_packing_slips`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Generate combined PDF packing slips for warehouse order picking and verification.
- **Parameters:**
  - `order_ids` (required array of positive integers, min 1)
- **Endpoint:** `POST orders/packingslips`
- **Payload:** `{ order_ids: [...] }`
- **Response:** JSON containing download URL or base64 PDF stream.

#### 22. `starshipit_manifest_shipment`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Finalize and close printed orders with the carrier by their internal `order_ids`.
- **Parameters:**
  - `order_ids` (required array of positive integers, min 1 — all orders must already have printed labels)
- **Endpoint:** `POST orders/manifest`
- **Payload:** `{ order_ids: [...] }`
- **Response:** JSON with `manifest_id`, carrier, and manifested tracking numbers.

#### 23. `starshipit_clone_shipment`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Duplicate an existing shipment. When `to_return_shipment: true`, sender and recipient addresses are automatically swapped to create a customer return order.
- **Parameters:**
  - `order_id` (required positive integer)
  - `to_return_shipment` (optional boolean, default: false)
- **Endpoint:** `POST orders/shipment/clone`
- **Payload:** `{ order_id, to_return_shipment? }`
- **Response:** JSON record of the cloned order.

#### 24. `starshipit_replace_shipment`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Voids an existing printed label with the carrier and re-issues a fresh label with a new tracking number.
- **Parameters:**
  - `order_id` (required positive integer)
- **Endpoint:** `POST orders/shipment/replace`
- **Payload:** `{ order_id }`
- **Response:** JSON containing updated order record with new tracking number and label URL.

---

### 4.3 Rate & Quoting Tools (`src/tools/rates.ts` — 2 Tools)

#### 25. `starshipit_get_rates`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Query live price quotes and estimated transit times across all active carriers between two addresses.
- **Parameters:**
  - `sender` (required `RateAddressSchema` — requires street, suburb, post_code, 2-letter `country_code`)
  - `destination` (required `RateAddressSchema`)
  - `packages` (required array of `PackageSchema`, min 1; weights in kg, dimensions in metres)
  - `response_format`
- **Endpoint:** `POST rates`
- **Payload:** `{ sender, destination, packages }`
- **Response:** Formatted Markdown comparison table (`| Carrier | Service | Price | Transit |`) or JSON `{ rates: Rate[], count: number }`.

#### 26. `starshipit_get_delivery_services`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Retrieve configured carrier service codes and live pricing for an existing order or prospective route.
- **Parameters:**
  - `order_id` (optional positive integer) — If provided, fetches services matching the existing order.
  - `refresh_rate` (optional boolean) — Force live carrier lookup, bypassing cache.
  - `sender`, `destination`, `packages` (optional `RateAddressSchema` and packages — required if `order_id` is omitted).
  - `response_format`
- **Endpoint:** `POST deliveryservices`
- **Payload:** `{ order_id?, refresh_rate?, sender?, destination?, packages? }`
- **Response:** Markdown table or JSON `{ services: Rate[], count: number }`.

---

### 4.4 Tracking Tools (`src/tools/tracking.ts` — 2 Tools)

#### 27. `starshipit_track_shipment`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Retrieve real-time tracking status, checkpoints, carrier scans, and delivery estimates for any shipment.
- **Parameters:**
  - `tracking_number` (required string, min 1)
  - `response_format`
- **Endpoint:** `GET track` (`?tracking_number=<tracking_number>`)
- **Response:** Markdown status and `tracking_events` timeline, or raw JSON `{ results: { tracking_status, tracking_events[], ... } }`.

#### 28. `starshipit_create_tracking_order`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Import external shipments (dispatched outside Starshipit) to enable centralized tracking, customer SMS/email notifications, and branded tracking pages.
- **Parameters:**
  - `orders` (required array, min 1): each entry requiring `carrier` (carrier code, e.g. `"AUSPOST"`), `tracking_number`, and at least one of `name` or `order_number`.
- **Endpoint:** `POST orders/shipped`
- **Payload:** `{ orders: [ { carrier, tracking_number, name?, order_number? } ] }`
- **Response:** Raw JSON `{ orders: { "<order_id>": "<tracking_number>" } }` (a map, not an array).

---

### 4.5 Manifest Tools (`src/tools/manifests.ts` — 4 Tools)

#### 29. `starshipit_list_manifests`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Browse and audit previously created carrier manifests.
- **Parameters:**
  - `limit`, `page`, `response_format`
- **Endpoint:** `GET manifests` (`?limit=...&page=...`)
- **Response:** Markdown list or raw JSON `{ manifests: [{ id, name, date, numberArticles, numberConsignments, carrierId, ... }], total_count, total_pages }`.

#### 30. `starshipit_get_manifest_files`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Retrieve download links for printable manifest PDF documents required by drivers during courier pickup.
- **Parameters:**
  - `manifest_id` (optional positive integer filter)
  - `limit`, `page`, `response_format`
- **Endpoint:** `GET manifests/files/` (trailing slash required)
- **Response:** Markdown file names and sizes, or raw JSON `{ files: [{ file_name, file_data (base64) }] }`.

#### 31. `starshipit_manifest_by_tracking`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Manifest (close) shipments using tracking numbers or merchant order numbers. Ideal for packing bench barcode-scanner workflows.
- **Parameters:**
  - `tracking_numbers` (required array of strings, min 1)
  - `use_order_numbers` (optional boolean, default: false — set to `true` if array contains order numbers)
  - `response_format`
- **Endpoint:** `POST manifests/shipments`
- **Payload:** `{ tracking_numbers: [...], use_order_numbers?: boolean }`
- **Response:** Confirmation of generated `manifest_id` and submission status.

#### 32. `starshipit_manifest_by_carrier`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Bulk-manifest ALL unmanifested, printed shipments for a specific carrier at once (end-of-day closure).
- **Parameters:**
  - `carrier` (required string, min 1 — e.g. `"AusPost"`, `"DHL"`, `"StarTrack"`)
  - `response_format`
- **Endpoint:** `POST manifests/carrier`
- **Payload:** `{ carrier: string }`
- **Response:** Confirmation of closed `manifest_id` and carrier batch status.

---

### 4.6 Product Catalog Tools (`src/tools/products.ts` — 4 Tools)

#### 33. `starshipit_list_products`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Search and browse items in the master product catalogue.
- **Parameters:**
  - `search_term` (string, default: `''`)
  - `page_number` (integer >= 1, default: 1) — *Note distinct pagination naming*
  - `page_size` (integer [10..2000], default: 50)
  - `skip_records` (integer >= 0, default: 0)
  - `sort_column` (enum: `'Sku'`, `'Barcode'`, `'Brand'`, `'Price'`, `'Title'`, `'Weight'`, etc., default: `'Sku'`)
  - `sort_direction` (enum: `'Ascending'` | `'Descending'`, default: `'Ascending'`)
  - `response_format`
- **Endpoint:** `GET products`
- **Response:** Markdown product catalogue or raw JSON `{ data: { products[] }, total_records, total_pages, page_number, page_size }`.

#### 34. `starshipit_add_product`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Add a new SKU to the catalogue with physical dimensions, weights, and international customs data (HS codes, country of origin).
- **Parameters:**
  - `product` (required object):
    - `sku` (required string, min 1)
    - `title` (required string, min 1)
    - `weight` (optional kg), `height`, `length`, `width` (optional metres)
    - `price` (optional declared customs value), `hs_code`, `country`, `mid`, `dangerous_goods` (optional)
    - `barcode`, `bin_location`, `brand`, `color`, `size`, `material`, `model`, `usage` (optional)
- **Endpoint:** `POST products`
- **Payload:** `{ product: <ProductFields> }`
- **Response:** Confirmation of created product record.

#### 35. `starshipit_update_product`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Update existing product attributes, dimensions, or customs codes by ID.
- **Parameters:**
  - `id` (required positive integer at top level)
  - `product` (required object containing `id`, `sku`, `title`, and updated product fields)
- **Endpoint:** `PUT products/update`
- **Payload:** `{ id, product: { id, sku, title, ... } }`
- **Response:** Confirmation of updated product.

#### 36. `starshipit_delete_products`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Delete specific products by ID, or purge the entire catalogue.
- **Parameters:**
  - `product_ids` (required array of positive integers)
  - `all_products` (optional boolean, default: false — **DANGEROUS**: if true, purges all products)
  - `response_format`
- **Endpoint:** `DELETE products/delete`
- **Payload:** `{ product_ids: [...], all_products?: boolean }` passed in Axios DELETE body.
- **Response:** Count of deleted products.

---

### 4.7 Address Book Tools (`src/tools/address-book.ts` — 4 Tools)

#### 37. `starshipit_list_addresses`
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Search and list saved contacts, suppliers, and warehouse addresses.
- **Parameters:**
  - `search_term` (optional string)
  - `limit` (optional integer [1..250], default: 50)
  - `page` (optional integer >= 1, default: 1)
  - `response_format`
- **Endpoint:** `GET addressbook/filtered` (`?limit=...&page=...&search_term=...`)
- **Response:** Formatted markdown contact list or JSON `{ addresses, count, total_records, total_pages, page }`.

#### 38. `starshipit_add_address`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`
- **Purpose:** Save a new reusable delivery address and courier preferences to the address book.
- **Parameters:**
  - `address` (required `AddressBookEntrySchema`): requires `name`, `street`, `post_code`, `country`. Optional: `company`, `phone`, `email`, `suburb`, `city`, `state`, `instructions`, `code`, `carrier`, `signature_required`.
- **Endpoint:** `POST addressbook/` (trailing slash required)
- **Payload:** `{ address: <AddressBookEntry> }`
- **Response:** Confirmation text and formatted address details.

#### 39. `starshipit_update_address`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Replace all fields of an existing address book entry by ID.
- **Parameters:**
  - `id` (required positive integer)
  - `address` (required full replacement `AddressBookEntrySchema`)
- **Endpoint:** `POST addressbook/update` (*Note: Starshipit REST API uses `POST`, not `PUT`*)
- **Payload:** `{ id, address: <AddressBookEntry> }`
- **Response:** Confirmation of updated address.

#### 40. `starshipit_delete_addresses`
- **Annotations:** `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true`, `openWorldHint: true`
- **Purpose:** Permanently batch-delete saved addresses by ID.
- **Parameters:**
  - `address_ids` (required array of positive integers, min 1)
- **Endpoint:** `POST addressbook/delete` (*Note: Starshipit REST API uses `POST`, not `DELETE`*)
- **Payload:** `{ address_ids: [...] }`
- **Response:** Confirmation of deleted address IDs.

---

## 5. End-to-End Fulfilment Workflows & State Machine

```
                   [ Customer Checkout / ERP ]
                                │
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
        starshipit_create_order    starshipit_create_orders_bulk
                  │                           │
                  └─────────────┬─────────────┘
                                ▼
                       [ Status: UNSHIPPED ]
                                │
           ┌────────────────────┼────────────────────┐
           ▼                    ▼                    ▼
 starshipit_get_rates /   starshipit_get_     starshipit_archive_order
 get_delivery_services    suggested_merges           │
           │                    │                    ▼
           ▼                    ▼            [ Status: ARCHIVED ]
 starshipit_update_order / starshipit_merge_         │
 batch_update_orders         orders           starshipit_restore_order
           │                    │                    │
           └────────────────────┼────────────────────┘
                                ▼
                 starshipit_print_packing_slips (Pick & Pack)
                                │
                                ▼
                 starshipit_print_label / print_labels
                                │
                                ▼
                       [ Status: PRINTED ]
                                │
           ┌────────────────────┴────────────────────┐
           ▼                                         ▼
 starshipit_replace_shipment               starshipit_manifest_shipment /
 (voids label & re-issues)                 starshipit_manifest_by_tracking /
                                           starshipit_manifest_by_carrier
                                                     │
                                                     ▼
                                            [ Status: SHIPPED ]
                                                     │
                                                     ▼
                                           starshipit_track_shipment
                                                     │
                                                     ▼
                                           [ Status: DELIVERED ]
```

### 5.1 Standard Fulfillment Sequence
1. **Catalog Ingestion & Pre-population:** Configure items via `starshipit_add_product`. Products auto-fill weight, dimensions, and HS codes into order line items.
2. **Order Ingestion:** Submit orders via `starshipit_create_order` or `starshipit_create_orders_bulk`. Orders enter the queue with status `unshipped`.
3. **Consolidation Audit:** Run `starshipit_get_suggested_merges` to identify orders going to the same address. Combine them using `starshipit_merge_orders`.
4. **Service Rating & Selection:** Run `starshipit_get_rates` (standalone route) or `starshipit_get_delivery_services(order_id: ..., refresh_rate: true)`. Apply the optimal service code via `starshipit_update_order` or `starshipit_batch_update_orders`.
5. **Pick & Pack:** Call `starshipit_print_packing_slips` to generate warehouse packing slips.
6. **Label Generation:** Generate labels and tracking numbers using `starshipit_print_label` or `starshipit_print_labels`. Order moves from `unshipped` to `printed`.
7. **End-of-Day Manifesting:** Close shipments with carriers using one of three manifesting strategies:
   - *By Order IDs:* `starshipit_manifest_shipment` (`POST orders/manifest`)
   - *By Tracking / Order Numbers:* `starshipit_manifest_by_tracking` (`POST manifests/shipments`)
   - *By Carrier Bulk:* `starshipit_manifest_by_carrier` (`POST manifests/carrier`)
   Retrieve the driver signature PDF via `starshipit_get_manifest_files`. Order moves to `shipped`.
8. **Delivery Audit & Tracking:** Track packages using `starshipit_track_shipment`. List final deliveries with `starshipit_list_delivered_orders`.

### 5.2 Exception & Return Workflows
- **Customer Returns:** Use `starshipit_clone_shipment(order_id: ..., to_return_shipment: true)` to duplicate an order with inverted addresses. Then generate a return label via `starshipit_print_label`.
- **Misprinted / Spoiled Labels:** Call `starshipit_replace_shipment(order_id: ...)`. This automatically voids the existing carrier tracking number and issues a replacement label.
- **External Carrier Shipments:** For orders booked outside Starshipit, import tracking data via `starshipit_create_tracking_order` (`POST orders/shipped`) to trigger customer notifications and branded tracking pages.

---

## 6. Critical Implementation Nuances & API Discrepancies

AI agents interacting with or refactoring this codebase must account for the following runtime quirks and known discrepancies identified against the Starshipit API:

Response shapes for tracking, products, rates, delivery services, manifests, manifest files and labels were checked against the saved examples in StarShipIt's Postman collection and fixed on 2026-10-16. The markdown formatters read `results`, `data.products`/`total_records`, `total_price`, and the manifest fields `id`/`name`/`date`/`numberConsignments`. Handlers that return raw JSON (labels, tracking-only orders) were never affected.

| Subsystem | Exact Issue | Source Reference | Real Starshipit API Behavior | Impact & Guidance |
| :--- | :--- | :--- | :--- | :--- |
| **Reprint Constraint** | Label reprint conflict | `src/tools/shipments.ts:92` | Starshipit returns `409 Conflict` if order already has a label. | Must pass `reprint: true` if an order already has a label generated. |
| **Order Deletion** | HTTP DELETE with payload | `src/tools/orders.ts:1041` | `DELETE /orders/delete` requires `{ order_id }` in body. | Uses `apiRequest('orders/delete', 'DELETE', { order_id })`. Proxy configurations must allow request bodies on HTTP DELETE. |
| **Address Updates** | HTTP POST instead of PUT | `src/tools/address-book.ts:389, 462` | Starshipit uses `POST addressbook/update` and `POST addressbook/delete`. | Do NOT change to HTTP `PUT` or `DELETE`; Starshipit rejects them. |
| **Order Types** | `destination` optionality | `src/types.ts:45` vs `orders.ts:124` | `GET orders/search` and `GET orders/shipped` flatten recipient fields and omit `destination`. | `src/types.ts` defines `destination: Destination;` as required, but search responses lack this object. `formatOrdersAsMarkdown` guards with `if (o.destination)`. |

