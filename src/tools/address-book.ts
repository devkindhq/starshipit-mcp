import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, handleApiError } from '../services/api-client.js';
import {
  ResponseFormat,
  ResponseFormatSchema,
  truncateIfNeeded,
} from '../schemas/common.js';
import type { Address } from '../types.js';
import { CHARACTER_LIMIT } from '../constants.js';

// ─── Address schema for address book entries ───────────────────────────────────
//
// NOTE: This differs from AddressSchema in common.ts (which is the recipient schema
// used on orders). The address book schema uses "country" (free-text name or code)
// rather than "country", and adds fields like code, instructions, carrier, and
// signature_required that are specific to saved address entries.

const AddressBookEntrySchema = z.object({
  code: z
    .string()
    .optional()
    .describe('Custom reference code for this address (e.g. "SUPPLIER-001")'),
  name: z.string().min(1).describe('Full name of the contact'),
  company: z.string().optional().describe('Company or organisation name'),
  post_code: z.string().min(1).describe('Postcode / ZIP code'),
  street: z.string().min(1).describe('Street address'),
  suburb: z.string().optional().describe('Suburb'),
  city: z.string().optional().describe('City'),
  state: z.string().optional().describe('State or province code (e.g. "VIC", "NSW")'),
  country: z
    .string()
    .min(1)
    .describe('Country name (e.g. "Australia") or ISO code (e.g. "AU")'),
  phone: z.string().optional().describe('Phone number'),
  instructions: z
    .string()
    .optional()
    .describe('Delivery instructions for the courier (e.g. "Leave at front door")'),
  building: z.string().optional().describe('Building or apartment name/number'),
  email: z.string().email().optional().describe('Email address'),
  carrier: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Preferred carrier ID (0 = no preference)'),
  signature_required: z
    .boolean()
    .optional()
    .describe('Whether a signature is required on delivery'),
});

// ─── Response types ────────────────────────────────────────────────────────────

interface ListAddressesApiResponse {
  addresses?: Address[];
  total_pages?: number;
  total_records?: number;
  success?: boolean;
  errors?: unknown;
}

interface AddressApiResponse {
  address?: Address;
  success?: boolean;
  errors?: unknown;
}

