import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, handleApiError } from '../services/api-client.js';
import {
  ResponseFormat,
  ResponseFormatSchema,
  truncateIfNeeded,
  ApiResultSchema,
  toStructured,
} from '../schemas/common.js';
import { CHARACTER_LIMIT } from '../constants.js';

// ── Response shape interfaces ────────────────────────────────────────────────

interface TrackingEvent {
  event_datetime?: string;
  status?: string;
  details?: string;
}

interface TrackingResult {
  order_number?: string;
  order_status?: string;
  carrier_name?: string;
  carrier_service?: string;
  tracking_number?: string;
  tracking_url?: string;
  shipment_date?: string;
  tracking_status?: string;
  last_updated_date?: string;
  tracking_events?: TrackingEvent[];
}

interface TrackingResponse {
  success?: boolean;
  results?: TrackingResult;
  errors?: string[];
}

interface TrackingOrderEntry {
  name?: string;
  order_number?: string;
  carrier: string;
  tracking_number: string;
}

interface CreateTrackingOrderResponse {
  success?: boolean;
  /** Order ID → tracking number. */
  orders?: Record<string, string>;
  errors?: string[];
}

// ── Formatting helpers ───────────────────────────────────────────────────────

function formatTrackingMarkdown(data: TrackingResponse): string {
  const r = data.results;
  if (!r) {
    if (data.errors && data.errors.length > 0) {
      return `Error: ${data.errors.join('; ')}`;
    }
    return 'No tracking data returned.';
  }

  const lines: string[] = [];

  lines.push(`## Tracking: ${r.tracking_number ?? 'Unknown'}`);
  lines.push('');
  lines.push(`**Status:** ${r.tracking_status ?? 'Unknown'}`);

  if (r.order_number) lines.push(`**Order:** ${r.order_number} (${r.order_status ?? 'unknown status'})`);
  if (r.carrier_name) lines.push(`**Carrier:** ${r.carrier_name}`);
  if (r.carrier_service) lines.push(`**Service:** ${r.carrier_service}`);
  if (r.shipment_date) lines.push(`**Shipped:** ${r.shipment_date}`);
  if (r.last_updated_date) lines.push(`**Last Updated:** ${r.last_updated_date}`);
  if (r.tracking_url) lines.push(`**Tracking URL:** ${r.tracking_url}`);

  if (r.tracking_events && r.tracking_events.length > 0) {
    lines.push('');
    lines.push('### Tracking Events');
    lines.push('');
    for (const event of r.tracking_events) {
      const status = event.status ? ` — ${event.status}` : '';
      lines.push(`- **${event.event_datetime ?? ''}${status}:** ${event.details ?? '(no details)'}`);
    }
  }

  return lines.join('\n');
}

// ── Input schemas ─────────────────────────────────────────────────────────────

const TrackShipmentSchema = z
  .object({
    tracking_number: z
      .string()
      .min(1)
      .describe('The carrier tracking number to look up'),
    response_format: ResponseFormatSchema.optional(),
  })
  .strict();

const TrackingOrderItemSchema = z
  .object({
    name: z
      .string()
      .optional()
      .describe(
        'Recipient or customer name for the shipment. Recommended if order_number is not provided.',
      ),
    order_number: z
      .string()
      .optional()
      .describe(
        'Your internal order or reference number. Recommended if name is not provided.',
      ),
    carrier: z
      .string()
      .min(1)
      .describe('Carrier code for the shipment (e.g. "AUSPOST", "DHL", "UPS")'),
    tracking_number: z.string().min(1).describe('The carrier-assigned tracking number'),
  })
  .strict()
  .refine(
    (entry) => entry.name !== undefined || entry.order_number !== undefined,
    {
      message:
        'Each order entry should provide at least one of "name" or "order_number" for identification',
    },
  );

const CreateTrackingOrderSchema = z
  .object({
    orders: z
      .array(TrackingOrderItemSchema)
      .min(1)
      .describe(
        'Array of tracking orders to create. Each must have carrier and tracking_number; supply name or order_number for identification.',
      ),
  })
  .strict();

// ── Tool registration ────────────────────────────────────────────────────────

