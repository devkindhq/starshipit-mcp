import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, handleApiError } from '../services/api-client.js';
import { ResponseFormat, ResponseFormatSchema, PaginationSchema, truncateIfNeeded } from '../schemas/common.js';
import type { Manifest } from '../types.js';
import { CHARACTER_LIMIT } from '../constants.js';

// ---------------------------------------------------------------------------
// Response shapes returned by the StarShipIt manifests endpoints
// ---------------------------------------------------------------------------

interface ManifestFile {
  manifest_id?: number;
  file_url?: string;
  created_date?: string;
  carrier?: string;
}

interface ListManifestsResponse {
  manifests?: Manifest[];
  total?: number;
  page?: number;
  limit?: number;
  success?: boolean;
}

interface GetManifestFilesResponse {
  files?: ManifestFile[];
  total?: number;
  page?: number;
  limit?: number;
  success?: boolean;
}

interface ManifestByTrackingResponse {
  manifest_id?: number;
  success?: boolean;
  errors?: unknown;
  message?: string;
}

interface ManifestByCarrierResponse {
  manifest_id?: number;
  success?: boolean;
  errors?: unknown;
  message?: string;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatManifestList(data: ListManifestsResponse, format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(data, null, 2);
  }

  const manifests = data.manifests ?? [];
  if (manifests.length === 0) {
    return 'No manifests found.';
  }

  const lines: string[] = [
    `## Manifests (page ${data.page ?? 1}, showing ${manifests.length} of ${data.total ?? manifests.length})`,
    '',
  ];

