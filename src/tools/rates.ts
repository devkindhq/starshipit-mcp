import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, handleApiError } from '../services/api-client.js';
import {
  ResponseFormat,
  ResponseFormatSchema,
  PackageSchema,
  truncateIfNeeded,
} from '../schemas/common.js';
import type { Rate } from '../types.js';
import { CHARACTER_LIMIT } from '../constants.js';

// ─── Shared schemas ────────────────────────────────────────────────────────────

/**
 * Simplified address shape used exclusively for rate/delivery-service lookups.
 * Unlike the full AddressSchema (which describes a named recipient), this
 * captures only the geographic fields that the carrier needs to calculate a
 * price and transit time.
 */
const RateAddressSchema = z.object({
  street: z.string().min(1).describe('Street address (e.g. "184 Exhibition Street")'),
  suburb: z.string().min(1).describe('Suburb (e.g. "Melbourne")'),
  city: z.string().optional().describe('City — required by some carriers; leave blank if suburb covers it'),
  state: z.string().optional().describe('State or province code (e.g. "VIC", "NSW", "QLD")'),
  post_code: z.string().min(1).describe('Postcode / ZIP code (e.g. "3000")'),
  country_code: z
    .string()
    .length(2)
    .describe('ISO 3166-1 alpha-2 country code (e.g. "AU", "NZ", "US")'),
});

// ─── Response types ────────────────────────────────────────────────────────────

interface RatesApiResponse {
  rates?: Rate[];
  success?: boolean;
  errors?: unknown;
}

