export interface Destination {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  street: string;
  suburb?: string;
  city?: string;
  state?: string;
  post_code: string;
  country: string;
  delivery_instructions?: string;
  building?: string;
}

export interface OrderItem {
  description: string;
  sku?: string;
  quantity?: number;
  value?: number;
  weight?: number;
  hs_code?: string;
  country_of_origin?: string;
  dangerous_goods?: boolean;
}

export interface Package {
  weight: number;
  height?: number;
  width?: number;
  length?: number;
}

export interface Order {
  order_id?: number;
  order_date?: string;
  order_number?: string;
  reference?: string;
  carrier?: string;
  carrier_name?: string;
  carrier_service_code?: string;
  shipping_method?: string;
  signature_required?: boolean;
  return_order?: boolean;
  destination: Destination;
  items?: OrderItem[];
  packages?: Package[];
  metadata?: Record<string, unknown>;
}

export interface TrackingEvent {
  description?: string;
  date?: string;
  location?: string;
}

export interface Shipment {
  order_id: number;
  order_number?: string;
  tracking_number?: string;
  carrier?: string;
  carrier_service?: string;
  shipment_date?: string;
  tracking_status?: string;
  destination?: Destination;
}

export interface Rate {
  carrier?: string;
  carrier_name?: string;
  service_name?: string;
  service_code?: string;
  price?: number;
  currency?: string;
  estimated_transit_days?: number;
}

export interface Address {
  id?: number;
  code?: string;
  name: string;
  company?: string;
  post_code: string;
  street: string;
  suburb?: string;
  city?: string;
  state?: string;
  country: string;
  phone?: string;
  instructions?: string;
  building?: string;
  email?: string;
  carrier?: number;
  signature_required?: boolean;
}

export interface Manifest {
  manifest_id?: number;
  created_date?: string;
  carrier?: string;
  tracking_numbers?: string[];
}

export interface Product {
  id?: number;
  sku: string;
  title: string;
  customs_description?: string | null;
  description?: string | null;
  country?: string;
  weight?: number;
  height?: number;
  length?: number;
  width?: number;
  hs_code?: string;
  color?: string;
  size?: string;
  barcode?: string | null;
  bin_location?: string;
  brand?: string | null;
  usage?: string | null;
  material?: string | null;
  model?: string | null;
  mid?: string | null;
  price?: number;
  dangerous_goods?: boolean;
}

export interface ApiError {
  status?: number;
  message?: string;
  errors?: Record<string, string[]>;
}