  for (const m of manifests) {
    lines.push(`### Manifest ${m.manifest_id ?? 'N/A'}`);
    if (m.carrier) lines.push(`- **Carrier:** ${m.carrier}`);
    if (m.created_date) lines.push(`- **Created:** ${m.created_date}`);
    if (m.tracking_numbers && m.tracking_numbers.length > 0) {
      lines.push(`- **Shipments:** ${m.tracking_numbers.length} tracking number(s)`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatManifestFiles(data: GetManifestFilesResponse, format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(data, null, 2);
  }

  const files = data.files ?? [];
  if (files.length === 0) {
    return 'No manifest files found.';
  }

  const lines: string[] = [
    `## Manifest Files (page ${data.page ?? 1}, showing ${files.length} of ${data.total ?? files.length})`,
    '',
  ];

  for (const f of files) {
    lines.push(`### Manifest ${f.manifest_id ?? 'N/A'}`);
    if (f.carrier) lines.push(`- **Carrier:** ${f.carrier}`);
    if (f.created_date) lines.push(`- **Created:** ${f.created_date}`);
    if (f.file_url) lines.push(`- **Download URL:** ${f.file_url}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatManifestResult(
  data: ManifestByTrackingResponse | ManifestByCarrierResponse,
  format: ResponseFormat,
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(data, null, 2);
  }

  const lines: string[] = ['## Manifest Result', ''];

  if (data.success === false) {
    lines.push('**Status:** Failed');
    if (data.message) lines.push(`**Message:** ${data.message}`);
    if (data.errors) lines.push(`**Errors:** ${JSON.stringify(data.errors, null, 2)}`);
  } else {
    lines.push('**Status:** Success');
    if (data.manifest_id !== undefined) {
      lines.push(`**Manifest ID:** ${data.manifest_id}`);
    }
    if (data.message) lines.push(`**Message:** ${data.message}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerManifestTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // 1. starshipit_list_manifests
  // -------------------------------------------------------------------------
  server.registerTool(
    'starshipit_list_manifests',
    {
      title: 'List Manifests',
      description: `List all manifests in your StarShipIt account.

Manifests group shipments that have been closed/submitted to a carrier. A manifest is created when you "manifest" a set of shipments, signalling to the carrier that they are ready for collection.

**Returns:** Manifest ID, carrier name, created date, and the tracking numbers included in each manifest.

**Example response fields:**
- \`manifest_id\`: Unique identifier for the manifest
- \`carrier\`: The carrier the manifest was submitted to (e.g. "AusPost", "DHL")
- \`created_date\`: ISO 8601 timestamp of when the manifest was created
- \`tracking_numbers\`: Array of tracking numbers included in this manifest

**Pagination:** Use \`limit\` (max 250) and \`page\` to page through results.

**Error cases:**
- 401/403: Invalid or missing API credentials

**Use this tool when:**
- Reviewing past manifests for a carrier
- Looking up a manifest ID before downloading its PDF
- Auditing which shipments have been submitted to carriers`,
      inputSchema: z.object({
        limit: PaginationSchema.shape.limit,
        page: PaginationSchema.shape.page,
        response_format: ResponseFormatSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ limit, page, response_format }) => {
      try {
        const data = await apiRequest<ListManifestsResponse>('manifests', 'GET', undefined, {
          limit,
          page,
        });

        const formatted = formatManifestList(data, response_format ?? ResponseFormat.MARKDOWN);
        return {
          content: [{ type: 'text', text: truncateIfNeeded(formatted, CHARACTER_LIMIT) }],
        };
      } catch (error: unknown) {
        return { content: [{ type: 'text', text: handleApiError(error) }], isError: true };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 2. starshipit_get_manifest_files
  // -------------------------------------------------------------------------
  server.registerTool(
    'starshipit_get_manifest_files',
    {
      title: 'Get Manifest Files',
      description: `Retrieve manifest file URLs for downloading manifest documents (PDFs, etc.).

Each manifest can have one or more associated document files (typically a PDF) that you submit to the carrier at pickup. This tool returns the download URLs for those files.

**Query parameters:**
- \`manifest_id\` (optional): Filter to files for a specific manifest. Omit to list files across all manifests.
- \`limit\`: Max results per page (default 50, max 250)
- \`page\`: Page number (default 1)

**Returns:**
- \`manifest_id\`: The manifest this file belongs to
- \`file_url\`: Direct URL to download the manifest document
- \`carrier\`: Carrier the manifest was submitted to
- \`created_date\`: When the manifest was created

**Error cases:**
- 404: Manifest ID not found
- 401/403: Invalid or missing API credentials

**Use this tool when:**
- Downloading a manifest PDF to hand to a carrier driver
- Retrieving document URLs for a specific manifest ID
- Listing all available manifest documents`,
      inputSchema: z.object({
        manifest_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            'Filter by a specific manifest ID — omit to return files for all manifests',
          ),
        limit: PaginationSchema.shape.limit,
        page: PaginationSchema.shape.page,
        response_format: ResponseFormatSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ manifest_id, limit, page, response_format }) => {
      try {
        const data = await apiRequest<GetManifestFilesResponse>(
          'manifests/files/',
          'GET',
          undefined,
          { manifest_id, limit, page },
        );

        const formatted = formatManifestFiles(data, response_format ?? ResponseFormat.MARKDOWN);
        return {
          content: [{ type: 'text', text: truncateIfNeeded(formatted, CHARACTER_LIMIT) }],
        };
      } catch (error: unknown) {
        return { content: [{ type: 'text', text: handleApiError(error) }], isError: true };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 3. starshipit_manifest_by_tracking
  // -------------------------------------------------------------------------
  server.registerTool(
    'starshipit_manifest_by_tracking',
    {
      title: 'Manifest Shipments by Tracking Number',
      description: `Manifest (close/submit) specific shipments to the carrier by their tracking numbers or order numbers.

This closes the selected shipments and submits them to the carrier, creating a manifest document. After manifesting, shipments are locked and can no longer be edited.

**Body parameters:**
- \`tracking_numbers\` (required): Array of tracking numbers to manifest. Must not be empty.
- \`use_order_numbers\` (optional): Set to \`true\` if the values in \`tracking_numbers\` are actually order numbers rather than carrier tracking numbers. Default: \`false\`.

**Returns:**
- \`manifest_id\`: The ID of the newly created manifest
- \`success\`: Whether the manifest was created successfully
- \`errors\`: Any per-shipment errors (e.g. shipment already manifested)

**Error cases:**
- 400: Invalid or unrecognised tracking/order numbers
- 409: One or more shipments already manifested
- 422: Request body validation failure

**Use this tool when:**
- Closing a specific set of shipments for carrier pickup
- You have a list of tracking numbers ready to hand to the carrier
- You want to manifest a subset of shipments rather than all shipments for a carrier`,
      inputSchema: z.object({
        tracking_numbers: z
          .array(z.string().min(1))
          .min(1)
          .describe(
            'Array of tracking numbers (or order numbers if use_order_numbers=true) to manifest. Must contain at least one value.',
          ),
        use_order_numbers: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'Set to true if the values in tracking_numbers are order numbers rather than carrier tracking numbers (default: false)',
          ),
        response_format: ResponseFormatSchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ tracking_numbers, use_order_numbers, response_format }) => {
      try {
        const body: { tracking_numbers: string[]; use_order_numbers?: boolean } = {
          tracking_numbers,
        };
        if (use_order_numbers) body.use_order_numbers = use_order_numbers;

        const data = await apiRequest<ManifestByTrackingResponse>(
          'manifests/shipments',
          'POST',
          body,
        );

        const formatted = formatManifestResult(data, response_format ?? ResponseFormat.MARKDOWN);
        return {
          content: [{ type: 'text', text: truncateIfNeeded(formatted, CHARACTER_LIMIT) }],
        };
      } catch (error: unknown) {
        return { content: [{ type: 'text', text: handleApiError(error) }], isError: true };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 4. starshipit_manifest_by_carrier
  // -------------------------------------------------------------------------
  server.registerTool(
    'starshipit_manifest_by_carrier',
    {
      title: 'Manifest All Shipments by Carrier',
      description: `Manifest ALL unmanifested shipments for a specific carrier in one operation.

This is a bulk operation that closes every shipment that is ready-to-manifest for the given carrier and creates a single manifest document for them. Use this at end-of-day or before carrier pickup when you want to submit everything at once.

**Body parameters:**
- \`carrier\` (required): The carrier identifier string. Common values:
  - \`"AusPost"\` — Australia Post
  - \`"PlainLabel"\` — Generic/plain label carrier
  - \`"DHL"\` — DHL Express
  - \`"StarTrack"\` — StarTrack
  - \`"Fastway"\` — Fastway / Aramex
  Check your StarShipIt account carrier settings for the exact identifier strings available.

**Returns:**
- \`manifest_id\`: The ID of the newly created manifest
- \`success\`: Whether the manifest was created successfully
- \`errors\`: Any errors encountered during manifesting

**Error cases:**
- 400: Invalid or unrecognised carrier name
- 404: No unmanifested shipments found for this carrier
- 409: Conflict — may already be manifested

**Use this tool when:**
- Performing an end-of-day manifest run for a specific carrier
- You want to submit ALL pending shipments for a carrier at once rather than selecting individually`,
      inputSchema: z.object({
        carrier: z
          .string()
          .min(1)
          .describe(
            'Carrier identifier (e.g. "AusPost", "PlainLabel", "DHL", "StarTrack", "Fastway"). Must match the carrier name as configured in StarShipIt.',
          ),
        response_format: ResponseFormatSchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ carrier, response_format }) => {
      try {
        const data = await apiRequest<ManifestByCarrierResponse>('manifests/carrier', 'POST', {
          carrier,
        });

        const formatted = formatManifestResult(data, response_format ?? ResponseFormat.MARKDOWN);
        return {
          content: [{ type: 'text', text: truncateIfNeeded(formatted, CHARACTER_LIMIT) }],
        };
      } catch (error: unknown) {
        return { content: [{ type: 'text', text: handleApiError(error) }], isError: true };
      }
    },
  );
}
