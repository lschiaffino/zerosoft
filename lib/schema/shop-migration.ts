import type { Client } from '@libsql/client';

/**
 * Shop (Shopify / Tiendanube): tienda, catálogo con variantes, inventario por
 * ubicación con historial, colecciones, envíos, impuestos, descuentos,
 * clientes, pedidos con su línea de tiempo y eventos de webhook procesados.
 * Montos en unidades mínimas enteras (cents). Todo cuelga del workspace
 * (workspace_id = id del owner, como el resto de las apps).
 */
export async function shopUp(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS shop_stores (
      workspace_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      handle TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      locale TEXT NOT NULL DEFAULT 'en',
      theme TEXT NOT NULL DEFAULT 'classic',
      brand TEXT NOT NULL DEFAULT '{}',
      settings TEXT NOT NULL DEFAULT '{}',
      payments TEXT NOT NULL DEFAULT '{}',
      contact_email TEXT NOT NULL DEFAULT '',
      tax_included INTEGER NOT NULL DEFAULT 0,
      low_stock INTEGER NOT NULL DEFAULT 5,
      next_number INTEGER NOT NULL DEFAULT 1001,
      webhook_token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shop_products (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      handle TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      vendor TEXT NOT NULL DEFAULT '',
      product_type TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      options TEXT NOT NULL DEFAULT '[]',
      images TEXT NOT NULL DEFAULT '[]',
      seo_title TEXT NOT NULL DEFAULT '',
      seo_description TEXT NOT NULL DEFAULT '',
      requires_shipping INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, handle)
    );
    CREATE INDEX IF NOT EXISTS idx_shop_products_ws ON shop_products(workspace_id, updated_at);
    CREATE TABLE IF NOT EXISTS shop_variants (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      options TEXT NOT NULL DEFAULT '[]',
      sku TEXT NOT NULL DEFAULT '',
      barcode TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0,
      compare_at_cents INTEGER,
      weight_grams INTEGER NOT NULL DEFAULT 0,
      track_inventory INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      image_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_shop_variants_product ON shop_variants(product_id, position);
    CREATE INDEX IF NOT EXISTS idx_shop_variants_sku ON shop_variants(workspace_id, sku);
    CREATE TABLE IF NOT EXISTS shop_locations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shop_locations_ws ON shop_locations(workspace_id);
    CREATE TABLE IF NOT EXISTS shop_inventory (
      variant_id TEXT NOT NULL REFERENCES shop_variants(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES shop_locations(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      available INTEGER NOT NULL DEFAULT 0,
      reserved INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (variant_id, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_shop_inventory_ws ON shop_inventory(workspace_id);
    CREATE TABLE IF NOT EXISTS shop_inventory_log (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      variant_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      available_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shop_inventory_log ON shop_inventory_log(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_shop_inventory_log_variant ON shop_inventory_log(variant_id, created_at);
    CREATE TABLE IF NOT EXISTS shop_collections (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      handle TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'manual',
      rules TEXT NOT NULL DEFAULT '{"match":"all","rules":[]}',
      image_url TEXT,
      published INTEGER NOT NULL DEFAULT 1,
      featured INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, handle)
    );
    CREATE TABLE IF NOT EXISTS shop_collection_products (
      collection_id TEXT NOT NULL REFERENCES shop_collections(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (collection_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS shop_shipping_rates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'flat',
      countries TEXT NOT NULL DEFAULT '[]',
      price_cents INTEGER NOT NULL DEFAULT 0,
      min_weight_g INTEGER,
      max_weight_g INTEGER,
      free_over_cents INTEGER,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS shop_tax_rates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      country TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT '',
      rate_bps INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      applies_to_shipping INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS shop_discounts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'percent',
      value INTEGER NOT NULL DEFAULT 0,
      min_order_cents INTEGER NOT NULL DEFAULT 0,
      usage_limit INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      starts_at TEXT,
      ends_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, code)
    );
    CREATE TABLE IF NOT EXISTS shop_customers (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      orders_count INTEGER NOT NULL DEFAULT 0,
      total_spent_cents INTEGER NOT NULL DEFAULT 0,
      crm_contact_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, email)
    );
    CREATE TABLE IF NOT EXISTS shop_orders (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      email TEXT NOT NULL,
      customer_id TEXT,
      name TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL DEFAULT 0,
      discount_cents INTEGER NOT NULL DEFAULT 0,
      shipping_cents INTEGER NOT NULL DEFAULT 0,
      tax_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0,
      tax_included INTEGER NOT NULL DEFAULT 0,
      discount_code TEXT,
      discount_id TEXT,
      shipping_name TEXT,
      shipping_address TEXT NOT NULL DEFAULT '{}',
      payment_method TEXT NOT NULL,
      payment_ref TEXT,
      payment_id TEXT,
      paid_at TEXT,
      fulfilled_at TEXT,
      cancelled_at TEXT,
      refunded_at TEXT,
      refunded_cents INTEGER NOT NULL DEFAULT 0,
      tracking_number TEXT,
      tracking_company TEXT,
      tracking_url TEXT,
      customer_note TEXT NOT NULL DEFAULT '',
      stock_state TEXT NOT NULL DEFAULT 'reserved',
      status_token TEXT NOT NULL UNIQUE,
      locale TEXT NOT NULL DEFAULT 'en',
      expires_at TEXT,
      cancel_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_shop_orders_ws ON shop_orders(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_shop_orders_email ON shop_orders(workspace_id, email);
    CREATE INDEX IF NOT EXISTS idx_shop_orders_expiry ON shop_orders(status, expires_at);
    CREATE TABLE IF NOT EXISTS shop_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      product_id TEXT,
      variant_id TEXT,
      location_id TEXT,
      title TEXT NOT NULL,
      variant_title TEXT NOT NULL DEFAULT '',
      sku TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL,
      unit_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      weight_grams INTEGER NOT NULL DEFAULT 0,
      image_url TEXT,
      track_inventory INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_shop_order_items_order ON shop_order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_shop_order_items_product ON shop_order_items(workspace_id, product_id);
    CREATE TABLE IF NOT EXISTS shop_order_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      actor TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shop_order_events ON shop_order_events(order_id, created_at);
    CREATE TABLE IF NOT EXISTS shop_webhook_events (
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider, workspace_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS shop_stats (
      workspace_id TEXT NOT NULL,
      day TEXT NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      checkouts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (workspace_id, day)
    );
  `);
}
