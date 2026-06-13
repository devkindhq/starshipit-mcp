import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, handleApiError } from '../services/api-client.js';
import { ResponseFormat, ResponseFormatSchema, truncateIfNeeded } from '../schemas/common.js';
import type { Product } from '../types.js';
import { CHARACTER_LIMIT } from '../constants.js';

// ---------------------------------------------------------------------------
// Shared product field schema (reused for add and update)
// ---------------------------------------------------------------------------

const ProductFieldsSchema = z.object({
  sku: z.string().min(1).describe('Stock Keeping Unit — unique product identifier (required)'),
  title: z.string().min(1).describe('Product title / name (required)'),
  customs_description: z
    .string()
    .nullable()
    .optional()
    .describe('Description used on customs declarations'),
  description: z
    .string()
    .nullable()
    .optional()
    .describe('Internal product description (not used for customs)'),
  country: z
    .string()
    .optional()
    .describe(
      'Country of origin — ISO 3166-1 alpha-2 code or country name (e.g. "AU", "Australia")',
    ),
  weight: z.number().nonnegative().optional().describe('Product weight in kilograms'),
  height: z.number().nonnegative().optional().describe('Product height in metres'),
  length: z.number().nonnegative().optional().describe('Product length in metres'),
  width: z.number().nonnegative().optional().describe('Product width in metres'),
  hs_code: z
    .string()
    .optional()
    .describe('Harmonised System (HS) tariff code for customs (e.g. "6109.10")'),
  color: z.string().optional().describe('Product colour / color variant'),
  size: z.string().optional().describe('Product size variant (e.g. "S", "M", "L", "XL")'),
  barcode: z.string().nullable().optional().describe('Product barcode (EAN, UPC, etc.)'),
  bin_location: z
    .string()
    .optional()
    .describe('Warehouse bin/shelf location code (e.g. "A1-B2")'),
  brand: z.string().nullable().optional().describe('Product brand name'),
  usage: z.string().nullable().optional().describe('Product usage / purpose description'),
  material: z.string().nullable().optional().describe('Primary material the product is made from'),
  model: z.string().nullable().optional().describe('Product model number or name'),
  mid: z
    .string()
    .nullable()
    .optional()
    .describe('Manufacturer Identification (MID) code for US customs'),
  price: z
    .number()
    .nonnegative()
    .optional()
    .describe('Product price (used for declared customs value)'),
  dangerous_goods: z
    .boolean()
    .optional()
    .describe('Whether the product is classified as dangerous goods (DG)'),
});

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface ListProductsResponse {
  products?: Product[];
  total_count?: number;
  page_number?: number;
  page_size?: number;
  success?: boolean;
}

interface AddProductResponse {
  product?: Product;
  success?: boolean;
  errors?: unknown;
  message?: string;
}

interface UpdateProductResponse {
  product?: Product;
  success?: boolean;
  errors?: unknown;
  message?: string;
}

interface DeleteProductsResponse {
  success?: boolean;
  errors?: unknown;
  message?: string;
  deleted_count?: number;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatProductList(data: ListProductsResponse, format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(data, null, 2);
  }

  const products = data.products ?? [];
  if (products.length === 0) {
    return 'No products found.';
  }

  const lines: string[] = [
    `## Products (page ${data.page_number ?? 1}, showing ${products.length} of ${data.total_count ?? products.length})`,
    '',
  ];