interface DeliveryServicesApiResponse {
  services?: Rate[];
  success?: boolean;
  errors?: unknown;
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

function formatRatesMarkdown(rates: Rate[]): string {
  if (rates.length === 0) {
    return 'No rates returned. Check that the addresses and package dimensions are valid.';
  }

  const header = '| Carrier | Service | Price | Transit |\n|---------|---------|-------|---------|';
  const rows = rates.map((r) => {
    const carrier = r.carrier_name ?? r.carrier ?? '—';
    const service = r.service_name ?? r.service_code ?? '—';
    const amount = r.total_price ?? r.price;
    const price = amount !== undefined ? `${r.currency ?? ''} ${amount.toFixed(2)}`.trim() : '—';
    const transit =
      r.estimated_transit_days !== undefined
        ? `${r.estimated_transit_days} day${r.estimated_transit_days === 1 ? '' : 's'}`
        : '—';
    return `| ${carrier} | ${service} | ${price} | ${transit} |`;
  });

  return `## Shipping Rates (${rates.length} option${rates.length === 1 ? '' : 's'})\n\n${header}\n${rows.join('\n')}`;
}

// ─── Tool registrations ────────────────────────────────────────────────────────

export function registerRatesTools(server: McpServer): void {
  // ── 1. starshipit_get_rates ─────────────────────────────────────────────────
  server.registerTool(
    'starshipit_get_rates',
    {
      title: 'Get Shipping Rates',
      description: `Get available shipping rates (quotes) for a shipment between a sender and destination address with the given package dimensions.

**When to use:** Call this before creating an order when you need to compare services by price. It is read-only and safe to call multiple times.

**Required parameters:**
- \`sender\` — pickup/origin address (street, suburb, post_code, country_code are required; city and state are optional but improve accuracy)
- \`destination\` — delivery address (same shape as sender)
- \`packages\` — array of package objects; each must have \`weight\` (kg); \`height\`, \`width\`, \`length\` (all in metres) are optional but recommended for volumetric pricing

**Returns:** An array of rate objects, each with:
- \`service_name\` / \`service_code\` — service description and machine-readable code (use service_code when setting a carrier on an order)
- \`total_price\` — quoted price in the account currency

**Errors:**
- 400 — invalid address or package data (check post_code format and country_code)
- 401/403 — authentication failure; verify API keys
- No rates returned — the origin/destination combination may not be supported by any connected carrier

**Example request body:**
\`\`\`json
{
  "sender": { "street": "184 Exhibition St", "suburb": "Melbourne", "post_code": "3000", "country_code": "AU", "state": "VIC" },
  "destination": { "street": "20 Liverpool St", "suburb": "Paddington", "post_code": "2021", "country_code": "AU", "state": "NSW" },
  "packages": [{ "weight": 0.5, "length": 0.3, "width": 0.2, "height": 0.1 }]
}
\`\`\``,
      inputSchema: z
        .object({
          sender: RateAddressSchema.describe('Origin/pickup address'),
          destination: RateAddressSchema.describe('Delivery address'),
          packages: z
            .array(PackageSchema)
            .min(1)
            .describe('One or more packages to ship; weight (kg) is required per package'),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const body = {
          sender: args.sender,
          destination: args.destination,
          packages: args.packages,
        };

        const data = await apiRequest<RatesApiResponse>('rates', 'POST', body);
        const rates: Rate[] = data.rates ?? [];

        let output: string;
        if (args.response_format === ResponseFormat.JSON) {
          output = JSON.stringify({ rates, count: rates.length }, null, 2);
        } else {
          output = formatRatesMarkdown(rates);
        }

        return {
          content: [{ type: 'text', text: truncateIfNeeded(output, CHARACTER_LIMIT) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: handleApiError(error) }],
          isError: true,
        };
      }
    },
  );

  // ── 2. starshipit_get_delivery_services ─────────────────────────────────────
  server.registerTool(
    'starshipit_get_delivery_services',
    {
      title: 'Get Delivery Services',
      description: `Get available delivery services (carrier + service options) for a specific order or a general route. Returns service codes that are directly usable when creating or updating orders.

**When to use:** Prefer this over \`starshipit_get_rates\` when:
- You have an existing order (\`order_id\`) and need the services available for it
- You want to populate a dropdown or list of services that a user can select (the returned \`service_code\` values map directly to the StarShipIt order field)
- You need a fresh rate lookup — pass \`refresh_rate: true\` to bypass any cached result

**Parameters:**
- \`order_id\` (optional) — existing order ID to fetch services for; if omitted, sender/destination/packages are used
- \`refresh_rate\` (optional, default false) — set \`true\` to force a live carrier rate lookup instead of returning cached data
- \`sender\`, \`destination\`, \`packages\` — same shape as \`starshipit_get_rates\`; required when \`order_id\` is not provided

**Returns:** An array of service objects, each with:
- \`carrier\` / \`carrier_name\` — carrier identifier and display name
- \`service_name\` / \`service_code\` — description and the code to pass to order create/update
- \`total_price\` — quoted price
- \`pricing_breakdown\` — price ex GST, GST, and estimated delivery days (JSON format)

**Errors:**
- 400 — missing required fields or invalid address/package data
- 404 — order_id not found
- 401/403 — authentication failure

**Example — get services for an existing order:**
\`\`\`json
{ "order_id": 100000, "refresh_rate": true }
\`\`\`

**Example — get services for a new route:**
\`\`\`json
{
  "sender": { "street": "10 Geonic Street", "suburb": "Woodridge", "state": "QLD", "post_code": "4114", "country_code": "AU" },
  "destination": { "street": "10 Geoffrey Place", "suburb": "Mangere East", "city": "Auckland", "post_code": "2024", "country_code": "NZ" },
  "packages": [{ "weight": 1.2 }]
}
\`\`\``,
      inputSchema: z
        .object({
          order_id: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Existing StarShipIt order ID to fetch delivery services for'),
          refresh_rate: z
            .boolean()
            .optional()
            .describe('Set true to force a fresh rate lookup (bypass cache)'),
          sender: RateAddressSchema.optional().describe(
            'Origin/pickup address — required when order_id is not provided',
          ),
          destination: RateAddressSchema.optional().describe(
            'Delivery address — required when order_id is not provided',
          ),
          packages: z
            .array(PackageSchema)
            .min(1)
            .optional()
            .describe(
              'Packages to ship — required when order_id is not provided; weight (kg) is required per package',
            ),
          response_format: ResponseFormatSchema,
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const body: Record<string, unknown> = {};
        if (args.order_id !== undefined) body.order_id = args.order_id;
        if (args.refresh_rate !== undefined) body.refresh_rate = args.refresh_rate;
        if (args.sender !== undefined) body.sender = args.sender;
        if (args.destination !== undefined) body.destination = args.destination;
        if (args.packages !== undefined) body.packages = args.packages;

        const data = await apiRequest<DeliveryServicesApiResponse>(
          'deliveryservices',
          'POST',
          body,
        );
        const services: Rate[] = data.services ?? [];

        let output: string;
        if (args.response_format === ResponseFormat.JSON) {
          output = JSON.stringify({ services, count: services.length }, null, 2);
        } else {
          output = formatRatesMarkdown(services).replace(
            '## Shipping Rates',
            '## Delivery Services',
          );
        }

        return {
          content: [{ type: 'text', text: truncateIfNeeded(output, CHARACTER_LIMIT) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: handleApiError(error) }],
          isError: true,
        };
      }
    },
  );
}
