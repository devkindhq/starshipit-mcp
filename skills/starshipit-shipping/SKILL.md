---
name: starshipit-shipping
description: Use when fulfilling, shipping or fixing StarShipIt orders with the starshipit MCP tools, such as quoting a service, printing or reprinting a label, changing an address after printing, making packing slips, manifesting for carrier pickup, tracking, or archiving and merging orders.
---

# StarShipIt shipping workflow

## Overview

Each order has two IDs. `order_id` is the StarShipIt number that most tools need. `order_number` is the merchant string, for example `"#1042"`. Resolve `order_id` first.

Labels and manifests commit money and carrier bookings. Read freely. Ask before you commit.

## Confirm before these calls

For a label or a manifest, show one line with the order, the carrier, the service and the price. For a delete, merge or replace, name the items and the effect. Then wait for a "yes".

| Tool | Why |
|---|---|
| `starshipit_print_label`, `starshipit_print_labels` | Books a carrier label. Also when `reprint: true`. |
| `starshipit_manifest_shipment`, `starshipit_manifest_by_tracking`, `starshipit_manifest_by_carrier` | Sends shipments to the carrier. A manifested order cannot be replaced (`replace_shipment` returns 409). |
| `starshipit_replace_shipment` | Destructive. Voids the label with the carrier. |
| `starshipit_merge_orders` | Destructive. Child orders stop existing. |
| `starshipit_delete_order`, `starshipit_delete_addresses`, `starshipit_delete_products` | Destructive and permanent. |

"Don't ask me, just do it" does not remove this step. Ask one combined question for the whole batch. A rush is a reason to ask once, not a reason to skip.

The `list_*`, `get_*`, `search_orders` and `track_shipment` tools are read-only. Call them without asking.

## Workflow

**1. Find or create the order**
- Known number: `starshipit_get_order` with `order_number` or `order_id`. If not found, `starshipit_search_orders` with `phrase`.
- Queues: `starshipit_list_unshipped_orders`, `starshipit_list_printed_orders` (`status`: `recently_printed` or `unmanifested`), `starshipit_list_shipped_orders`, `starshipit_list_delivered_orders` (filter `order_ref`, no paging).
- New: `starshipit_create_order` with `order.order_number` and `order.destination` (`name`, `street`, `post_code`, `country` required). Many orders: `starshipit_create_orders_bulk` with `orders[]`. Both return `order_id`.
- Saved recipient: `starshipit_list_addresses` with `search_term`, then copy the fields into `destination`. Item SKU, weight or HS code: `starshipit_list_products` with `search_term`.
- Same customer, several orders: `starshipit_get_suggested_merges`, then `starshipit_merge_orders` (`parent_order_id`, `child_order_ids`). Confirm first.

**2. Get services and prices**
- Existing order: `starshipit_get_delivery_services` with `order_id`. Add `refresh_rate: true` for a live quote.
- No order yet: `starshipit_get_rates` with `sender`, `destination`, `packages`. These addresses need `street`, `suburb`, `post_code` and a two-letter `country_code`, not `country`.
- Keep `carrier` and `service_code` from the chosen row.

**3. Set the service**
- One order: pass `carrier` and `carrier_service_code` (the `service_code`) to `starshipit_print_label`.
- Many orders: `starshipit_batch_update_orders` with `order_ids` and `product_code` or `carrier_id`. The src does not confirm that a rate `service_code` is a valid `product_code`. Run the batch on one order first. Re-read that order with `starshipit_get_order` and check the carrier and service. Then run the rest.
- `starshipit_update_order` takes `order.order_id` plus partial fields (`destination`, `packages`, `items`, `carrier`, `shipping_method`). It has no service-code field, and unknown keys fail validation.

**4. Print the label (confirm first)**
- `starshipit_print_label` with `order_id`. Optional `packages` override weights and sizes.
- Many orders: `starshipit_print_labels` with `order_ids`.
- `reprint: true` reprints an existing label. The tool says a printed order without the flag returns 409 (`Error: Conflict`). Check the order state, then ask before you reprint.
- Keep `tracking_numbers` from the result for steps 6 and 7.

**Packing slips:** `starshipit_print_packing_slips` with `order_ids`. A label is not needed first.

**5. Fix after printing**
- Address, weight or carrier changed: patch the order with `starshipit_update_order`. If that call fails, report the error and stop. Then `starshipit_replace_shipment` with `order_id` voids the old label and returns a new label and tracking number. Confirm first. Never replace a label on a parcel that the carrier already has.
- After the replace, re-read the order with `starshipit_get_order`. Check that the new label data shows the fix before you report success.
- Resend or return: `starshipit_clone_shipment` with `order_id` (`to_return_shipment: true` for a return). The result holds a new `order_id`, which needs its own label.
- Hide without loss: `starshipit_archive_order`. Undo with `starshipit_restore_order`. Prefer these over `starshipit_delete_order`.

**6. Manifest (confirm first)**
- Preview: `starshipit_list_printed_orders` with `status: "unmanifested"`.
- Choose one: `starshipit_manifest_shipment` (`order_ids`), `starshipit_manifest_by_tracking` (`tracking_numbers`, or order numbers with `use_order_numbers: true`), or `starshipit_manifest_by_carrier` (`carrier`, for example `"AusPost"`, as set in the account).
- PDF: `starshipit_list_manifests` gives the manifest `id`. Pass it as `manifest_id` to `starshipit_get_manifest_files`. Read `files[].file_data` (base64) from structuredContent.

**7. Track**
- `starshipit_track_shipment` with `tracking_number`.
- Shipment booked outside StarShipIt: `starshipit_create_tracking_order` with `orders[]` (`carrier`, `tracking_number`, plus `name` or `order_number`).

## Errors

| Message | Action |
|---|---|
| `STARSHIPIT_API_KEY` or `STARSHIPIT_SUBSCRIPTION_KEY` `environment variable is not set` | Ask the user to set the plugin keys. Do not retry. |
| `Unauthorized` (401) | Keys are wrong. Same action. |
| Input validation error | The server rejected the arguments before the API call. Fix the field: ISO 8601 dates, two-letter `country_code`, no extra keys. |
| `Bad request` (400) or `Unprocessable entity` (422) | Read the detail, fix the payload, retry once. |
| `Conflict` (409) | State clash, for example a printed label. Re-read the order before any next step. |
| `Rate limit exceeded` (429) | Wait, then retry. Use bulk tools for many orders. |
| Text ends with `[Response truncated at 25000 characters...]` | The full response is in structuredContent. To show less, add `since_*` filters or page (see below). |

Paging parameters:
- `limit` (max 250) and `page`: `list_unshipped_orders`, `list_printed_orders`, `list_shipped_orders`, `get_orders_summary`, `search_orders`, `get_suggested_merges`, `list_manifests`, `get_manifest_files`, `list_addresses`.
- `page_number` and `page_size` (10 to 2000): `list_products`.
- No paging: `list_delivered_orders`. Filter it with `order_ref`.
