import { z } from 'zod';

export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}

export const ResponseFormatSchema = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

export const PaginationSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(250)
    .default(50)
    .describe('Maximum number of results to return (default: 50, max: 250)'),
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('Page number for pagination (default: 1)'),
});

export const AddressSchema = z.object({
  name: z.string().min(1).describe('Recipient full name'),
  company: z.string().optional().describe('Company name'),
  phone: z.string().optional().describe('Phone number'),
  email: z.string().email().optional().describe('Email address'),
  street: z.string().min(1).describe('Street address'),
  suburb: z.string().optional().describe('Suburb'),
  city: z.string().optional().describe('City'),
  state: z.string().optional().describe('State or province code (e.g. NSW, VIC)'),
  post_code: z.string().min(1).describe('Postcode / ZIP code'),
  country: z.string().min(1).describe('Country name (e.g. Australia) or ISO code (e.g. AU)'),
  delivery_instructions: z.string().optional().describe('Delivery instructions for the courier'),
  building: z.string().optional().describe('Building or apartment name'),
});

export const PackageSchema = z.object({
  weight: z.number().positive().describe('Weight in kilograms'),
  height: z.number().positive().optional().describe('Height in metres'),
  width: z.number().positive().optional().describe('Width in metres'),
  length: z.number().positive().optional().describe('Length in metres'),
});

export const OrderItemSchema = z.object({
  description: z.string().min(1).describe('Item description'),
  sku: z.string().optional().describe('Stock keeping unit code'),
  quantity: z.number().int().positive().optional().describe('Quantity of items'),
  value: z.number().nonnegative().optional().describe('Declared value per item (for customs)'),
  weight: z.number().positive().optional().describe('Item weight in kilograms'),
  hs_code: z.string().optional().describe('Harmonised System (HS) tariff code for customs'),
  country_of_origin: z.string().optional().describe('Country of manufacture (ISO code)'),
  dangerous_goods: z.boolean().optional().describe('Whether item is classified as dangerous goods'),
});

export function truncateIfNeeded(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const msg = `\n\n[Response truncated at ${limit} characters. Use pagination (page/limit) or filters to narrow results.]`;
  return text.slice(0, limit - msg.length) + msg;
}