interface DeleteAddressApiResponse {
  success?: boolean;
  errors?: unknown;
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

function formatAddressMarkdown(addr: Address): string {
  const lines: string[] = [];
  if (addr.id !== undefined) lines.push(`**ID:** ${addr.id}`);
  if (addr.code) lines.push(`**Code:** ${addr.code}`);
  lines.push(`**Name:** ${addr.name}`);
  if (addr.company) lines.push(`**Company:** ${addr.company}`);

  const addressParts = [addr.street, addr.suburb, addr.city, addr.state, addr.post_code]
    .filter(Boolean)
    .join(', ');
  lines.push(`**Address:** ${addressParts}, ${addr.country}`);

  if (addr.phone) lines.push(`**Phone:** ${addr.phone}`);
  if (addr.email) lines.push(`**Email:** ${addr.email}`);
  if (addr.instructions) lines.push(`**Instructions:** ${addr.instructions}`);
  if (addr.building) lines.push(`**Building:** ${addr.building}`);
  if (addr.carrier !== undefined) lines.push(`**Carrier:** ${addr.carrier}`);
  if (addr.signature_required !== undefined)
    lines.push(`**Signature Required:** ${addr.signature_required}`);

  return lines.join('\n');
}

function formatAddressListMarkdown(
  addresses: Address[],
  page: number,
  totalRecords?: number,
): string {
  if (addresses.length === 0) {
    return 'No addresses found matching your search criteria.';
  }

  const summary =
    totalRecords !== undefined
      ? `## Address Book (page ${page}, showing ${addresses.length} of ${totalRecords} total)`
      : `## Address Book (page ${page}, ${addresses.length} result${addresses.length === 1 ? '' : 's'})`;

  const entries = addresses
    .map((addr, i) => `### ${i + 1}. ${addr.name}${addr.company ? ` — ${addr.company}` : ''}\n${formatAddressMarkdown(addr)}`)
    .join('\n\n');

  return `${summary}\n\n${entries}`;
}

// ─── Tool registrations ────────────────────────────────────────────────────────

export function registerAddressBookTools(server: McpServer): void {
  // ── 1. starshipit_list_addresses ───────────────────────────────────────────
  server.registerTool(
    'starshipit_list_addresses',
    {
      title: 'List Address Book',
      description: `List saved addresses from the StarShipIt address book, with optional text filtering and pagination.

**When to use:** Use this to:
- Look up an existing contact before creating an order (avoids re-entering addresses)
- Search for a specific company or person's delivery details
- Browse all saved addresses for account management

**Parameters:**
- \`search_term\` (optional) — filters by name, company, street, suburb, city, or postcode; leave blank to list all
- \`limit\` (default 50, max 250) — number of addresses per page
- \`page\` (default 1) — page number for pagination; increase to load more results

**Returns:** An array of address objects, each containing:
- \`id\` — unique address book ID (required for update/delete)
- \`code\`, \`name\`, \`company\`
- Full address: \`street\`, \`suburb\`, \`city\`, \`state\`, \`post_code\`, \`country\`
- Contact info: \`phone\`, \`email\`
- Delivery preferences: \`instructions\`, \`building\`, \`carrier\`, \`signature_required\`

**Pagination:** If \`total_records\` is greater than \`limit × page\`, increment \`page\` to retrieve more results.

**Errors:**
- 401/403 — authentication failure
- Empty result — no addresses match the search term or the address book is empty`,
      inputSchema: z
        .object({
          search_term: z
            .string()
            .optional()
            .describe(
              'Text to search across name, company, street, suburb, city, and postcode fields',
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(250)
            .default(50)
            .describe('Maximum number of addresses to return per page (default: 50, max: 250)'),
          page: z
            .number()
            .int()
            .min(1)
            .default(1)
            .describe('Page number for pagination (default: 1)'),
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
        const params: Record<string, unknown> = {
          limit: args.limit,
          page: args.page,
        };
        if (args.search_term !== undefined && args.search_term !== '') {
          params.search_term = args.search_term;
        }

        const data = await apiRequest<ListAddressesApiResponse>(
          'addressbook/filtered',
          'GET',
          undefined,
          params,
        );

        const addresses: Address[] = data.addresses ?? [];

        let output: string;
        if (args.response_format === ResponseFormat.JSON) {
          output = JSON.stringify(
            {
              addresses,
              count: addresses.length,
              total_records: data.total_records,
              total_pages: data.total_pages,
              page: args.page,
            },
            null,
            2,
          );
        } else {
          output = formatAddressListMarkdown(addresses, args.page, data.total_records);
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

  // ── 2. starshipit_add_address ──────────────────────────────────────────────
  server.registerTool(
    'starshipit_add_address',
    {
      title: 'Add Address to Address Book',
      description: `Add a new address entry to the StarShipIt address book for reuse in future orders.

**When to use:** Use this when a contact's details need to be saved for repeated use — e.g. a frequent supplier, warehouse, or customer. Once saved, addresses can be retrieved via \`starshipit_list_addresses\` and assigned to orders without re-entering details.

**Required fields:**
- \`name\` — full name of the contact
- \`street\` — street address
- \`post_code\` — postcode
- \`country\` — country name (e.g. "Australia") or ISO code (e.g. "AU")

**Optional fields:**
- \`code\` — your custom reference code for quick lookup
- \`company\`, \`suburb\`, \`city\`, \`state\`
- \`phone\`, \`email\`
- \`instructions\` — courier delivery instructions
- \`building\` — building name or apartment number
- \`carrier\` — preferred carrier ID (0 = no preference)
- \`signature_required\` — whether delivery requires a signature

**Returns:** The newly created address object including its assigned \`id\`.

**Errors:**
- 400 — missing required fields (name, street, post_code, country) or validation failure
- 409 — address with the same code may already exist
- 401/403 — authentication failure

**Example:**
\`\`\`json
{
  "address": {
    "code": "MELB-WH",
    "name": "Warehouse Manager",
    "company": "Acme Logistics",
    "street": "55 Bourke St",
    "suburb": "Melbourne",
    "city": "Melbourne",
    "state": "VIC",
    "post_code": "3000",
    "country": "Australia",
    "phone": "0398765432",
    "email": "warehouse@acme.com",
    "signature_required": false
  }
}
\`\`\``,
      inputSchema: z
        .object({
          address: AddressBookEntrySchema.describe('The address details to save'),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const data = await apiRequest<AddressApiResponse>('addressbook/', 'POST', {
          address: args.address,
        });

        const addr = data.address;
        if (!addr) {
          return {
            content: [
              {
                type: 'text',
                text: 'Address created but no address data was returned in the response.',
              },
            ],
          };
        }

        const output = `Address added successfully.\n\n${formatAddressMarkdown(addr)}`;
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

  // ── 3. starshipit_update_address ───────────────────────────────────────────
  server.registerTool(
    'starshipit_update_address',
    {
      title: 'Update Address Book Entry',
      description: `Update an existing address book entry by its ID.

**When to use:** Call this when a saved address needs to be corrected or updated — e.g. a contact has moved, changed phone number, or you need to add delivery instructions. Use \`starshipit_list_addresses\` first to find the correct \`id\`.

**Parameters:**
- \`id\` (required) — the address book entry ID to update (retrieve via \`starshipit_list_addresses\`)
- \`address\` (required) — updated address fields; you should provide all fields, not just the changed ones, as the API replaces the entire entry

**Required fields inside \`address\`:**
- \`name\`, \`street\`, \`post_code\`, \`country\`

**Optional fields inside \`address\`:**
- \`code\`, \`company\`, \`suburb\`, \`city\`, \`state\`
- \`phone\`, \`email\`, \`instructions\`, \`building\`
- \`carrier\`, \`signature_required\`

**Returns:** The updated address object.

**Errors:**
- 400 — validation failure on the address fields
- 404 — no address with the given \`id\` was found
- 401/403 — authentication failure

**Example:**
\`\`\`json
{
  "id": 6926658,
  "address": {
    "name": "Warehouse Manager",
    "company": "Acme Logistics",
    "street": "55 Bourke St",
    "suburb": "Melbourne",
    "state": "VIC",
    "post_code": "3000",
    "country": "Australia",
    "phone": "0398765432",
    "signature_required": true
  }
}
\`\`\``,
      inputSchema: z
        .object({
          id: z
            .number()
            .int()
            .positive()
            .describe('Address book entry ID to update (from starshipit_list_addresses)'),
          address: AddressBookEntrySchema.describe('Replacement address data'),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const data = await apiRequest<AddressApiResponse>('addressbook/update', 'POST', {
          id: args.id,
          address: args.address,
        });

        const addr = data.address;
        if (!addr) {
          return {
            content: [
              {
                type: 'text',
                text: `Address ${args.id} updated successfully (no address data returned).`,
              },
            ],
          };
        }

        const output = `Address ${args.id} updated successfully.\n\n${formatAddressMarkdown(addr)}`;
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

  // ── 4. starshipit_delete_addresses ─────────────────────────────────────────
  server.registerTool(
    'starshipit_delete_addresses',
    {
      title: 'Delete Address Book Entries',
      description: `Delete one or more addresses from the StarShipIt address book by their IDs. This action is permanent and cannot be undone.

**When to use:** Call this to remove outdated, duplicate, or unwanted address entries. You can delete multiple addresses in a single call by passing an array of IDs.

**CAUTION:** Deletion is irreversible. Verify the IDs with \`starshipit_list_addresses\` before calling this tool.

**Parameters:**
- \`address_ids\` — non-empty array of integer address book IDs to delete

**Returns:** A success confirmation. If any ID does not exist, the API may still return success for the IDs that were found.

**Errors:**
- 400 — empty array or invalid ID format
- 401/403 — authentication failure

**Example — delete two addresses:**
\`\`\`json
{ "address_ids": [81692357, 81692358] }
\`\`\`

**Workflow tip:** Always call \`starshipit_list_addresses\` with a search_term first to confirm which IDs you want to delete before proceeding.`,
      inputSchema: z
        .object({
          address_ids: z
            .array(z.number().int().positive())
            .min(1)
            .describe('Array of address book IDs to permanently delete'),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const data = await apiRequest<DeleteAddressApiResponse>('addressbook/delete', 'POST', {
          address_ids: args.address_ids,
        });

        const count = args.address_ids.length;
        const ids = args.address_ids.join(', ');

        if (data.success === false) {
          const errDetail =
            data.errors !== undefined ? ` Details: ${JSON.stringify(data.errors)}` : '';
          return {
            content: [
              {
                type: 'text',
                text: `Delete request failed for address ID(s) [${ids}].${errDetail}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Successfully deleted ${count} address${count === 1 ? '' : 'es'} (ID${count === 1 ? '' : 's'}: ${ids}).`,
            },
          ],
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
