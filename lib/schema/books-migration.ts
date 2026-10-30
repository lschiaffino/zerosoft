import type { Client } from '@libsql/client';

/**
 * Books (Xero / QuickBooks / Alegra / Colppy): facturación, compras, gastos,
 * inventario simple, bancos y contabilidad por partida doble. Montos en
 * unidades mínimas enteras de su moneda (centavos; pesos chilenos sin
 * decimales). Todo cuelga del workspace (workspace_id = id del owner).
 *
 * Inmutabilidad (triggers): los asientos y sus líneas no se editan ni se
 * borran; un documento emitido no cambia sus importes ni sus líneas y no
 * vuelve a borrador. Se corrige con una nota de crédito, una anulación o un
 * asiento de reversa. Borrar el workspace entero (users) sí arrastra todo:
 * los triggers de borrado solo cortan mientras el workspace existe.
 */
export async function booksUp(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS books_settings (
      workspace_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      country TEXT NOT NULL DEFAULT 'generic',
      base_currency TEXT NOT NULL DEFAULT 'USD',
      legal_name TEXT NOT NULL DEFAULT '',
      trade_name TEXT NOT NULL DEFAULT '',
      tax_id TEXT NOT NULL DEFAULT '',
      tax_condition TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      logo_url TEXT,
      brand_color TEXT NOT NULL DEFAULT '#1e3a8a',
      footer TEXT NOT NULL DEFAULT '',
      terms_days INTEGER NOT NULL DEFAULT 30,
      reminders TEXT NOT NULL DEFAULT '{"enabled":true,"days":[3,10,30]}',
      payments TEXT NOT NULL DEFAULT '{}',
      einvoice TEXT NOT NULL DEFAULT '{}',
      shop_auto_post INTEGER NOT NULL DEFAULT 0,
      shop_auto_post_since TEXT,
      crm_sync INTEGER NOT NULL DEFAULT 1,
      lock_date TEXT,
      webhook_token TEXT NOT NULL UNIQUE,
      next_journal INTEGER NOT NULL DEFAULT 1,
      next_po INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS books_roles (
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL,
      role TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, person_id)
    );
    CREATE TABLE IF NOT EXISTS books_accounts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      subtype TEXT NOT NULL DEFAULT 'other',
      system_key TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, code)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_books_accounts_key ON books_accounts(workspace_id, system_key) WHERE system_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS books_tax_rates (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      code TEXT NOT NULL DEFAULT '',
      rate_bps INTEGER NOT NULL,
      scope TEXT NOT NULL DEFAULT 'both',
      is_default INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_tax_ws ON books_tax_rates(workspace_id);
    CREATE TABLE IF NOT EXISTS books_series (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      name TEXT NOT NULL,
      letter TEXT NOT NULL DEFAULT '',
      point_of_sale INTEGER NOT NULL DEFAULT 1,
      next_number INTEGER NOT NULL DEFAULT 1,
      is_default INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, doc_type, letter, point_of_sale)
    );
    CREATE TABLE IF NOT EXISTS books_contacts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'customer',
      name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      tax_id TEXT NOT NULL DEFAULT '',
      tax_id_type TEXT NOT NULL DEFAULT '',
      tax_condition TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      currency TEXT,
      terms_days INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      crm_company_id TEXT,
      crm_contact_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_contacts_ws ON books_contacts(workspace_id, name);
    CREATE INDEX IF NOT EXISTS idx_books_contacts_crm ON books_contacts(workspace_id, crm_company_id);
    CREATE TABLE IF NOT EXISTS books_items (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'service',
      name TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      cost INTEGER NOT NULL DEFAULT 0,
      tax_rate_id TEXT,
      sales_account_id TEXT,
      purchase_account_id TEXT,
      track_stock INTEGER NOT NULL DEFAULT 0,
      stock_qty REAL NOT NULL DEFAULT 0,
      shop_variant_id TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_items_ws ON books_items(workspace_id, name);
    CREATE TABLE IF NOT EXISTS books_documents (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      doc_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      contact_id TEXT,
      series_id TEXT,
      number INTEGER,
      number_label TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      issue_date TEXT NOT NULL,
      due_date TEXT,
      terms_days INTEGER,
      currency TEXT NOT NULL,
      fx_rate TEXT NOT NULL DEFAULT '1',
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount_total INTEGER NOT NULL DEFAULT 0,
      tax_total INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      paid_total INTEGER NOT NULL DEFAULT 0,
      credited_total INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      public_token TEXT UNIQUE,
      public_revoked INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT,
      viewed_at TEXT,
      posted_at TEXT,
      voided_at TEXT,
      journal_id TEXT,
      credit_for_id TEXT,
      recurring_id TEXT,
      quote_id TEXT,
      shop_order_id TEXT,
      po_id TEXT,
      payment_session TEXT,
      einvoice_status TEXT,
      einvoice_data TEXT NOT NULL DEFAULT '{}',
      last_reminder_at TEXT,
      reminder_count INTEGER NOT NULL DEFAULT 0,
      overdue_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_docs_ws ON books_documents(workspace_id, doc_type, status, issue_date);
    CREATE INDEX IF NOT EXISTS idx_books_docs_contact ON books_documents(workspace_id, contact_id);
    CREATE INDEX IF NOT EXISTS idx_books_docs_due ON books_documents(status, due_date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_books_docs_shop ON books_documents(workspace_id, shop_order_id) WHERE shop_order_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_books_docs_number ON books_documents(workspace_id, series_id, number) WHERE number IS NOT NULL;
    CREATE TABLE IF NOT EXISTS books_lines (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES books_documents(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      item_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 1,
      unit_price INTEGER NOT NULL DEFAULT 0,
      discount_bps INTEGER NOT NULL DEFAULT 0,
      tax_rate_id TEXT,
      tax_bps INTEGER NOT NULL DEFAULT 0,
      account_id TEXT,
      gross INTEGER NOT NULL DEFAULT 0,
      discount INTEGER NOT NULL DEFAULT 0,
      net INTEGER NOT NULL DEFAULT 0,
      tax INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_books_lines_doc ON books_lines(doc_id, position);
    CREATE TABLE IF NOT EXISTS books_payments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      doc_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      date TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'bank',
      account_id TEXT NOT NULL,
      fx_rate TEXT NOT NULL DEFAULT '1',
      reference TEXT NOT NULL DEFAULT '',
      provider_ref TEXT,
      journal_id TEXT,
      bank_txn_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_payments_doc ON books_payments(doc_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_books_payments_provider ON books_payments(workspace_id, provider_ref) WHERE provider_ref IS NOT NULL;
    CREATE TABLE IF NOT EXISTS books_journals (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      date TEXT NOT NULL,
      memo TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL,
      source_id TEXT,
      reversal_of TEXT,
      reversed_by TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (workspace_id, number)
    );
    CREATE INDEX IF NOT EXISTS idx_books_journals_ws ON books_journals(workspace_id, date);
    CREATE INDEX IF NOT EXISTS idx_books_journals_source ON books_journals(workspace_id, source_type, source_id);
    CREATE TABLE IF NOT EXISTS books_journal_lines (
      id TEXT PRIMARY KEY,
      journal_id TEXT NOT NULL REFERENCES books_journals(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      debit INTEGER NOT NULL DEFAULT 0,
      credit INTEGER NOT NULL DEFAULT 0,
      contact_id TEXT,
      tax_rate_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
    );
    CREATE INDEX IF NOT EXISTS idx_books_jl_journal ON books_journal_lines(journal_id);
    CREATE INDEX IF NOT EXISTS idx_books_jl_account ON books_journal_lines(workspace_id, account_id);
    CREATE TABLE IF NOT EXISTS books_bank_accounts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      bank_name TEXT NOT NULL DEFAULT '',
      number_last4 TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_bank_ws ON books_bank_accounts(workspace_id);
    CREATE TABLE IF NOT EXISTS books_bank_txns (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bank_account_id TEXT NOT NULL REFERENCES books_bank_accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL,
      dedupe_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unmatched',
      payment_id TEXT,
      journal_id TEXT,
      import_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (bank_account_id, dedupe_key)
    );
    CREATE INDEX IF NOT EXISTS idx_books_txns_acct ON books_bank_txns(bank_account_id, status, date);
    CREATE TABLE IF NOT EXISTS books_expenses (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'draft',
      date TEXT NOT NULL,
      contact_id TEXT,
      vendor TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      account_id TEXT,
      paid_from_id TEXT,
      currency TEXT NOT NULL,
      fx_rate TEXT NOT NULL DEFAULT '1',
      total INTEGER NOT NULL DEFAULT 0,
      tax_rate_id TEXT,
      tax INTEGER NOT NULL DEFAULT 0,
      receipt_url TEXT,
      receipt_mime TEXT,
      receipt_name TEXT,
      ai_data TEXT,
      journal_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_expenses_ws ON books_expenses(workspace_id, date);
    CREATE TABLE IF NOT EXISTS books_recurring (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      template TEXT NOT NULL,
      frequency TEXT NOT NULL,
      interval_count INTEGER NOT NULL DEFAULT 1,
      next_date TEXT NOT NULL,
      end_date TEXT,
      auto_send INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      last_doc_id TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      claimed_until TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_recurring_due ON books_recurring(status, next_date);
    CREATE TABLE IF NOT EXISTS books_purchase_orders (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      contact_id TEXT,
      issue_date TEXT NOT NULL,
      expected_date TEXT,
      currency TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL DEFAULT 0,
      bill_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (workspace_id, number)
    );
    CREATE TABLE IF NOT EXISTS books_po_lines (
      id TEXT PRIMARY KEY,
      po_id TEXT NOT NULL REFERENCES books_purchase_orders(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      item_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 1,
      received_qty REAL NOT NULL DEFAULT 0,
      unit_cost INTEGER NOT NULL DEFAULT 0,
      tax_rate_id TEXT,
      tax_bps INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_books_po_lines ON books_po_lines(po_id, position);
    CREATE TABLE IF NOT EXISTS books_stock_moves (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      reason TEXT NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_stock_item ON books_stock_moves(item_id, created_at);
    CREATE TABLE IF NOT EXISTS books_audit (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      person_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_books_audit_ws ON books_audit(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_books_audit_entity ON books_audit(entity_id);
    CREATE TABLE IF NOT EXISTS books_webhook_events (
      provider TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider, workspace_id, event_id)
    );

    -- Asientos: nunca se editan (se revierten con otro asiento).
    CREATE TRIGGER IF NOT EXISTS books_jl_no_update BEFORE UPDATE ON books_journal_lines
    BEGIN SELECT RAISE(ABORT, 'books_journal_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS books_journal_no_update BEFORE UPDATE OF date, number, source_type, source_id, reversal_of ON books_journals
    BEGIN SELECT RAISE(ABORT, 'books_journal_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS books_jl_no_delete BEFORE DELETE ON books_journal_lines
    WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.workspace_id)
    BEGIN SELECT RAISE(ABORT, 'books_journal_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS books_journal_no_delete BEFORE DELETE ON books_journals
    WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.workspace_id)
    BEGIN SELECT RAISE(ABORT, 'books_journal_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS books_doc_no_redraft BEFORE UPDATE OF status ON books_documents
    WHEN OLD.status != 'draft' AND NEW.status = 'draft'
    BEGIN SELECT RAISE(ABORT, 'books_document_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS books_doc_posted_no_delete BEFORE DELETE ON books_documents
    WHEN OLD.status != 'draft' AND EXISTS (SELECT 1 FROM users WHERE id = OLD.workspace_id)
    BEGIN SELECT RAISE(ABORT, 'books_document_immutable'); END;
    -- Documentos emitidos: importes, moneda, contacto y fecha quedan fijos.
    CREATE TRIGGER IF NOT EXISTS books_doc_posted_fixed BEFORE UPDATE OF subtotal, discount_total, tax_total, total, currency, fx_rate, contact_id, issue_date, doc_type, number, series_id ON books_documents
    WHEN OLD.status != 'draft'
    BEGIN SELECT RAISE(ABORT, 'books_document_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS books_lines_posted_insert BEFORE INSERT ON books_lines
    WHEN (SELECT status FROM books_documents WHERE id = NEW.doc_id) != 'draft'
    BEGIN SELECT RAISE(ABORT, 'books_document_immutable'); END;
    CREATE TRIGGER IF NOT EXISTS books_lines_posted_update BEFORE UPDATE ON books_lines
    WHEN (SELECT status FROM books_documents WHERE id = OLD.doc_id) != 'draft'
    BEGIN SELECT RAISE(ABORT, 'books_document_immutable'); END;
  `);
}
