import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, handleApiError } from '../services/api-client.js';
import { PackageSchema, truncateIfNeeded } from '../schemas/common.js';
import { CHARACTER_LIMIT } from '../constants.js';

// ── Response shape interfaces ────────────────────────────────────────────────

interface LabelEntry {
  order_id?: number;
  tracking_number?: string;
  label_url?: string;
  label_data?: string;
  carrier?: string;
  carrier_service?: string;
  error?: string;
}

interface PrintLabelResponse {
  success?: boolean;
  labels?: LabelEntry[];
  errors?: string[];
}

interface PrintPackingSlipsResponse {
  success?: boolean;
  pdf_url?: string;
  pdf_data?: string;
  errors?: string[];
}

interface ManifestResponse {
  success?: boolean;
  manifest_id?: number;
  created_date?: string;
  carrier?: string;
  tracking_numbers?: string[];
  errors?: string[];
}

interface ClonedOrder {
  order_id?: number;
  order_number?: string;
  carrier?: string;
  tracking_number?: string;
}

interface CloneShipmentResponse {
  success?: boolean;
  order?: ClonedOrder;
  errors?: string[];
}

interface ReplacedOrder {
  order_id?: number;
  order_number?: string;
  carrier?: string;
  tracking_number?: string;
  label_url?: string;
}

interface ReplaceShipmentResponse {
  success?: boolean;
  order?: ReplacedOrder;
  errors?: string[];
}

// ── Input schemas ─────────────────────────────────────────────────────────────

const PrintLabelSchema = z
  .object({
    order_id: z
      .number()
      .int()
      .positive()
      .describe('The StarShipIt order ID to print a label for'),
    carrier: z
      .string()
      .optional()
      .describe('Carrier code to override the order default (e.g. "AUSPOST", "DHL", "UPS")'),
    carrier_service_code: z
      .string()
      .optional()
      .describe(
        'Carrier service code to override the order default (e.g. "EXPRESS", "PARCEL_POST")',
      ),
    packages: z
      .array(PackageSchema)
      .optional()
      .describe('Package dimensions for the label. weight in kg; height/width/length in metres'),
    reprint: z
      .boolean()
      .optional()
      .describe('Set to true to reprint a previously generated label (default: false)'),
  })
  .strict();

const PrintLabelsSchema = z
  .object({
    order_ids: z
      .array(z.number().int().positive())
      .min(1)
      .describe('Array of StarShipIt order IDs to print labels for'),
    reprint: z
      .boolean()
      .optional()
      .describe('Set to true to reprint previously generated labels (default: false)'),
  })
  .strict();

const PrintPackingSlipsSchema = z
  .object({
    order_ids: z
      .array(z.number().int().positive())
      .min(1)
      .describe('Array of StarShipIt order IDs to generate packing slips for'),
  })
  .strict();

const ManifestShipmentSchema = z
  .object({
    order_ids: z
      .array(z.number().int().positive())
      .min(1)
      .describe(
        'Array of StarShipIt order IDs to manifest. All must have labels already printed.',
      ),
  })
  .strict();

const CloneShipmentSchema = z
  .object({
    order_id: z
      .number()
      .int()
      .positive()
      .describe('The StarShipIt order ID of the shipment to clone'),
    to_return_shipment: z
      .boolean()
      .optional()
      .describe(
        'Set to true to create a return shipment (swaps origin/destination). Default: false',
      ),
  })
  .strict();

const ReplaceShipmentSchema = z
  .object({
    order_id: z
      .number()
      .int()
      .positive()
      .describe(
        'The StarShipIt order ID whose label will be voided and replaced with a new one',
      ),
  })
  .strict();

// ── Tool registration ────────────────────────────────────────────────────────