export function registerTrackingTools(server: McpServer): void {
  // ── 1. starshipit_track_shipment ──────────────────────────────────────────
  server.registerTool(
    'starshipit_track_shipment',
    {
      title: 'Track Shipment',
      description: `Track a shipment by tracking number using StarShipIt.

**When to use:** Use this tool to retrieve the current status, tracking events and carrier details for any shipment tracked through StarShipIt. This works for shipments created in StarShipIt as well as tracking-only orders imported via \`starshipit_create_tracking_order\`.

**Parameters:**
- \`tracking_number\` (required): The carrier tracking number to look up (e.g. \`"1Z999AA10123456784"\`).
- \`response_format\` (optional): Output format — \`"markdown"\` (default) for a human-readable summary with formatted tracking events, or \`"json"\` for the raw API response suitable for programmatic use.

**Returns:** Tracking status, order number and status, carrier name, service, shipment date, last update, carrier tracking URL, and a list of tracking events (date, status, details).

**Example success response (markdown format):**
\`\`\`
## Tracking: 2XD198209601000935102

**Status:** In Transit
**Order:** C12346 (Shipped)
**Carrier:** Australia Post
**Service:** 7B05
**Shipped:** 2024-04-17T12:52:05
**Tracking URL:** https://auspost.com.au/mypost/track/details/2XD198209601000935102

### Tracking Events

- **2024-04-17T13:20:18 — In Transit:** Item processed at facility
\`\`\`

**Error cases:** 404 if the tracking number is not found in StarShipIt; 400 if the tracking number format is invalid.`,
      inputSchema: TrackShipmentSchema,
      outputSchema: ApiResultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ tracking_number, response_format }) => {
      try {
        const result = await apiRequest<TrackingResponse>(
          'track',
          'GET',
          undefined,
          { tracking_number },
        );

        const format = response_format ?? ResponseFormat.MARKDOWN;
        let text: string;

        if (format === ResponseFormat.JSON) {
          text = JSON.stringify(result, null, 2);
        } else {
          text = formatTrackingMarkdown(result);
        }

        text = truncateIfNeeded(text, CHARACTER_LIMIT);
        return { content: [{ type: 'text' as const, text }], structuredContent: toStructured(result) };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleApiError(error) }], isError: true };
      }
    },
  );

  // ── 2. starshipit_create_tracking_order ───────────────────────────────────
  server.registerTool(
    'starshipit_create_tracking_order',
    {
      title: 'Create Tracking Order',
      description: `Create tracking-only orders in StarShipIt for shipments dispatched outside the platform.

**When to use:** Use this tool when you have shipments that were booked or dispatched through a carrier directly (not via StarShipIt) and you want to import them into StarShipIt to enable centralised tracking, notifications, and reporting. At least one of \`name\` or \`order_number\` should be provided per order entry.

**Parameters:**
- \`orders\` (required): Array of tracking order objects to create. Each object requires:
  - \`carrier\` (required): Carrier code for the shipment (e.g. \`"AUSPOST"\`, \`"DHL"\`, \`"UPS"\`).
  - \`tracking_number\` (required): The carrier-assigned tracking number (e.g. \`"1Z999AA10123456784"\`).
  - \`name\` (optional but recommended): Recipient or customer name associated with the shipment.
  - \`order_number\` (optional but recommended): Your internal order/reference number.

**Note:** At least one of \`name\` or \`order_number\` must be supplied per entry to make tracking orders identifiable in the StarShipIt dashboard.

**Returns:** An array of created order records, each with the new StarShipIt order ID, order number, tracking number, and carrier. Individual entries that fail will include an \`error\` field.

**Example success response:**
\`\`\`json
{
  "success": true,
  "orders": [
    {
      "order_id": 55001,
      "order_number": "ORD-9901",
      "tracking_number": "1Z999AA10123456784",
      "carrier": "UPS"
    },
    {
      "order_id": 55002,
      "order_number": "ORD-9902",
      "tracking_number": "EJ123456789AU",
      "carrier": "AUSPOST"
    }
  ]
}
\`\`\`

**Error cases:** 400 if carrier or tracking_number is missing for any entry; 409 if a tracking number already exists in the platform.`,
      inputSchema: CreateTrackingOrderSchema,
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
        const payload: { orders: TrackingOrderEntry[] } = {
          orders: orders.map((o) => {
            const entry: TrackingOrderEntry = {
              carrier: o.carrier,
              tracking_number: o.tracking_number,
            };
            if (o.name !== undefined) entry.name = o.name;
            if (o.order_number !== undefined) entry.order_number = o.order_number;
            return entry;
          }),
        };

        const result = await apiRequest<CreateTrackingOrderResponse>(
          'orders/shipped',
          'POST',
          payload,
        );

        const text = truncateIfNeeded(JSON.stringify(result, null, 2), CHARACTER_LIMIT);
        return { content: [{ type: 'text' as const, text }], structuredContent: toStructured(result) };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleApiError(error) }], isError: true };
      }
    },
  );
}
