import type { Client } from '@libsql/client';

async function addColumn(client: Client, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!(err instanceof Error && /duplicate column/i.test(err.message))) throw err;
  }
}

/**
 * Books, capacidades nuevas. Solo columnas con valor por defecto y tablas
 * nuevas: no toca filas existentes, y lo ya emitido sigue igual.
 */
export async function booksParityUp(client: Client): Promise<void> {
  for (const sql of [
    'ALTER TABLE books_documents ADD COLUMN tax_inclusive INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE books_documents ADD COLUMN applied_base INTEGER',
    'ALTER TABLE books_lines ADD COLUMN tracking_a TEXT',
    'ALTER TABLE books_lines ADD COLUMN tracking_b TEXT',
    'ALTER TABLE books_journal_lines ADD COLUMN tracking_a TEXT',
    'ALTER TABLE books_journal_lines ADD COLUMN tracking_b TEXT',
    'ALTER TABLE books_payments ADD COLUMN base_cleared INTEGER',
    'ALTER TABLE books_payments ADD COLUMN batch_id TEXT',
    'ALTER TABLE books_settings ADD COLUMN fiscal_start_month INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE books_settings ADD COLUMN next_quote INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE books_contacts ADD COLUMN portal_token TEXT',
    'ALTER TABLE books_contacts ADD COLUMN portal_revoked INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE books_recurring ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'invoice'",
    'ALTER TABLE books_bank_txns ADD COLUMN batch_id TEXT',
  ]) {
    await addColumn(client, sql);
  }
  await client.executeMultiple(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_books_contacts_portal ON books_contacts(portal_token) WHERE portal_token IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_books_payments_batch ON books_payments(batch_id) WHERE batch_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS books_payment_batches (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      date TEXT NOT NULL,
      account_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      fx_rate TEXT NOT NULL DEFAULT '1',
      reference TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL,
      journal_id TEXT,
      bank_txn_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_batches_ws ON books_payment_batches(workspace_id, date);
    CREATE TABLE IF NOT EXISTS books_quotes (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      contact_id TEXT,
      title TEXT NOT NULL DEFAULT '',
      issue_date TEXT NOT NULL,
      expiry_date TEXT,
      currency TEXT NOT NULL,
      fx_rate TEXT NOT NULL DEFAULT '1',
      tax_inclusive INTEGER NOT NULL DEFAULT 0,
      lines TEXT NOT NULL DEFAULT '[]',
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount_total INTEGER NOT NULL DEFAULT 0,
      tax_total INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      terms TEXT NOT NULL DEFAULT '',
      public_token TEXT UNIQUE,
      public_revoked INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT,
      viewed_at TEXT,
      decided_at TEXT,
      decided_name TEXT NOT NULL DEFAULT '',
      invoice_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_books_quotes_ws ON books_quotes(workspace_id, status, issue_date);
    CREATE TABLE IF NOT EXISTS books_bank_rules (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'any',
      match_op TEXT NOT NULL DEFAULT 'contains',
      match_text TEXT NOT NULL,
      min_amount INTEGER,
      max_amount INTEGER,
      bank_account_id TEXT,
      account_id TEXT NOT NULL,
      memo TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      applied_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_rules_ws ON books_bank_rules(workspace_id, position);
    CREATE TABLE IF NOT EXISTS books_tracking_categories (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slot TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, slot)
    );
    CREATE TABLE IF NOT EXISTS books_tracking_options (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES books_tracking_categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (category_id, name)
    );
    CREATE TABLE IF NOT EXISTS books_budgets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_month TEXT NOT NULL,
      months INTEGER NOT NULL DEFAULT 12,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_budgets_ws ON books_budgets(workspace_id, name);
    CREATE TABLE IF NOT EXISTS books_budget_lines (
      budget_id TEXT NOT NULL REFERENCES books_budgets(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      month TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (budget_id, account_id, month)
    );
    CREATE TABLE IF NOT EXISTS books_fixed_assets (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      asset_account_id TEXT NOT NULL,
      accum_account_id TEXT NOT NULL,
      expense_account_id TEXT NOT NULL,
      purchase_date TEXT NOT NULL,
      start_date TEXT NOT NULL,
      cost INTEGER NOT NULL,
      residual INTEGER NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'straight_line',
      life_months INTEGER,
      rate_bps INTEGER,
      accumulated INTEGER NOT NULL DEFAULT 0,
      depreciated_to TEXT,
      disposed_date TEXT,
      disposal_proceeds INTEGER,
      disposal_journal_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_assets_ws ON books_fixed_assets(workspace_id, status);
    CREATE TABLE IF NOT EXISTS books_depreciation_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL REFERENCES books_fixed_assets(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      amount INTEGER NOT NULL,
      journal_id TEXT,
      reversed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_books_dep_month ON books_depreciation_runs(asset_id, month) WHERE reversed = 0;
    CREATE INDEX IF NOT EXISTS idx_books_dep_journal ON books_depreciation_runs(journal_id);
  `);
}
