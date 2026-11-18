import type { Migration } from '../migrations';

/**
 * Shop: operaciones (rehecho de #56). Log y bajas de emails de la tienda, checkouts abandonados,
 * descuentos automáticos y por alcance, venta sin stock, retiro en local, envíos parciales,
 * devoluciones, órdenes de compra, páginas de contenido y links de "Mis pedidos".
 * Tolera correr dos veces y en paralelo: IF NOT EXISTS y columnas que ignoran "duplicate column".
 */
const COLUMNS = [
  "ALTER TABLE shop_discounts ADD COLUMN method TEXT NOT NULL DEFAULT 'code'",
  "ALTER TABLE shop_discounts ADD COLUMN title TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE shop_discounts ADD COLUMN min_quantity INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shop_discounts ADD COLUMN buy_quantity INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shop_discounts ADD COLUMN get_quantity INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE shop_discounts ADD COLUMN scope TEXT NOT NULL DEFAULT '{}'",
  'ALTER TABLE shop_discounts ADD COLUMN once_per_customer INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shop_variants ADD COLUMN continue_selling INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shop_order_items ADD COLUMN backorder INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shop_order_items ADD COLUMN fulfilled_qty INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shop_order_items ADD COLUMN returned_qty INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE shop_orders ADD COLUMN tax_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE shop_orders ADD COLUMN source TEXT NOT NULL DEFAULT 'online'",
  'ALTER TABLE shop_orders ADD COLUMN pickup INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE shop_orders ADD COLUMN payment_discount_cents INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE shop_shipping_rates ADD COLUMN note TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE shop_customers ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE shop_customers ADD COLUMN note TEXT NOT NULL DEFAULT ''",
];

export default {
  id: '20261118_1220_shop_operations',
  up: async (c) => {
    await c.executeMultiple(`
        CREATE TABLE IF NOT EXISTS shop_email_log (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          recipient TEXT NOT NULL,
          kind TEXT NOT NULL,
          ref TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (workspace_id, kind, ref)
        );
        CREATE INDEX IF NOT EXISTS idx_shop_email_log_recipient ON shop_email_log(recipient, created_at);
        CREATE INDEX IF NOT EXISTS idx_shop_email_log_ws ON shop_email_log(workspace_id, created_at);
        CREATE TABLE IF NOT EXISTS shop_email_optouts (
          workspace_id TEXT NOT NULL,
          email TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, email)
        );
        CREATE TABLE IF NOT EXISTS shop_checkouts (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token TEXT NOT NULL UNIQUE,
          email TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          lines TEXT NOT NULL DEFAULT '[]',
          subtotal_cents INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'USD',
          status TEXT NOT NULL DEFAULT 'open',
          email_state TEXT NOT NULL DEFAULT 'none',
          emailed_at TEXT,
          order_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (workspace_id, email)
        );
        CREATE INDEX IF NOT EXISTS idx_shop_checkouts_due ON shop_checkouts(status, email_state, updated_at);
        CREATE INDEX IF NOT EXISTS idx_shop_checkouts_ws ON shop_checkouts(workspace_id, updated_at);
    `);
    for (const sql of COLUMNS) {
      try {
        await c.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
    await c.execute('CREATE INDEX IF NOT EXISTS idx_shop_discounts_auto ON shop_discounts(workspace_id, method, active)');
    await c.executeMultiple(`
        CREATE TABLE IF NOT EXISTS shop_fulfillments (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL,
          items TEXT NOT NULL DEFAULT '[]',
          tracking_number TEXT,
          tracking_company TEXT,
          tracking_url TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_shop_fulfillments_order ON shop_fulfillments(order_id, created_at);
        CREATE TABLE IF NOT EXISTS shop_returns (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'requested',
          items TEXT NOT NULL DEFAULT '[]',
          reason TEXT NOT NULL DEFAULT 'other',
          note TEXT NOT NULL DEFAULT '',
          refund_cents INTEGER NOT NULL DEFAULT 0,
          restocked INTEGER NOT NULL DEFAULT 0,
          from_customer INTEGER NOT NULL DEFAULT 0,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_shop_returns_ws ON shop_returns(workspace_id, status, created_at);
        CREATE INDEX IF NOT EXISTS idx_shop_returns_order ON shop_returns(order_id);
        CREATE TABLE IF NOT EXISTS shop_purchase_orders (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          number INTEGER NOT NULL,
          supplier TEXT NOT NULL,
          location_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ordered',
          note TEXT NOT NULL DEFAULT '',
          expected_at TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (workspace_id, number)
        );
        CREATE TABLE IF NOT EXISTS shop_purchase_order_items (
          id TEXT PRIMARY KEY,
          po_id TEXT NOT NULL REFERENCES shop_purchase_orders(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL,
          variant_id TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          received INTEGER NOT NULL DEFAULT 0,
          unit_cost_cents INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_shop_po_items ON shop_purchase_order_items(po_id);
    `);
    await c.executeMultiple(`
        CREATE TABLE IF NOT EXISTS shop_pages (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL DEFAULT 'page',
          handle TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL DEFAULT '',
          published INTEGER NOT NULL DEFAULT 1,
          seo_title TEXT NOT NULL DEFAULT '',
          seo_description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (workspace_id, kind, handle)
        );
        CREATE TABLE IF NOT EXISTS shop_account_links (
          token_hash TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          email TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_shop_account_links_exp ON shop_account_links(expires_at);
    `);
  },
} satisfies Migration;
