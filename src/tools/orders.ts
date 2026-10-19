import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, handleApiError } from '../services/api-client.js';
import {
  ResponseFormat,
  ResponseFormatSchema,
  PaginationSchema,
  AddressSchema,
  PackageSchema,
  OrderItemSchema,
  ApiResultSchema,
  toolResult,
  toolError,
} from '../schemas/common.js';
import type { Order } from '../types.js';

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

/**
 * Writable fields shared between create and update operations.
 * All fields are optional here; create / update schemas extend this
 * and enforce required fields independently.
 */
const OrderWriteFieldsSchema = z.object({
  order_date: z
    .string()
    .datetime()
    .optional()
    .describe(
      'ISO 8601 timestamp of when the order was placed (e.g. 2024-01-15T09:00:00Z)',
    ),
  reference: z
    .string()
    .optional()
    .describe('Secondary reference field (e.g. customer PO number)'),
  carrier: z
    .string()
    .optional()
    .describe('Carrier code (e.g. "AUSPOST", "DHL")'),
  carrier_name: z
    .string()
    .optional()
    .describe('Human-readable carrier name'),
  shipping_method: z
    .string()
    .optional()
    .describe('Shipping method / service level name'),
  signature_required: z
    .boolean()
    .optional()
    .describe('Whether a recipient signature is required on delivery'),
  return_order: z
    .boolean()
    .optional()
    .describe('True if this is a return / reverse-logistics order'),
  items: z
    .array(OrderItemSchema)
    .optional()
    .describe('Line items in the order (products / goods)'),
  packages: z
    .array(PackageSchema)
    .optional()
    .describe('Physical package dimensions and weights'),
});

/** Schema for a single order creation payload — order_number and destination required. */
const CreateOrderPayloadSchema = OrderWriteFieldsSchema.extend({
  order_number: z
    .string()
    .min(1)
    .describe('Merchant order number (required when creating an order)'),
  destination: AddressSchema.describe('Recipient destination address (required)'),
}).strict();

/** Schema for a single order update payload — order_id required; all other fields optional. */
const UpdateOrderPayloadSchema = OrderWriteFieldsSchema.partial()
  .extend({
    order_id: z
      .number()
      .int()
      .positive()
      .describe('StarShipIt internal order ID to update (required)'),
    order_number: z.string().optional().describe('Merchant order number'),
    destination: AddressSchema.partial()
      .optional()
      .describe('Destination address fields to update (partial patch)'),
  })
  .strict();

// ---------------------------------------------------------------------------
// Response-formatting helpers
// ---------------------------------------------------------------------------

interface PaginationMeta {
  total?: number;
  has_more?: boolean;
  page?: number;
}