export function registerShipmentTools(server: McpServer): void {
  // ── 1. starshipit_print_label ──────────────────────────────────────────────
  server.registerTool(
    'starshipit_print_label',
    {
      title: 'Print Shipping Label',
      description: `Print (or reprint) a shipping label for a single order in StarShipIt.

**When to use:** Use this tool when you need to generate a carrier label for one specific order. If you are printing labels for multiple orders at once, prefer \`starshipit_print_labels\` for efficiency.

**Parameters:**
- \`order_id\` (required): The numeric StarShipIt order ID to print a label for.
- \`carrier\` (optional): Carrier code to override the order's default carrier (e.g. \`"AUSPOST"\`, \`"DHL"\`).
- \`carrier_service_code\` (optional): Carrier service code to override the order's default service (e.g. \`"EXPRESS"\`, \`"PARCEL_POST"\`).
- \`packages\` (optional): Array of package dimensions/weights to use for the label. Each package has \`weight\` (kg, required), and optional \`height\`, \`width\`, \`length\` (all in metres).
- \`reprint\` (optional): Set to \`true\` to reprint a previously generated label. Defaults to \`false\`.

**Returns:** An object containing label URLs or base64-encoded label data for the order, along with the assigned tracking number, carrier, and service. On error, returns a descriptive error message.

**Example success response:**
\`\`\`json
{
  "success": true,
  "labels": [
    {
      "order_id": 12345,
      "tracking_number": "1Z999AA10123456784",
      "label_url": "https://cdn.starshipit.com/labels/label-12345.pdf",
      "carrier": "UPS",
      "carrier_service": "EXPRESS"
    }
  ]
}
\`\`\`

**Error cases:** 400 if the order ID is invalid or required order data is missing; 404 if the order does not exist; 409 if a label has already been printed and \`reprint\` is not set to \`true\`.`,
      inputSchema: PrintLabelSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ order_id, carrier, carrier_service_code, packages, reprint }) => {
      try {
        const body: Record<string, unknown> = { order_id };
        if (carrier !== undefined) body.carrier = carrier;
        if (carrier_service_code !== undefined)
          body.carrier_service_code = carrier_service_code;
        if (packages !== undefined) body.packages = packages;
        if (reprint !== undefined) body.reprint = reprint;

        const result = await apiRequest<PrintLabelResponse>(
          'orders/shipment',
          'POST',
          body,
        );

        const text = truncateIfNeeded(JSON.stringify(result, null, 2), CHARACTER_LIMIT);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleApiError(error) }], isError: true };
      }
    },
  );

  // ── 2. starshipit_print_labels ─────────────────────────────────────────────
  server.registerTool(
    'starshipit_print_labels',
    {
      title: 'Print Shipping Labels (Bulk)',
      description: `Print shipping labels for multiple orders at once in StarShipIt.

**When to use:** Use this tool when you need to generate carrier labels for two or more orders in a single API call. For a single order, \`starshipit_print_label\` gives more control (carrier override, package dimensions).

**Parameters:**
- \`order_ids\` (required): Array of numeric StarShipIt order IDs to print labels for. Must contain at least one ID.
- \`reprint\` (optional): Set to \`true\` to reprint previously generated labels for the specified orders. Defaults to \`false\`.

**Returns:** An array of label results — one entry per order — each containing the label URL or base64-encoded label data, the assigned tracking number, carrier, and service. Individual orders that fail will include an \`error\` field while others may succeed.

**Example success response:**
\`\`\`json
{
  "success": true,
  "labels": [
    {
      "order_id": 101,
      "tracking_number": "TRACK001",
      "label_url": "https://cdn.starshipit.com/labels/label-101.pdf",
      "carrier": "AUSPOST"
    },
    {
      "order_id": 102,
      "tracking_number": "TRACK002",
      "label_url": "https://cdn.starshipit.com/labels/label-102.pdf",
      "carrier": "AUSPOST"
    }
  ]
}
\`\`\`

**Error cases:** 400 if any order IDs are invalid or missing required order data; 404 if one or more orders do not exist; 409 if labels already exist and \`reprint\` is not \`true\`.`,
      inputSchema: PrintLabelsSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ order_ids, reprint }) => {
      try {
        const body: Record<string, unknown> = { order_ids };
        if (reprint !== undefined) body.reprint = reprint;

        const result = await apiRequest<PrintLabelResponse>(
          'orders/shipments',
          'POST',
          body,
        );

        const text = truncateIfNeeded(JSON.stringify(result, null, 2), CHARACTER_LIMIT);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleApiError(error) }], isError: true };
      }
    },
  );

  // ── 3. starshipit_print_packing_slips ─────────────────────────────────────
  server.registerTool(
    'starshipit_print_packing_slips',
    {
      title: 'Print Packing Slips',
      description: `Generate packing slip documents for one or more orders in StarShipIt.

**When to use:** Use this tool when warehouse staff need packing slips to pick, pack, and verify order contents before shipment. Packing slips do not require a label to have been printed first.

**Parameters:**
- \`order_ids\` (required): Array of numeric StarShipIt order IDs to generate packing slips for. Must contain at least one ID.

**Returns:** A URL or base64-encoded PDF containing the packing slips for all specified orders. Multiple orders are typically combined into a single PDF document.

**Example success response:**
\`\`\`json
{
  "success": true,
  "pdf_url": "https://cdn.starshipit.com/packingslips/slips-20240101.pdf"
}
\`\`\`

**Error cases:** 400 if order IDs are missing or invalid; 404 if one or more specified orders do not exist.`,
      inputSchema: PrintPackingSlipsSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ order_ids }) => {
      try {
        const result = await apiRequest<PrintPackingSlipsResponse>(
          'orders/packingslips',
          'POST',
          { order_ids },
        );

        const text = truncateIfNeeded(JSON.stringify(result, null, 2), CHARACTER_LIMIT);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleApiError(error) }], isError: true };
      }
    },
  );

  // ── 4. starshipit_manifest_shipment ───────────────────────────────────────
  server.registerTool(
    'starshipit_manifest_shipment',
    {
      title: 'Manifest Shipments',
      description: `Manifest (finalise/close) shipments by order IDs in StarShipIt.

**When to use:** Use this tool to finalise and commit shipments to the carrier. Manifesting is typically done once at end-of-day or when a batch of orders is ready for carrier pickup. Once manifested, shipments cannot be easily reversed — ensure labels are correct before manifesting.

**Important:** This operation is idempotent — manifesting already-manifested orders will not create duplicate manifests.

**Parameters:**
- \`order_ids\` (required): Array of numeric StarShipIt order IDs to include in the manifest. All orders must already have labels printed.

**Returns:** A manifest record containing the manifest ID, creation timestamp, carrier, and list of tracking numbers that were manifested.

**Example success response:**
\`\`\`json
{
  "success": true,
  "manifest_id": 7890,
  "created_date": "2024-01-15T09:30:00Z",
  "carrier": "AUSPOST",
  "tracking_numbers": ["TRACK001", "TRACK002", "TRACK003"]
}
\`\`\`

**Error cases:** 400 if order IDs are invalid or orders do not have labels printed; 404 if orders do not exist; 409 if orders are in an incompatible state for manifesting.`,
      inputSchema: ManifestShipmentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_ids }) => {
      try {
        const result = await apiRequest<ManifestResponse>(
          'orders/manifest',
          'POST',
          { order_ids },
        );

        const text = truncateIfNeeded(JSON.stringify(result, null, 2), CHARACTER_LIMIT);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleApiError(error) }], isError: true };
      }
    },
  );

  // ── 5. starshipit_clone_shipment ───────────────────────────────────────────
  server.registerTool(
    'starshipit_clone_shipment',
    {
      title: 'Clone Shipment',
      description: `Clone an existing shipment in StarShipIt, optionally converting it to a return shipment.

**When to use:** Use this tool to duplicate an existing order — for example, to resend the same goods to the same recipient, or to create a return shipment (pre-paid return label) based on an outbound order. The cloned order is created in a pending/unshipped state and will need a label printed separately.

**Parameters:**
- \`order_id\` (required): The numeric StarShipIt order ID of the source shipment to clone.
- \`to_return_shipment\` (optional): Set to \`true\` to create a return shipment from the original. The origin and destination addresses will be swapped. Defaults to \`false\` (standard clone).

**Returns:** The newly created order record including its new order ID, order number, and carrier details.

**Example success response:**
\`\`\`json
{
  "success": true,
  "order": {
    "order_id": 99999,
    "order_number": "CLONE-12345",
    "carrier": "AUSPOST"
  }
}
\`\`\`

**Error cases:** 400 if the order ID is invalid; 404 if the source order does not exist; 409 if the order cannot be cloned in its current state.`,
      inputSchema: CloneShipmentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ order_id, to_return_shipment }) => {
      try {
        const body: Record<string, unknown> = { order_id };
        if (to_return_shipment !== undefined)
          body.to_return_shipment = to_return_shipment;

        const result = await apiRequest<CloneShipmentResponse>(
          'orders/shipment/clone',
          'POST',
          body,
        );

        const text = truncateIfNeeded(JSON.stringify(result, null, 2), CHARACTER_LIMIT);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleApiError(error) }], isError: true };
      }
    },
  );

  // ── 6. starshipit_replace_shipment ────────────────────────────────────────
  server.registerTool(
    'starshipit_replace_shipment',
    {
      title: 'Replace Shipment',
      description: `Replace an existing shipment in StarShipIt — voids the previous label and creates a new one.

**When to use:** Use this tool when an existing label must be voided and replaced, such as when order details have changed after a label was printed (address correction, weight change, carrier change). This is a destructive operation: the previous label is voided with the carrier.

**Warning:** This action voids the carrier label for the existing shipment. If the package has already been dispatched with that label, do NOT use this tool. Coordinate with the carrier directly in that case.

**Parameters:**
- \`order_id\` (required): The numeric StarShipIt order ID whose shipment label should be voided and replaced.

**Returns:** The updated order record including the new label URL, new tracking number, carrier, and service details.

**Example success response:**
\`\`\`json
{
  "success": true,
  "order": {
    "order_id": 12345,
    "order_number": "ORD-12345",
    "carrier": "DHL",
    "tracking_number": "NEWTRACK001",
    "label_url": "https://cdn.starshipit.com/labels/label-12345-v2.pdf"
  }
}
\`\`\`

**Error cases:** 400 if the order ID is invalid; 404 if the order does not exist; 409 if the order is manifested or already dispatched and cannot be replaced.`,
      inputSchema: ReplaceShipmentSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ order_id }) => {
      try {
        const result = await apiRequest<ReplaceShipmentResponse>(
          'orders/shipment/replace',
          'POST',
          { order_id },
        );

        const text = truncateIfNeeded(JSON.stringify(result, null, 2), CHARACTER_LIMIT);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: handleApiError(error) }], isError: true };
      }
    },
  );
}