  for (const p of products) {
    lines.push(`### ${p.title} (SKU: ${p.sku})`);
    if (p.id !== undefined) lines.push(`- **ID:** ${p.id}`);
    if (p.brand) lines.push(`- **Brand:** ${p.brand}`);
    if (p.description) lines.push(`- **Description:** ${p.description}`);
    if (p.customs_description) lines.push(`- **Customs Description:** ${p.customs_description}`);
    if (p.barcode) lines.push(`- **Barcode:** ${p.barcode}`);
    if (p.bin_location) lines.push(`- **Bin Location:** ${p.bin_location}`);
    if (p.country) lines.push(`- **Country of Origin:** ${p.country}`);
    if (p.weight !== undefined) lines.push(`- **Weight:** ${p.weight} kg`);
    if (p.length !== undefined || p.width !== undefined || p.height !== undefined) {
      const dims = [
        p.length !== undefined ? `L: ${p.length}m` : null,
        p.width !== undefined ? `W: ${p.width}m` : null,
        p.height !== undefined ? `H: ${p.height}m` : null,
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(`- **Dimensions:** ${dims}`);
    }
    if (p.hs_code) lines.push(`- **HS Code:** ${p.hs_code}`);
    if (p.mid) lines.push(`- **MID:** ${p.mid}`);
    if (p.price !== undefined) lines.push(`- **Price:** ${p.price}`);
    if (p.color) lines.push(`- **Colour:** ${p.color}`);
    if (p.size) lines.push(`- **Size:** ${p.size}`);
    if (p.material) lines.push(`- **Material:** ${p.material}`);
    if (p.model) lines.push(`- **Model:** ${p.model}`);
    if (p.usage) lines.push(`- **Usage:** ${p.usage}`);
    if (p.dangerous_goods !== undefined) {
      lines.push(`- **Dangerous Goods:** ${p.dangerous_goods ? 'Yes' : 'No'}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatProduct(
  data: AddProductResponse | UpdateProductResponse,
  action: 'Added' | 'Updated',
  format: ResponseFormat,
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(data, null, 2);
  }

  const lines: string[] = [`## Product ${action}`, ''];

  if (data.success === false) {
    lines.push('**Status:** Failed');
    if (data.message) lines.push(`**Message:** ${data.message}`);
    if (data.errors) {
      lines.push(
        `**Errors:**\n\`\`\`json\n${JSON.stringify(data.errors, null, 2)}\n\`\`\``,
      );
    }
    return lines.join('\n');
  }

  lines.push('**Status:** Success');

  const p = data.product;
  if (p) {
    lines.push('');
    lines.push(`**Title:** ${p.title}`);
    lines.push(`**SKU:** ${p.sku}`);
    if (p.id !== undefined) lines.push(`**ID:** ${p.id}`);
    if (p.brand) lines.push(`**Brand:** ${p.brand}`);
    if (p.barcode) lines.push(`**Barcode:** ${p.barcode}`);
    if (p.bin_location) lines.push(`**Bin Location:** ${p.bin_location}`);
    if (p.country) lines.push(`**Country of Origin:** ${p.country}`);
    if (p.weight !== undefined) lines.push(`**Weight:** ${p.weight} kg`);
    if (p.hs_code) lines.push(`**HS Code:** ${p.hs_code}`);
    if (p.price !== undefined) lines.push(`**Price:** ${p.price}`);
    if (p.dangerous_goods !== undefined) {
      lines.push(`**Dangerous Goods:** ${p.dangerous_goods ? 'Yes' : 'No'}`);
    }
  }

  return lines.join('\n');
}

function formatDeleteResult(data: DeleteProductsResponse, format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(data, null, 2);
  }

  const lines: string[] = ['## Delete Products Result', ''];

  if (data.success === false) {
    lines.push('**Status:** Failed');
    if (data.message) lines.push(`**Message:** ${data.message}`);
    if (data.errors) {
      lines.push(
        `**Errors:**\n\`\`\`json\n${JSON.stringify(data.errors, null, 2)}\n\`\`\``,
      );
    }
  } else {
    lines.push('**Status:** Success');
    if (data.deleted_count !== undefined) {
      lines.push(`**Deleted:** ${data.deleted_count} product(s)`);
    }
    if (data.message) lines.push(`**Message:** ${data.message}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProductTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // 1. starshipit_list_products
  // -------------------------------------------------------------------------
  server.registerTool(
    'starshipit_list_products',
    {
      title: 'List / Search Products',
      description: `List or search products in the StarShipIt product catalogue.

Products are pre-configured items used to auto-populate order line items when creating orders. Each product can carry customs details (HS code, country of origin, customs description) and physical dimensions for accurate rate calculations.

**Query parameters:**
- \`search_term\`: Free-text search across SKU, title, barcode, and description. Pass an empty string \`""\` to list all products without filtering.
- \`page_number\`: Page number for pagination (default: 1)
- \`page_size\`: Number of results per page (min: 10, max: 2000, default: 50)
- \`skip_records\`: Number of records to skip (offset). Useful for offset-based pagination alongside \`page_size\`. Default: 0.
- \`sort_column\`: Column to sort by. One of: Sku | Barcode | BinLocation | Brand | Colour | Country | CustomsDescription | DangerousGoods | Description | HsCode | Mid | Price | Size | Title | Weight (default: Sku)
- \`sort_direction\`: Ascending or Descending (default: Ascending)

**Note:** This API uses \`page_number\`/\`page_size\`/\`skip_records\` rather than the standard \`page\`/\`limit\` pagination used by other StarShipIt endpoints.

**Returns per product:**
- SKU, title, id, brand, barcode, bin_location, country, weight, dimensions (length/width/height in metres), hs_code, mid, price, dangerous_goods flag, colour, size, material, model, usage, customs_description, description

**Example return fields:**
\`\`\`json
{
  "id": 12345,
  "sku": "WIDGET-001",
  "title": "Blue Widget",
  "weight": 0.5,
  "hs_code": "8543.70",
  "country": "CN",
  "price": 9.99
}
\`\`\`

**Error cases:**
- 401/403: Invalid or missing API credentials
- 400: Invalid query parameters (e.g. page_size out of range)

**Use this tool when:**
- Looking up a product by SKU or name before creating an order
- Auditing the product catalogue for missing customs info
- Checking dimensions/weights for rate calculation accuracy`,
      inputSchema: z.object({
        search_term: z
          .string()
          .default('')
          .describe(
            'Free-text search across SKU, title, barcode, and description. Pass an empty string to list all products.',
          ),
        page_number: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe('Page number for pagination (default: 1)'),
        page_size: z
          .number()
          .int()
          .min(10)
          .max(2000)
          .default(50)
          .describe('Number of results per page (min: 10, max: 2000, default: 50)'),
        skip_records: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe(
            'Number of records to skip (offset-based pagination). Default: 0.',
          ),
        sort_column: z
          .enum([
            'Sku',
            'Barcode',
            'BinLocation',
            'Brand',
            'Colour',
            'Country',
            'CustomsDescription',
            'DangerousGoods',
            'Description',
            'HsCode',
            'Mid',
            'Price',
            'Size',
            'Title',
            'Weight',
          ])
          .default('Sku')
          .describe(
            'Column to sort results by. Valid values: Sku | Barcode | BinLocation | Brand | Colour | Country | CustomsDescription | DangerousGoods | Description | HsCode | Mid | Price | Size | Title | Weight (default: Sku)',
          ),
        sort_direction: z
          .enum(['Ascending', 'Descending'])
          .default('Ascending')
          .describe('Sort direction: Ascending or Descending (default: Ascending)'),
        response_format: ResponseFormatSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      search_term,
      page_number,
      page_size,
      skip_records,
      sort_column,
      sort_direction,
      response_format,
    }) => {
      try {
        const data = await apiRequest<ListProductsResponse>('products', 'GET', undefined, {
          search_term,
          page_number,
          page_size,
          skip_records,
          sort_column,
          sort_direction,
        });

        const formatted = formatProductList(data, response_format ?? ResponseFormat.MARKDOWN);
        return {
          content: [{ type: 'text', text: truncateIfNeeded(formatted, CHARACTER_LIMIT) }],
        };
      } catch (error: unknown) {
        return { content: [{ type: 'text', text: handleApiError(error) }], isError: true };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 2. starshipit_add_product
  // -------------------------------------------------------------------------
  server.registerTool(
    'starshipit_add_product',
    {
      title: 'Add Product',
      description: `Add a new product to the StarShipIt product catalogue.

Products in the catalogue are used to auto-populate line item details (weight, dimensions, customs info) when creating orders. Adding a product here means it can be matched by SKU when orders are imported.

**Required fields (within the \`product\` object):**
- \`sku\`: Unique Stock Keeping Unit identifier. Must be unique across the catalogue.
- \`title\`: Human-readable product name.

**Optional fields (all within the \`product\` object):**
- \`customs_description\`: Description for customs declarations (for international shipments)
- \`description\`: Internal product description
- \`country\`: Country of origin (ISO code or name)
- \`weight\`: Weight in kg
- \`height\`, \`length\`, \`width\`: Dimensions in metres
- \`hs_code\`: Harmonised System tariff code (e.g. "6109.10")
- \`mid\`: Manufacturer ID code (used for US customs)
- \`price\`: Declared value for customs
- \`dangerous_goods\`: Boolean flag if the product contains DG
- \`barcode\`, \`bin_location\`, \`brand\`, \`color\`, \`size\`, \`material\`, \`model\`, \`usage\`

**Returns:** The created product object including its new \`id\`.

**Error cases:**
- 400: Missing required fields (sku or title) or invalid field values
- 409: A product with this SKU already exists

**Use this tool when:**
- Adding new SKUs to the catalogue before importing orders
- Seeding product data for customs auto-fill on international shipments`,
      inputSchema: z.object({
        product: ProductFieldsSchema.describe('Product data to create'),
        response_format: ResponseFormatSchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ product, response_format }) => {
      try {
        const data = await apiRequest<AddProductResponse>('products', 'POST', { product });

        const formatted = formatProduct(data, 'Added', response_format ?? ResponseFormat.MARKDOWN);
        return {
          content: [{ type: 'text', text: truncateIfNeeded(formatted, CHARACTER_LIMIT) }],
        };
      } catch (error: unknown) {
        return { content: [{ type: 'text', text: handleApiError(error) }], isError: true };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 3. starshipit_update_product
  // -------------------------------------------------------------------------
  server.registerTool(
    'starshipit_update_product',
    {
      title: 'Update Product',
      description: `Update an existing product in the StarShipIt product catalogue by its numeric ID.

Use this to correct product details, update dimensions/weights, add customs codes, or change any other product attribute. The product \`id\` must be provided both at the top level and inside the \`product\` object — this is a StarShipIt API requirement.

**Required top-level fields:**
- \`id\`: Numeric product ID (obtain via \`starshipit_list_products\`)

**Required \`product\` object fields:**
- \`id\`: Same numeric product ID (must match top-level id)
- \`sku\`: Product SKU (can be the existing SKU unchanged)
- \`title\`: Product title (can be the existing title unchanged)

**Optional \`product\` object fields:** All standard product fields (customs_description, country, weight, height, length, width, hs_code, color, size, barcode, bin_location, brand, usage, material, model, mid, price, dangerous_goods, description).

**Returns:** The updated product object.

**Error cases:**
- 400: Validation errors (e.g. invalid field values)
- 404: Product with given ID not found
- 409: SKU conflict with another product

**Use this tool when:**
- Correcting product weight or dimensions after a measurement error
- Adding missing HS codes to products before an international shipment
- Updating a product price or customs description`,
      inputSchema: z.object({
        id: z
          .number()
          .int()
          .positive()
          .describe('Numeric product ID to update (obtain via starshipit_list_products)'),
        product: ProductFieldsSchema.extend({
          id: z
            .number()
            .int()
            .positive()
            .describe(
              'Numeric product ID — must match the top-level id field (StarShipIt API requirement)',
            ),
        }).describe('Full product object including id, sku, title, and any fields to update'),
        response_format: ResponseFormatSchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id, product, response_format }) => {
      try {
        const data = await apiRequest<UpdateProductResponse>('products/update', 'PUT', {
          id,
          product,
        });

        const formatted = formatProduct(
          data,
          'Updated',
          response_format ?? ResponseFormat.MARKDOWN,
        );
        return {
          content: [{ type: 'text', text: truncateIfNeeded(formatted, CHARACTER_LIMIT) }],
        };
      } catch (error: unknown) {
        return { content: [{ type: 'text', text: handleApiError(error) }], isError: true };
      }
    },
  );

  // -------------------------------------------------------------------------
  // 4. starshipit_delete_products
  // -------------------------------------------------------------------------
  server.registerTool(
    'starshipit_delete_products',
    {
      title: 'Delete Products',
      description: `Delete one or more products from the StarShipIt product catalogue. This operation is irreversible.

**Two modes:**

1. **Delete specific products** (recommended): Provide an array of numeric \`product_ids\`. Only those products are deleted. Leave \`all_products\` as \`false\` (default).

2. **Delete ALL products** (use with extreme caution): Set \`all_products: true\` and pass an empty \`product_ids\` array \`[]\`. This permanently removes every product in the catalogue — there is no undo.

**Parameters:**
- \`product_ids\`: Array of numeric product IDs to delete. Use an empty array \`[]\` only when \`all_products\` is \`true\`.
- \`all_products\`: Set to \`true\` to delete the entire catalogue. Defaults to \`false\`. If \`true\`, \`product_ids\` is ignored.

**Returns:**
- \`success\`: Whether the deletion succeeded
- \`deleted_count\`: Number of products deleted (if returned by API)
- \`errors\`: Any per-product errors

**Error cases:**
- 400: Invalid product IDs or malformed request body
- 404: One or more product IDs not found (partial deletes may still succeed)

**Use this tool when:**
- Removing discontinued products from the catalogue
- Purging test/dummy products after setup
- Clearing the entire catalogue before a fresh import (all_products=true — use carefully)`,
      inputSchema: z.object({
        product_ids: z
          .array(z.number().int().positive())
          .describe(
            'Array of numeric product IDs to delete. Pass an empty array [] only when all_products is true.',
          ),
        all_products: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'Set to true to delete ALL products in the catalogue. Irreversible. When true, product_ids is ignored. Default: false.',
          ),
        response_format: ResponseFormatSchema,
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ product_ids, all_products, response_format }) => {
      try {
        const body: { product_ids: number[]; all_products?: boolean } = { product_ids };
        if (all_products) body.all_products = all_products;

        const data = await apiRequest<DeleteProductsResponse>('products/delete', 'DELETE', body);

        const formatted = formatDeleteResult(data, response_format ?? ResponseFormat.MARKDOWN);
        return {
          content: [{ type: 'text', text: truncateIfNeeded(formatted, CHARACTER_LIMIT) }],
        };
      } catch (error: unknown) {
        return { content: [{ type: 'text', text: handleApiError(error) }], isError: true };
      }
    },
  );
}