function formatOrdersAsMarkdown(orders: Order[], meta?: PaginationMeta): string {
  if (orders.length === 0) return '**No orders found.**\n';

  const lines: string[] = [];

  if (meta) {
    if (meta.total !== undefined) lines.push(`**Total:** ${meta.total}`);
    if (meta.page !== undefined) lines.push(`**Page:** ${meta.page}`);
    if (meta.has_more) {
      lines.push('> More results available — increase `page` to continue.');
    }
    lines.push('');
  }

  for (const o of orders) {
    lines.push(`### Order ${o.order_number ?? o.order_id ?? '(unknown)'}`);
    if (o.order_id) lines.push(`- **ID:** ${o.order_id}`);
    if (o.order_date) lines.push(`- **Date:** ${o.order_date}`);
    if (o.reference) lines.push(`- **Reference:** ${o.reference}`);
    if (o.carrier) {
      lines.push(`- **Carrier:** ${o.carrier_name ?? o.carrier}`);
    }
    if (o.shipping_method) lines.push(`- **Shipping Method:** ${o.shipping_method}`);
    if (o.destination) {
      const d = o.destination;
      const locality = [d.city ?? d.suburb ?? '', d.state ?? '', d.post_code]
        .filter(Boolean)
        .join(' ');
      lines.push(`- **Destination:** ${d.name}, ${d.street}, ${locality}, ${d.country}`);
    }
    if (o.items && o.items.length > 0) {
      lines.push(`- **Items (${o.items.length}):**`);
      for (const item of o.items) {
        const skuPart = item.sku ? ` (SKU: ${item.sku})` : '';
        const qtyPart = item.quantity !== undefined ? ` × ${item.quantity}` : '';
        lines.push(`  - ${item.description}${skuPart}${qtyPart}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool registrations
// ---------------------------------------------------------------------------

export function registerOrderTools(server: McpServer): void {
  // ── 1. starshipit_list_unshipped_orders ─────────────────────────────────────

  server.registerTool(
    'starshipit_list_unshipped_orders',
    {
      title: 'List Unshipped Orders',
      description: `List unshipped orders from StarShipIt. Returns orders that have been imported but not yet shipped.

**When to use:** Call this to see your pending fulfilment queue. It is read-only and safe to call multiple times.

**Parameters:**
- \`since_order_date\` (optional) — Only return orders placed after this ISO 8601 timestamp (e.g. \`"2024-01-01T00:00:00Z"\`)
- \`since_last_updated\` (optional) — Only return orders last updated after this ISO 8601 timestamp
- \`limit\` (optional, default 50, max 250) — Number of results per page
- \`page\` (optional, default 1) — Page number for pagination
- \`response_format\` (optional) — \`"markdown"\` (default) or \`"json"\`

**Returns:** List of Order objects including destination, items, packages, and carrier assignment. The response includes a \`has_more\` flag when further pages exist.

**Example response (JSON):**
\`\`\`json
{
  "orders": [{ "order_id": 10001, "order_number": "#1001", "carrier": "AUSPOST", "destination": { "name": "Jane Smith", ... } }],
  "total": 120,
  "has_more": true,
  "page": 1
}
\`\`\`

**Errors:** 401 if API keys are missing or invalid; 429 if rate-limited.`,
      inputSchema: z
        .object({
          since_order_date: z
            .string()
            .datetime()
            .optional()
            .describe(
              'Only return orders placed after this ISO 8601 timestamp (e.g. 2024-01-01T00:00:00Z)',
            ),
          since_last_updated: z
            .string()
            .datetime()
            .optional()
            .describe(
              'Only return orders last-updated after this ISO 8601 timestamp',
            ),
          limit: PaginationSchema.shape.limit,
          page: PaginationSchema.shape.page,
          response_format: ResponseFormatSchema,
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ since_order_date, since_last_updated, limit, page, response_format }) => {
      try {
        const result = await apiRequest<{
          orders?: Order[];
          total?: number;
          has_more?: boolean;
        }>('orders/unshipped', 'GET', undefined, {
          since_order_date,
          since_last_updated,
          limit,
          page,
        });

        const orders = result.orders ?? [];
        const has_more = result.has_more ?? orders.length >= (limit ?? 50);

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify({ orders, total: result.total, has_more, page }, null, 2);
        } else {
          text =
            '## Unshipped Orders\n\n' +
            formatOrdersAsMarkdown(orders, { total: result.total, has_more, page });
        }

        return toolResult(text, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 2. starshipit_list_printed_orders ───────────────────────────────────────

  server.registerTool(
    'starshipit_list_printed_orders',
    {
      title: 'List Printed Orders',
      description: `List printed (label generated) orders from StarShipIt. Use this to review orders where labels have been printed but may not yet be manifested.

**When to use:** Use to audit recently-printed shipments or find orders still awaiting manifesting before a carrier pickup.

**Parameters:**
- \`status\` (optional, default \`"recently_printed"\`) — Filter by shipment status:
  - \`recently_printed\` — labels printed recently
  - \`unmanifested\` — printed but not yet manifested
- \`since_created_date\` (optional) — Only return shipments created after this ISO timestamp
- \`limit\` (optional, default 50, max 250) — Number of results per page
- \`page\` (optional, default 1) — Page number
- \`response_format\` — \`"markdown"\` (default) or \`"json"\`

**Returns:** List of Shipment/Order objects including tracking numbers and carrier info. Includes \`has_more\` flag.

**Errors:** 401 if API keys invalid; 400 if \`status\` value is not recognised.`,
      inputSchema: z
        .object({
          status: z
            .enum(['recently_printed', 'unmanifested'])
            .default('recently_printed')
            .describe(
              'Filter by shipment status: recently_printed (default) or unmanifested',
            ),
          since_created_date: z
            .string()
            .datetime()
            .optional()
            .describe(
              'Only return shipments created after this ISO 8601 timestamp',
            ),
          limit: PaginationSchema.shape.limit,
          page: PaginationSchema.shape.page,
          response_format: ResponseFormatSchema,
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ status, since_created_date, limit, page, response_format }) => {
      try {
        const result = await apiRequest<{
          orders?: Order[];
          shipments?: Order[];
          total?: number;
          has_more?: boolean;
        }>('orders/shipments', 'GET', undefined, {
          status,
          since_created_date,
          limit,
          page,
        });

        const orders = result.orders ?? result.shipments ?? [];
        const has_more = result.has_more ?? orders.length >= (limit ?? 50);

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify({ orders, total: result.total, has_more, page }, null, 2);
        } else {
          text =
            `## Printed Orders (${status})\n\n` +
            formatOrdersAsMarkdown(orders, { total: result.total, has_more, page });
        }

        return toolResult(text, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 3. starshipit_list_shipped_orders ───────────────────────────────────────

  server.registerTool(
    'starshipit_list_shipped_orders',
    {
      title: 'List Shipped Orders',
      description: `List shipped orders from StarShipIt. Returns orders that have been manifested and dispatched to the carrier.

**When to use:** Use to check dispatch history or to feed downstream tracking workflows.

**Parameters:**
- \`since_shipped_date\` (optional) — Only return orders shipped after this ISO 8601 timestamp
- \`limit\` (optional, default 50, max 250) — Number of results per page
- \`page\` (optional, default 1) — Page number
- \`response_format\` — \`"markdown"\` (default) or \`"json"\`

**Returns:** List of shipped Order objects with tracking numbers and carrier details. Includes \`has_more\` flag.

**Errors:** 401 if API keys invalid.`,
      inputSchema: z
        .object({
          since_shipped_date: z
            .string()
            .datetime()
            .optional()
            .describe(
              'Only return orders shipped after this ISO 8601 timestamp (e.g. 2024-01-01T00:00:00Z)',
            ),
          limit: PaginationSchema.shape.limit,
          page: PaginationSchema.shape.page,
          response_format: ResponseFormatSchema,
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ since_shipped_date, limit, page, response_format }) => {
      try {
        const result = await apiRequest<{
          orders?: Order[];
          total?: number;
          has_more?: boolean;
        }>('orders/shipped', 'GET', undefined, { since_shipped_date, limit, page });

        const orders = result.orders ?? [];
        const has_more = result.has_more ?? orders.length >= (limit ?? 50);

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify({ orders, total: result.total, has_more, page }, null, 2);
        } else {
          text =
            '## Shipped Orders\n\n' +
            formatOrdersAsMarkdown(orders, { total: result.total, has_more, page });
        }

        return toolResult(text, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 4. starshipit_list_delivered_orders ─────────────────────────────────────

  server.registerTool(
    'starshipit_list_delivered_orders',
    {
      title: 'List Delivered Orders',
      description: `List delivered orders from StarShipIt. Returns orders where the carrier has confirmed delivery.

**When to use:** Use for post-delivery reporting, customer-service lookups, or reconciliation workflows.

**Parameters:**
- \`order_ref\` (optional) — Filter by order reference string; useful for looking up a specific customer's deliveries
- \`response_format\` — \`"markdown"\` (default) or \`"json"\`

**Returns:** List of delivered Order objects including carrier and destination details.

**Errors:** 401 if API keys invalid.`,
      inputSchema: z
        .object({
          order_ref: z
            .string()
            .optional()
            .describe('Filter delivered orders by order reference string'),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_ref, response_format }) => {
      try {
        const result = await apiRequest<{ orders?: Order[]; total?: number }>(
          'orders/delivered',
          'GET',
          undefined,
          { order_ref },
        );

        const orders = result.orders ?? [];

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify({ orders, total: result.total }, null, 2);
        } else {
          text =
            '## Delivered Orders\n\n' +
            formatOrdersAsMarkdown(orders, { total: result.total });
        }

        return toolResult(text, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 5. starshipit_get_orders_summary ────────────────────────────────────────

  server.registerTool(
    'starshipit_get_orders_summary',
    {
      title: 'Get Orders Summary',
      description: `Get a summary of orders filtered by status from StarShipIt. Useful for dashboards and reporting.

**When to use:** Use when you need a status-specific count or listing for reporting, not fulfilment operations. Supports sorting and pagination.

**Parameters:**
- \`order_status\` (required) — Status to filter on (e.g. \`"shipped"\`, \`"unshipped"\`, \`"delivered"\`, \`"archived"\`)
- \`sort\` (optional) — Sort field; refer to the StarShipIt API docs for supported values
- \`limit\` (optional, default 50, max 250) — Number of results per page
- \`page\` (optional, default 1) — Page number
- \`response_format\` — \`"markdown"\` (default) or \`"json"\`

**Returns:** Summary list of orders for the given status. Includes \`has_more\` flag.

**Errors:** 400 if \`order_status\` is not a recognised value; 401 if API keys invalid.`,
      inputSchema: z
        .object({
          order_status: z
            .string()
            .min(1)
            .describe(
              'Order status to summarise — e.g. "shipped", "unshipped", "delivered", "archived"',
            ),
          sort: z
            .string()
            .optional()
            .describe(
              'Sort field for results (refer to StarShipIt API docs for supported values)',
            ),
          limit: PaginationSchema.shape.limit,
          page: PaginationSchema.shape.page,
          response_format: ResponseFormatSchema,
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_status, sort, limit, page, response_format }) => {
      try {
        const result = await apiRequest<{
          orders?: Order[];
          total?: number;
          has_more?: boolean;
        }>('orders/summary', 'GET', undefined, { order_status, sort, limit, page });

        const orders = result.orders ?? [];
        const has_more = result.has_more ?? orders.length >= (limit ?? 50);

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify({ orders, total: result.total, has_more, page }, null, 2);
        } else {
          text =
            `## Orders Summary — ${order_status}\n\n` +
            formatOrdersAsMarkdown(orders, { total: result.total, has_more, page });
        }

        return toolResult(text, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 6. starshipit_search_orders ─────────────────────────────────────────────

  server.registerTool(
    'starshipit_search_orders',
    {
      title: 'Search Orders',
      description: `Search orders in StarShipIt by a free-text phrase. Searches across order numbers, references, recipient names, tracking numbers, and other indexed fields.

**When to use:** Use when you need to find a specific order but don't have the exact order_id. Supports partial matches.

**Parameters:**
- \`phrase\` (required) — Search string (e.g. order number, customer name, tracking number)
- \`limit\` (optional, default 50, max 250) — Number of results per page
- \`page\` (optional, default 1) — Page number
- \`response_format\` — \`"markdown"\` (default) or \`"json"\`

**Returns:** List of matching Order objects. Includes \`has_more\` flag when more pages exist.

**Errors:** 400 if \`phrase\` is empty; 401 if API keys invalid; 429 if rate-limited.`,
      inputSchema: z
        .object({
          phrase: z
            .string()
            .min(1)
            .describe(
              'Search phrase — matched against order number, reference, recipient name, tracking number, etc.',
            ),
          limit: PaginationSchema.shape.limit,
          page: PaginationSchema.shape.page,
          response_format: ResponseFormatSchema,
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ phrase, limit, page, response_format }) => {
      try {
        const result = await apiRequest<{
          orders?: Order[];
          total?: number;
          has_more?: boolean;
        }>('orders/search', 'GET', undefined, { phrase, limit, page });

        const orders = result.orders ?? [];
        const has_more = result.has_more ?? orders.length >= (limit ?? 50);

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify({ orders, total: result.total, has_more, page }, null, 2);
        } else {
          text =
            `## Search Results for "${phrase}"\n\n` +
            formatOrdersAsMarkdown(orders, { total: result.total, has_more, page });
        }

        return toolResult(text, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 7. starshipit_get_order ──────────────────────────────────────────────────

  server.registerTool(
    'starshipit_get_order',
    {
      title: 'Get Order',
      description: `Retrieve a single order from StarShipIt by its internal ID or merchant order number. At least one of \`order_id\` or \`order_number\` must be supplied.

**When to use:** Use when you need the full detail of a specific order — destination, items, packages, carrier assignment, and metadata.

**Parameters:**
- \`order_id\` (optional) — StarShipIt internal numeric order ID
- \`order_number\` (optional) — Merchant-assigned order number / reference (e.g. \`"#1001"\`)

At least one of \`order_id\` or \`order_number\` must be provided.

**Returns:** Full Order object.

**Example response (JSON):**
\`\`\`json
{
  "order": {
    "order_id": 12345,
    "order_number": "#1001",
    "carrier": "AUSPOST",
    "destination": { "name": "Jane Smith", "street": "1 Test St", "post_code": "3000", "country": "Australia" }
  }
}
\`\`\`

**Errors:** 400 if neither identifier provided; 404 if order not found; 401 if API keys invalid.`,
      inputSchema: z
        .object({
          order_id: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('StarShipIt internal numeric order ID'),
          order_number: z
            .string()
            .optional()
            .describe('Merchant-assigned order number (e.g. "#1001")'),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_id, order_number, response_format }) => {
      if (order_id === undefined && (order_number === undefined || order_number === '')) {
        return toolError('Error: At least one of `order_id` or `order_number` must be provided.');
      }

      try {
        const result = await apiRequest<{ order?: Order; orders?: Order[] }>(
          'orders',
          'GET',
          undefined,
          { order_id, order_number },
        );

        // API may return a single order or an array
        const order: Order | undefined =
          result.order ?? (Array.isArray(result.orders) ? result.orders[0] : undefined);

        if (!order) {
          return toolError('Error: Order not found.');
        }

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify({ order }, null, 2);
        } else {
          text = '## Order Details\n\n' + formatOrdersAsMarkdown([order]);
        }

        return toolResult(text, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 8. starshipit_create_order ───────────────────────────────────────────────

  server.registerTool(
    'starshipit_create_order',
    {
      title: 'Create Order',
      description: `Create a new order in StarShipIt. The order will appear in the unshipped queue ready for label generation.

**When to use:** Call this when a new order has been placed and needs to be imported into StarShipIt for fulfilment.

**Parameters (all under \`order\` object):**
- \`order_number\` (required) — Merchant order number (must be unique)
- \`destination\` (required) — Recipient address (name, street, post_code, country are required)
- \`order_date\` (optional) — ISO timestamp when the order was placed
- \`reference\` (optional) — Secondary reference (e.g. customer PO)
- \`carrier\` / \`carrier_name\` (optional) — Pre-assign a carrier
- \`shipping_method\` (optional) — Service level (e.g. "Express")
- \`signature_required\` (optional) — Require signature on delivery
- \`return_order\` (optional) — Mark as a return order
- \`items\` (optional) — Array of line items
- \`packages\` (optional) — Array of package dimensions/weights

**Returns:** Created Order object with assigned \`order_id\`.

**Errors:** 400 if required fields missing or invalid; 409 if order_number already exists; 401 if API keys invalid.`,
      inputSchema: z
        .object({
          order: CreateOrderPayloadSchema.describe('Order data to create'),
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ order }) => {
      try {
        const result = await apiRequest<{ order?: Order; success?: boolean }>(
          'orders',
          'POST',
          { order },
        );

        const created = result.order;
        const text = created
          ? `Order created successfully.\n\n**Order ID:** ${created.order_id}\n**Order Number:** ${created.order_number}`
          : `Order creation request submitted.${result.success === false ? ' The API reported a failure — verify the order in StarShipIt.' : ''}`;

        return toolResult(text, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 9. starshipit_create_orders_bulk ────────────────────────────────────────

  server.registerTool(
    'starshipit_create_orders_bulk',
    {
      title: 'Bulk Create Orders',
      description: `Import multiple orders into StarShipIt in a single API call. Use this for batch fulfilment import from external systems.

**When to use:** Use instead of calling \`starshipit_create_order\` in a loop when you have many orders to import at once. More efficient and rate-limit-friendly.

**Parameters:**
- \`orders\` (required) — Array of order objects (same shape as \`starshipit_create_order\`). Each must include \`order_number\` and \`destination\`.

**Returns:** Summary of created orders including any per-order failures with error details.

**Errors:** 400 if any order payload is malformed; 409 if any order number already exists; 401 if API keys invalid.`,
      inputSchema: z
        .object({
          orders: z
            .array(CreateOrderPayloadSchema)
            .min(1)
            .describe(
              'Array of order objects to import (each must have order_number and destination)',
            ),
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ orders }) => {
      try {
        const result = await apiRequest<{
          orders?: Order[];
          success?: boolean;
          errors?: unknown;
        }>('orders/import', 'POST', { orders });

        const created = result.orders ?? [];
        const lines: string[] = [
          `**Bulk import complete.** ${created.length} order(s) processed.`,
        ];

        if (result.errors) {
          lines.push(
            `\n**Errors:**\n\`\`\`json\n${JSON.stringify(result.errors, null, 2)}\n\`\`\``,
          );
        }

        if (created.length > 0) {
          lines.push('\n**Created Orders:**');
          for (const o of created) {
            lines.push(`- Order ID ${o.order_id}: ${o.order_number}`);
          }
        }

        return toolResult(lines.join('\n'), result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 10. starshipit_update_order ─────────────────────────────────────────────

  server.registerTool(
    'starshipit_update_order',
    {
      title: 'Update Order',
      description: `Update an existing unshipped order in StarShipIt. Only fields provided in the payload will be updated; others remain unchanged (partial patch semantics).

**When to use:** Use to correct order data, change carrier or shipping method, update the destination address, or add/replace items/packages before a label is printed.

**Parameters (all under \`order\` object):**
- \`order_id\` (required) — StarShipIt internal order ID to update
- All other fields from \`starshipit_create_order\` are optional

**Returns:** Updated Order object.

**Errors:** 400 if payload is invalid; 404 if order not found; 409 if order is already shipped (cannot update shipped orders); 401 if API keys invalid.`,
      inputSchema: z
        .object({
          order: UpdateOrderPayloadSchema.describe(
            'Order fields to update — must include order_id; all other fields are optional',
          ),
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order }) => {
      try {
        const result = await apiRequest<{ order?: Order; success?: boolean }>(
          'orders',
          'PUT',
          { order },
        );

        const updated = result.order;
        const text = updated
          ? `Order ${updated.order_id} updated successfully.\n**Order Number:** ${updated.order_number ?? '(unchanged)'}`
          : `Update request for order ${order.order_id} submitted.`;

        return toolResult(text, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 11. starshipit_update_orders_bulk ───────────────────────────────────────

  server.registerTool(
    'starshipit_update_orders_bulk',
    {
      title: 'Bulk Update Orders',
      description: `Update multiple existing orders in StarShipIt in a single API call. Each entry must include \`order_id\`; other fields are optional partial updates.

**When to use:** Use to patch many orders at once — e.g. re-assigning carriers, correcting addresses in bulk, or adding packages to a batch of orders.

**Parameters:**
- \`orders\` (required) — Array of order update objects; each must include \`order_id\` plus any fields to change

**Returns:** Summary of update results including any per-order errors.

**Errors:** 400 if any payload is malformed; 404 if any order not found; 401 if API keys invalid.`,
      inputSchema: z
        .object({
          orders: z
            .array(UpdateOrderPayloadSchema)
            .min(1)
            .describe(
              'Array of order update payloads — each must include order_id',
            ),
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ orders }) => {
      try {
        const result = await apiRequest<{
          orders?: Order[];
          success?: boolean;
          errors?: unknown;
        }>('orders/update', 'PUT', { orders });

        const updated = result.orders ?? [];
        const lines: string[] = [
          `**Bulk update complete.** ${updated.length} order(s) updated.`,
        ];

        if (result.errors) {
          lines.push(
            `\n**Errors:**\n\`\`\`json\n${JSON.stringify(result.errors, null, 2)}\n\`\`\``,
          );
        }

        for (const o of updated) {
          lines.push(`- Order ID ${o.order_id}: ${o.order_number ?? 'updated'}`);
        }

        return toolResult(lines.join('\n'), result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 12. starshipit_batch_update_orders ──────────────────────────────────────

  server.registerTool(
    'starshipit_batch_update_orders',
    {
      title: 'Batch Update Orders',
      description: `Apply the same carrier or shipping service product to a batch of orders in StarShipIt. Use this to reassign carrier/service for multiple orders in a single call.

**When to use:** Use when you want to reassign the same carrier or product code across many orders at once — e.g. after a carrier rate change or when bulk-selecting a service level in your fulfilment workflow.

**Parameters:**
- \`order_ids\` (required) — Array of StarShipIt order IDs to update (must not be empty)
- \`product_code\` (optional) — Carrier service product code to assign (e.g. \`"AUS_PARCEL_REGULAR"\`)
- \`carrier_id\` (optional) — Carrier identifier string to assign

At least one of \`product_code\` or \`carrier_id\` should be provided alongside \`order_ids\`.

**Returns:** Confirmation of how many orders were updated.

**Errors:** 400 if \`order_ids\` is empty or payload is invalid; 404 if any order not found; 401 if API keys invalid.`,
      inputSchema: z
        .object({
          order_ids: z
            .array(z.number().int().positive())
            .min(1)
            .describe('Array of StarShipIt order IDs to update'),
          product_code: z
            .string()
            .optional()
            .describe(
              'Carrier service product code to assign to all specified orders (e.g. "AUS_PARCEL_REGULAR")',
            ),
          carrier_id: z
            .string()
            .optional()
            .describe('Carrier identifier to assign to all specified orders'),
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_ids, product_code, carrier_id }) => {
      try {
        const result = await apiRequest<{
          success?: boolean;
          updated_count?: number;
          errors?: unknown;
        }>('orders/batchupdate', 'PUT', { order_ids, product_code, carrier_id });

        const count = result.updated_count ?? order_ids.length;
        const lines = [`**Batch update complete.** ${count} order(s) updated.`];

        if (result.errors) {
          lines.push(
            `\n**Errors:**\n\`\`\`json\n${JSON.stringify(result.errors, null, 2)}\n\`\`\``,
          );
        }

        return toolResult(lines.join('\n'), result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 13. starshipit_delete_order ─────────────────────────────────────────────

  server.registerTool(
    'starshipit_delete_order',
    {
      title: 'Delete Order',
      description: `Permanently delete an order from StarShipIt. This action is irreversible — the order will be removed from the system entirely.

**When to use:** Only use on unshipped orders that were created in error and must be removed. For orders you want to retain but hide from the queue, use \`starshipit_archive_order\` instead.

**Parameters:**
- \`order_id\` (required) — StarShipIt internal order ID to permanently delete

**Returns:** Confirmation message on success.

**Warning:** This is a destructive, permanent action. The order cannot be recovered after deletion.

**Errors:** 404 if order not found; 409 if the order has already been shipped (cannot delete shipped orders — use archive instead); 401 if API keys invalid.`,
      inputSchema: z
        .object({
          order_id: z
            .number()
            .int()
            .positive()
            .describe('StarShipIt internal order ID to permanently delete'),
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_id }) => {
      try {
        const result = await apiRequest<{ success?: boolean }>('orders/delete', 'DELETE', { order_id });

        return toolResult(`Order ${order_id} has been permanently deleted.`, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 14. starshipit_archive_order ────────────────────────────────────────────

  server.registerTool(
    'starshipit_archive_order',
    {
      title: 'Archive Order',
      description: `Archive an order in StarShipIt. Archived orders are hidden from the main fulfilment queue but remain in the system and can be restored at any time.

**When to use:** Use this instead of deleting when you want to remove an order from the active queue while retaining its record for auditing, reporting, or potential restoration.

**Parameters:**
- \`order_id\` (required) — StarShipIt internal order ID to archive

**Returns:** Confirmation message on success.

**Errors:** 404 if order not found; 401 if API keys invalid.`,
      inputSchema: z
        .object({
          order_id: z
            .number()
            .int()
            .positive()
            .describe('StarShipIt internal order ID to archive'),
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_id }) => {
      try {
        const result = await apiRequest<{ success?: boolean }>('orders/archive', 'POST', { order_id });

        return toolResult(`Order ${order_id} has been archived. Use \`starshipit_restore_order\` to restore it.`, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 15. starshipit_restore_order ────────────────────────────────────────────

  server.registerTool(
    'starshipit_restore_order',
    {
      title: 'Restore Order',
      description: `Restore a previously archived order in StarShipIt, returning it to the active fulfilment queue.

**When to use:** Use to undo an \`starshipit_archive_order\` call, re-activating an order so it can be fulfilled.

**Parameters:**
- \`order_id\` (required) — StarShipIt internal order ID to restore from archive

**Returns:** Confirmation message on success.

**Errors:** 404 if order not found or not currently archived; 401 if API keys invalid.`,
      inputSchema: z
        .object({
          order_id: z
            .number()
            .int()
            .positive()
            .describe('StarShipIt internal order ID to restore from archive'),
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_id }) => {
      try {
        const result = await apiRequest<{ success?: boolean }>('orders/restore', 'POST', { order_id });

        return toolResult(`Order ${order_id} has been restored and is now active in the fulfilment queue.`, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 16. starshipit_merge_orders ─────────────────────────────────────────────

  server.registerTool(
    'starshipit_merge_orders',
    {
      title: 'Merge Orders',
      description: `Merge one or more child orders into a parent order in StarShipIt. After merging, the child orders are absorbed into the parent and the combined shipment will be dispatched as a single package.

**When to use:** Use when a customer has placed multiple orders that should ship together in one box. Use \`starshipit_get_suggested_merges\` first to find recommended candidates.

**Parameters:**
- \`parent_order_id\` (required) — The order ID that will be kept as the merged result
- \`child_order_ids\` (required) — Array of order IDs to merge into the parent (at least one)

**Returns:** Confirmation of the merged order.

**Warning:** This is a destructive operation — child orders will no longer exist as independent orders after the merge.

**Errors:** 400 if \`child_order_ids\` is empty; 404 if any order ID not found; 409 if orders are not merge-compatible (e.g. different destination addresses); 401 if API keys invalid.`,
      inputSchema: z
        .object({
          parent_order_id: z
            .number()
            .int()
            .positive()
            .describe('Order ID of the parent order that will contain the merged result'),
          child_order_ids: z
            .array(z.number().int().positive())
            .min(1)
            .describe('Array of order IDs to merge into the parent order'),
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ parent_order_id, child_order_ids }) => {
      try {
        const result = await apiRequest<{ order?: Order; success?: boolean }>(
          'orders/merge',
          'POST',
          { parent_order_id, child_order_ids },
        );

        const merged = result.order;
        const text = merged
          ? `Orders merged successfully.\n\n**Parent Order ID:** ${merged.order_id}\n**Order Number:** ${merged.order_number}\n**Child orders merged:** ${child_order_ids.join(', ')}`
          : `Merge of orders ${child_order_ids.join(', ')} into parent ${parent_order_id} submitted.`;

        return toolResult(text, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 17. starshipit_get_suggested_merges ─────────────────────────────────────

  server.registerTool(
    'starshipit_get_suggested_merges',
    {
      title: 'Get Suggested Merges',
      description: `Get a list of orders that StarShipIt suggests can be merged — typically orders from the same customer with the same destination address. Use this before calling \`starshipit_merge_orders\` to identify candidates.

**When to use:** Run this during order processing to find consolidation opportunities that reduce shipping costs and packaging.

**Parameters:**
- \`limit\` (optional, default 50, max 250) — Number of result groups per page
- \`page\` (optional, default 1) — Page number
- \`response_format\` — \`"markdown"\` (default) or \`"json"\`

**Returns:** List of mergeable order groups. Each group identifies a suggested parent order and associated child orders. Includes \`has_more\` flag.

**Errors:** 401 if API keys invalid.`,
      inputSchema: z
        .object({
          limit: PaginationSchema.shape.limit,
          page: PaginationSchema.shape.page,
          response_format: ResponseFormatSchema,
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ limit, page, response_format }) => {
      try {
        // The API may return groups of mergeable orders or a flat list
        const result = await apiRequest<{
          orders?: unknown[];
          total?: number;
          has_more?: boolean;
        }>('orders/mergeable', 'GET', undefined, { limit, page });

        const has_more = result.has_more ?? false;

        let text: string;
        if (response_format === ResponseFormat.JSON) {
          text = JSON.stringify(
            { orders: result.orders, total: result.total, has_more, page },
            null,
            2,
          );
        } else {
          const groups = result.orders ?? [];
          if (groups.length === 0) {
            text = '## Suggested Merges\n\nNo merge candidates found.';
          } else {
            const lines: string[] = ['## Suggested Merges\n'];
            if (result.total !== undefined) lines.push(`**Total groups:** ${result.total}`);
            if (has_more) {
              lines.push('> More results available — increase `page` to continue.');
            }
            lines.push('');

            for (const group of groups) {
              const g = group as Record<string, unknown>;
              if (g['parent'] !== undefined && g['children'] !== undefined) {
                // Grouped response: { parent: Order, children: Order[] }
                const parent = g['parent'] as Order;
                const children = g['children'] as Order[];
                lines.push(
                  `### Group: Parent Order ${parent.order_id} (${parent.order_number})`,
                );
                lines.push(`- **Parent:** ${parent.order_number} (ID: ${parent.order_id})`);
                for (const child of children) {
                  lines.push(`- **Child:** ${child.order_number} (ID: ${child.order_id})`);
                }
              } else {
                // Flat order response
                const o = group as Order;
                lines.push(`- Order ${o.order_number} (ID: ${o.order_id})`);
              }
              lines.push('');
            }
            text = lines.join('\n');
          }
        }

        return toolResult(text, result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );

  // ── 18. starshipit_assign_orders ────────────────────────────────────────────

  server.registerTool(
    'starshipit_assign_orders',
    {
      title: 'Assign Orders',
      description: `Reassign orders between StarShipIt accounts using API keys. Use this to move orders from one StarShipIt sub-account or warehouse account to another.

**When to use:** Use in multi-account or multi-warehouse setups where orders need to be routed to a specific fulfilment account after initial import.

**Parameters:**
- \`orders\` (required) — Array of assignment instructions, each containing:
  - \`order_id\` (required) — The order ID to reassign
  - \`current_api_key\` (required) — API key of the account currently holding the order
  - \`new_api_key\` (required) — API key of the destination account

**Returns:** Confirmation of how many orders were reassigned.

**Errors:** 400 if any entry is malformed; 401 if any API key is invalid; 403 if you lack permission to access the source or destination account; 404 if any order not found.`,
      inputSchema: z
        .object({
          orders: z
            .array(
              z
                .object({
                  order_id: z
                    .number()
                    .int()
                    .positive()
                    .describe('StarShipIt internal order ID to reassign'),
                  current_api_key: z
                    .string()
                    .min(1)
                    .describe('API key of the account currently holding the order'),
                  new_api_key: z
                    .string()
                    .min(1)
                    .describe('API key of the destination account to reassign the order to'),
                })
                .strict(),
            )
            .min(1)
            .describe('Array of order assignment instructions'),
        })
        .strict(),
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ orders }) => {
      try {
        const result = await apiRequest<{
          success?: boolean;
          assigned_count?: number;
          errors?: unknown;
        }>('orders/assign', 'POST', { orders });

        const count = result.assigned_count ?? orders.length;
        const lines = [`**Assignment complete.** ${count} order(s) reassigned.`];

        if (result.errors) {
          lines.push(
            `\n**Errors:**\n\`\`\`json\n${JSON.stringify(result.errors, null, 2)}\n\`\`\``,
          );
        }

        return toolResult(lines.join('\n'), result);
      } catch (err) {
        return toolError(handleApiError(err));
      }
    },
  );
}
