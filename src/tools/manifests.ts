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
  file_name?: string;
  /** Base64 file content. */
  file_data?: string;
}

interface ListManifestsResponse {
  manifests?: Manifest[];
  total_count?: number;
  total_pages?: number;
  success?: boolean;
}

interface GetManifestFilesResponse {
  files?: ManifestFile[];
  success?: boolean;
}

interface ManifestByTrackingResponse {
  file_name?: string;
  /** Base64 manifest PDF. */
  pdf?: string;
  success?: boolean;
  errors?: unknown;
  message?: string;
}

interface ManifestByCarrierResponse {
  records_manifested?: number;
  success?: boolean;
  errors?: unknown;
  message?: string;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatManifestList(data: ListManifestsResponse, format: ResponseFormat, page: number): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(data, null, 2);
  }

  const manifests = data.manifests ?? [];
  if (manifests.length === 0) {
    return 'No manifests found.';
  }

  const lines: string[] = [
    `## Manifests (page ${page}, showing ${manifests.length} of ${data.total_count ?? manifests.length})`,
    '',
  ];

  for (const m of manifests) {
    lines.push(`### Manifest ${m.id ?? 'N/A'}${m.name ? ` — ${m.name}` : ''}`);
    if (m.date) lines.push(`- **Date:** ${m.date}`);
    if (m.carrierId !== undefined) lines.push(`- **Carrier ID:** ${m.carrierId}`);
    if (m.numberConsignments !== undefined) lines.push(`- **Consignments:** ${m.numberConsignments}`);
    if (m.numberArticles !== undefined) lines.push(`- **Articles:** ${m.numberArticles}`);
    lines.push('');
  }

  return lines.join('\n');
}

function formatManifestFiles(data: GetManifestFilesResponse, format: ResponseFormat, page: number): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(data, null, 2);
  }

  const files = data.files ?? [];
  if (files.length === 0) {
    return 'No manifest files found.';
  }

  const lines: string[] = [
    `## Manifest Files (page ${page}, ${files.length} file${files.length === 1 ? '' : 's'})`,
    '',
  ];

  for (const f of files) {
    lines.push(`### ${f.file_name ?? '(unnamed file)'}`);
    if (f.file_data) {
      const bytes = Math.round((f.file_data.length * 3) / 4);
      const size = bytes < 1024 ? `${bytes} bytes` : `~${Math.round(bytes / 1024)} KB`;
      lines.push(`- **Size:** ${size} (base64 content in the JSON format; output over ${CHARACTER_LIMIT} characters is truncated)`);
    }
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
    if ('records_manifested' in data && data.records_manifested !== undefined) {
      lines.push(`**Records manifested:** ${data.records_manifested}`);
    }
    if ('file_name' in data && data.file_name) {
      lines.push(`**Manifest file:** ${data.file_name} (base64 PDF in the JSON format)`);
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

**Returns:** Manifest ID, name, date, carrier ID, and the number of consignments and articles in each manifest.

**Example response fields:**
- \`id\`: Unique identifier for the manifest
- \`name\`: Manifest name
- \`date\`: ISO 8601 timestamp of the manifest
- \`carrierId\`: Numeric carrier ID
- \`numberConsignments\` / \`numberArticles\`: Counts in the manifest
- \`total_count\` / \`total_pages\`: Pagination totals

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

        const formatted = formatManifestList(data, response_format ?? ResponseFormat.MARKDOWN, page ?? 1);
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
      description: `Retrieve manifest documents (PDF, XML, etc.) as base64 file content.

Each manifest can have one or more associated document files that you submit to the carrier at pickup. The markdown format lists file names and sizes; the JSON format includes the base64 content, truncated if the output exceeds 25000 characters.

**Query parameters:**
- \`manifest_id\` (optional): Filter to files for a specific manifest. Omit to list files across all manifests.
- \`limit\`: Max results per page (default 50, max 250)
- \`page\`: Page number (default 1)

**Returns:**
- \`files\`: Array of \`{ file_name, file_data }\`, where \`file_data\` is the base64 file content

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

        const formatted = formatManifestFiles(data, response_format ?? ResponseFormat.MARKDOWN, page ?? 1);
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
- \`file_name\`: Name of the manifest document
- \`pdf\`: Base64 manifest PDF (JSON format only)
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
- \`records_manifested\`: Number of shipments manifested
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
