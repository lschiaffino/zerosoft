/**
 * Books: configuración, plan de cuentas, impuestos, series, contactos,
 * ítems, roles y registro de auditoría. Server-only.
 *
 * El primer acceso arma Books con la plantilla del país (plan de cuentas,
 * tasas y series). Todo lo de acá respeta el rol de Books (lib/books-roles.ts)
 * además del acceso por app que ya chequearon las rutas.
 */
import { getDb } from './db';
import { can, effectiveRole, isBooksRole, type BooksPermission, type BooksRole } from './books-roles';
import { BooksError, clean, likeEsc, newId, newToken, nowDb, parseJson, type BooksActor, type ContactKind, CONTACT_KINDS, type DocType } from './books-schema';
import { accountTemplate, ACCOUNT_TYPES, BOOKS_COUNTRIES, defaultCurrency, taxTemplate, type AccountType, type BooksCountry, type SystemKey } from './books-templates';
import { CURRENCY_RE, isValidDate, normalizeQuantity, parseAmount } from './books-money';
import { AR_TAX_CONDITIONS, normalizeTaxId, TAX_ID_TYPES, taxIdTypeFor, validateTaxId, type TaxIdType } from './books-taxid';

// ---------- Filas ----------

export interface SettingsRow {
  workspace_id: string;
  country: string;
  base_currency: string;
  legal_name: string;
  trade_name: string;
  tax_id: string;
  tax_condition: string;
  address: string;
  email: string;
  phone: string;
  logo_url: string | null;
  brand_color: string;
  footer: string;
  terms_days: number;
  reminders: string;
  payments: string;
  einvoice: string;
  shop_auto_post: number;
  shop_auto_post_since: string | null;
  crm_sync: number;
  lock_date: string | null;
  webhook_token: string;
  next_journal: number;
  next_po: number;
  created_at: string;
  updated_at: string;
}

export interface AccountRow {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  system_key: SystemKey | null;
  archived: number;
}

export interface TaxRateRow {
  id: string;
  workspace_id: string;
  name: string;
  code: string;
  rate_bps: number;
  scope: string;
  is_default: number;
  archived: number;
}

export interface SeriesRow {
  id: string;
  workspace_id: string;
  doc_type: DocType;
  name: string;
  letter: string;
  point_of_sale: number;
  next_number: number;
  is_default: number;
  archived: number;
}

export interface ContactRow {
  id: string;
  workspace_id: string;
  kind: ContactKind;
  name: string;
  email: string;
  phone: string;
  tax_id: string;
  tax_id_type: string;
  tax_condition: string;
  address: string;
  country: string;
  currency: string | null;
  terms_days: number | null;
  notes: string;
  crm_company_id: string | null;
  crm_contact_id: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface ItemRow {
  id: string;
  workspace_id: string;
  kind: 'product' | 'service';
  name: string;
  sku: string;
  description: string;
  unit: string;
  price: number;
  cost: number;
  tax_rate_id: string | null;
  sales_account_id: string | null;
  purchase_account_id: string | null;
  track_stock: number;
  stock_qty: number;
  shop_variant_id: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

// ---------- Actor y permisos ----------

export async function storedRole(ws: string, personId: string): Promise<BooksRole | null> {
  const row = (await getDb().prepare('SELECT role FROM books_roles WHERE workspace_id = ? AND person_id = ?').get(ws, personId)) as { role: string } | undefined;
  return row && isBooksRole(row.role) ? row.role : null;
}

/** Actor de Books para una sesión (workspace, persona, rol del workspace). */
export async function booksActor(input: { ws: string; person: string; workspaceRole: string | null | undefined }): Promise<BooksActor> {
  const wsRole = input.workspaceRole ?? 'owner';
  const admin = wsRole === 'owner' || wsRole === 'admin';
  const stored = admin || input.person === input.ws ? null : await storedRole(input.ws, input.person);
  return { ws: input.ws, person: input.person, admin, role: effectiveRole(input.person === input.ws ? 'owner' : wsRole, stored) };
}

export function assertCan(actor: BooksActor, perm: BooksPermission): void {
  if (!can(actor.role, perm)) throw new BooksError('forbidden', 403, { need: perm });
}

export async function setRole(actor: BooksActor, personId: string, role: BooksRole): Promise<void> {
  if (!actor.admin) throw new BooksError('forbidden', 403);
  if (!isBooksRole(role)) throw new BooksError('invalid_role');
  if (personId === actor.ws) throw new BooksError('owner_is_accountant');
  const { personAppAccess } = await import('./api-auth');
  if (!(await personAppAccess(actor.ws, personId).catch(() => null))) throw new BooksError('not_a_member', 404);
  await getDb()
    .prepare('INSERT INTO books_roles (workspace_id, person_id, role, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, person_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at')
    .run(actor.ws, personId, role, nowDb());
  await audit(actor, 'role.set', 'person', personId, role);
}

export async function listRoles(ws: string): Promise<Array<{ personId: string; role: BooksRole }>> {
  const rows = (await getDb().prepare('SELECT person_id, role FROM books_roles WHERE workspace_id = ?').all(ws)) as Array<{ person_id: string; role: string }>;
  return rows.filter((r) => isBooksRole(r.role)).map((r) => ({ personId: r.person_id, role: r.role as BooksRole }));
}

// ---------- Auditoría ----------

export async function audit(actor: Pick<BooksActor, 'ws' | 'person'> | { ws: string; person: string | null }, action: string, entityType: string, entityId: string | null, detail = ''): Promise<void> {
  await getDb()
    .prepare('INSERT INTO books_audit (id, workspace_id, person_id, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId('aud'), actor.ws, actor.person, action, entityType, entityId, detail.slice(0, 500), nowDb());
}

export interface AuditEntry {
  id: string;
  personId: string | null;
  personName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: string;
  createdAt: string;
}

export async function listAudit(ws: string, opts: { entityId?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT a.*, u.name AS person_name FROM books_audit a LEFT JOIN users u ON u.id = a.person_id
       WHERE a.workspace_id = ?${opts.entityId ? ' AND a.entity_id = ?' : ''} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    )
    .all(...(opts.entityId ? [ws, opts.entityId, opts.limit ?? 100] : [ws, opts.limit ?? 100]))) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    personId: (r.person_id as string) ?? null,
    personName: (r.person_name as string) ?? null,
    action: String(r.action),
    entityType: String(r.entity_type),
    entityId: (r.entity_id as string) ?? null,
    detail: String(r.detail ?? ''),
    createdAt: String(r.created_at),
  }));
}

// ---------- Configuración ----------

function guessCountry(locale?: string): BooksCountry {
  return locale === 'es' ? 'AR' : 'generic';
}

/** Arma Books la primera vez (idempotente): plan de cuentas, impuestos y series del país. */
export async function ensureBooks(ws: string, opts: { country?: BooksCountry; locale?: string } = {}): Promise<SettingsRow> {
  const db = getDb();
  const existing = (await db.prepare('SELECT * FROM books_settings WHERE workspace_id = ?').get(ws)) as SettingsRow | undefined;
  if (existing) return existing;
  const country = opts.country ?? guessCountry(opts.locale);
  const ts = nowDb();
  const user = (await db.prepare('SELECT name, email FROM users WHERE id = ?').get(ws)) as { name: string | null; email: string } | undefined;
  const ins = await db
    .prepare(
      `INSERT OR IGNORE INTO books_settings (workspace_id, country, base_currency, legal_name, email, webhook_token, tax_condition, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(ws, country, defaultCurrency(country), user?.name ?? '', user?.email ?? '', newToken(), country === 'AR' ? 'ri' : '', ts, ts);
  if (ins.changes) await seedTemplates(ws, country);
  return (await db.prepare('SELECT * FROM books_settings WHERE workspace_id = ?').get(ws)) as SettingsRow;
}

async function seedTemplates(ws: string, country: BooksCountry): Promise<void> {
  const db = getDb();
  const ts = nowDb();
  for (const a of accountTemplate(country)) {
    await db
      .prepare('INSERT OR IGNORE INTO books_accounts (id, workspace_id, code, name, type, subtype, system_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('acc'), ws, a.code, a.name, a.type, a.subtype, a.key ?? null, ts, ts);
  }
  for (const t of taxTemplate(country)) {
    await db
      .prepare('INSERT INTO books_tax_rates (id, workspace_id, name, code, rate_bps, scope, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('tax'), ws, t.name, t.code, t.rateBps, 'both', t.isDefault ? 1 : 0, ts);
  }
  // Series: AR por letra (A, B, C) del punto de venta 1; el resto, una por tipo.
  const series: Array<{ type: DocType; name: string; letter: string; def: boolean }> =
    country === 'AR'
      ? [
          { type: 'invoice', name: 'Factura A', letter: 'A', def: false },
          { type: 'invoice', name: 'Factura B', letter: 'B', def: true },
          { type: 'invoice', name: 'Factura C', letter: 'C', def: false },
          { type: 'credit_note', name: 'Nota de crédito A', letter: 'A', def: false },
          { type: 'credit_note', name: 'Nota de crédito B', letter: 'B', def: true },
          { type: 'credit_note', name: 'Nota de crédito C', letter: 'C', def: false },
        ]
      : [
          { type: 'invoice', name: country === 'MX' ? 'Factura' : 'Invoice', letter: '', def: true },
          { type: 'credit_note', name: country === 'MX' ? 'Nota de crédito' : 'Credit note', letter: '', def: true },
        ];
  for (const s of series) {
    await db
      .prepare('INSERT OR IGNORE INTO books_series (id, workspace_id, doc_type, name, letter, point_of_sale, next_number, is_default, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)')
      .run(newId('ser'), ws, s.type, s.name, s.letter, s.def ? 1 : 0, ts);
  }
  // Un banco y la caja como cuentas bancarias.
  const bank = (await db.prepare("SELECT id, name FROM books_accounts WHERE workspace_id = ? AND system_key = 'bank'").get(ws)) as { id: string; name: string };
  const cash = (await db.prepare("SELECT id, name FROM books_accounts WHERE workspace_id = ? AND system_key = 'cash'").get(ws)) as { id: string; name: string };
  const cur = defaultCurrency(country);
  for (const a of [bank, cash]) {
    await db
      .prepare('INSERT INTO books_bank_accounts (id, workspace_id, account_id, name, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId('bnk'), ws, a.id, a.name, cur, ts, ts);
  }
}

export interface ReminderSettings {
  enabled: boolean;
  /** Días después del vencimiento en que sale cada recordatorio. */
  days: number[];
}

export function reminderSettings(s: Pick<SettingsRow, 'reminders'>): ReminderSettings {
  const r = parseJson<Partial<ReminderSettings>>(s.reminders, {});
  const days = Array.isArray(r.days) ? [...new Set(r.days.map((d) => Math.trunc(Number(d))).filter((d) => d >= 0 && d <= 365))].sort((a, b) => a - b).slice(0, 5) : [3, 10, 30];
  return { enabled: r.enabled !== false, days };
}

export interface SettingsDto {
  country: BooksCountry;
  baseCurrency: string;
  legalName: string;
  tradeName: string;
  taxId: string;
  taxCondition: string;
  address: string;
  email: string;
  phone: string;
  logoUrl: string | null;
  brandColor: string;
  footer: string;
  termsDays: number;
  reminders: ReminderSettings;
  shopAutoPost: boolean;
  crmSync: boolean;
  lockDate: string | null;
}

export function settingsDto(s: SettingsRow): SettingsDto {
  return {
    country: (BOOKS_COUNTRIES as readonly string[]).includes(s.country) ? (s.country as BooksCountry) : 'generic',
    baseCurrency: s.base_currency,
    legalName: s.legal_name,
    tradeName: s.trade_name,
    taxId: s.tax_id,
    taxCondition: s.tax_condition,
    address: s.address,
    email: s.email,
    phone: s.phone,
    logoUrl: s.logo_url,
    brandColor: s.brand_color,
    footer: s.footer,
    termsDays: s.terms_days,
    reminders: reminderSettings(s),
    shopAutoPost: s.shop_auto_post === 1,
    crmSync: s.crm_sync === 1,
    lockDate: s.lock_date,
  };
}

export interface SettingsPatch {
  legalName?: string;
  tradeName?: string;
  taxId?: string;
  taxCondition?: string;
  address?: string;
  email?: string;
  phone?: string;
  logoUrl?: string | null;
  brandColor?: string;
  footer?: string;
  termsDays?: number;
  reminders?: Partial<ReminderSettings>;
  shopAutoPost?: boolean;
  crmSync?: boolean;
  lockDate?: string | null;
  baseCurrency?: string;
}

export async function updateSettings(actor: BooksActor, patch: SettingsPatch): Promise<SettingsDto> {
  assertCan(actor, 'settings.write');
  const s = await ensureBooks(actor.ws);
  const db = getDb();
  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (patch.legalName !== undefined) set('legal_name', clean(patch.legalName, 160));
  if (patch.tradeName !== undefined) set('trade_name', clean(patch.tradeName, 160));
  if (patch.taxId !== undefined) {
    const type = taxIdTypeFor(s.country === 'generic' ? '' : s.country);
    const v = clean(patch.taxId, 40);
    if (!validateTaxId(type, v)) throw new BooksError('invalid_tax_id');
    set('tax_id', normalizeTaxId(type, v));
  }
  if (patch.taxCondition !== undefined) {
    if (patch.taxCondition && s.country === 'AR' && !(AR_TAX_CONDITIONS as readonly string[]).includes(patch.taxCondition)) throw new BooksError('invalid_tax_condition');
    set('tax_condition', clean(patch.taxCondition, 40));
  }
  if (patch.address !== undefined) set('address', clean(patch.address, 400));
  if (patch.email !== undefined) {
    const e = clean(patch.email, 200);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new BooksError('invalid_email');
    set('email', e);
  }
  if (patch.phone !== undefined) set('phone', clean(patch.phone, 40));
  if (patch.logoUrl !== undefined) {
    const u = patch.logoUrl ? clean(patch.logoUrl, 500) : null;
    if (u && !/^(https:\/\/|\/uploads\/)/.test(u)) throw new BooksError('invalid_logo');
    set('logo_url', u);
  }
  if (patch.brandColor !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(patch.brandColor)) throw new BooksError('invalid_color');
    set('brand_color', patch.brandColor);
  }
  if (patch.footer !== undefined) set('footer', clean(patch.footer, 1000));
  if (patch.termsDays !== undefined) set('terms_days', Math.max(0, Math.min(365, Math.trunc(Number(patch.termsDays) || 0))));
  if (patch.reminders !== undefined) {
    const cur = reminderSettings(s);
    set('reminders', JSON.stringify(reminderSettings({ reminders: JSON.stringify({ ...cur, ...patch.reminders }) })));
  }
  if (patch.shopAutoPost !== undefined) {
    set('shop_auto_post', patch.shopAutoPost ? 1 : 0);
    // Desde cuándo: al activarlo no se registran de golpe los pedidos viejos.
    if (patch.shopAutoPost && !s.shop_auto_post) set('shop_auto_post_since', nowDb());
  }
  if (patch.crmSync !== undefined) set('crm_sync', patch.crmSync ? 1 : 0);
  if (patch.lockDate !== undefined && patch.lockDate !== s.lock_date) {
    // El cierre de período lo mueven solo owner y admins, y queda en la auditoría con el valor anterior.
    if (!actor.admin) throw new BooksError('forbidden', 403, { need: 'admin' });
    if (patch.lockDate !== null && !isValidDate(patch.lockDate)) throw new BooksError('invalid_date');
    set('lock_date', patch.lockDate);
    await audit(actor, 'settings.lock_date', 'settings', null, `${s.lock_date ?? 'none'} -> ${patch.lockDate ?? 'none'}`);
  }
  if (patch.baseCurrency !== undefined) {
    const c = patch.baseCurrency.toUpperCase();
    if (!CURRENCY_RE.test(c)) throw new BooksError('invalid_currency');
    if (c !== s.base_currency) {
      const used = await db.prepare('SELECT 1 AS x FROM books_journals WHERE workspace_id = ? LIMIT 1').get(actor.ws);
      if (used) throw new BooksError('base_currency_locked', 409);
      set('base_currency', c);
    }
  }
  if (sets.length) {
    set('updated_at', nowDb());
    await db.prepare(`UPDATE books_settings SET ${sets.join(', ')} WHERE workspace_id = ?`).run(...args, actor.ws);
    await audit(actor, 'settings.update', 'settings', null, Object.keys(patch).join(','));
  }
  return settingsDto((await ensureBooks(actor.ws))!);
}

/** Cambiar de país rearma las plantillas: solo antes del primer asiento. */
export async function resetCountry(actor: BooksActor, country: BooksCountry): Promise<SettingsDto> {
  assertCan(actor, 'settings.write');
  if (!actor.admin) throw new BooksError('forbidden', 403);
  if (!(BOOKS_COUNTRIES as readonly string[]).includes(country)) throw new BooksError('invalid_country');
  await ensureBooks(actor.ws);
  const db = getDb();
  const used = await db.prepare('SELECT 1 AS x FROM books_documents WHERE workspace_id = ? LIMIT 1').get(actor.ws);
  const posted = await db.prepare('SELECT 1 AS x FROM books_journals WHERE workspace_id = ? LIMIT 1').get(actor.ws);
  if (used || posted) throw new BooksError('country_locked', 409);
  for (const t of ['books_bank_accounts', 'books_series', 'books_tax_rates', 'books_accounts']) await db.prepare(`DELETE FROM ${t} WHERE workspace_id = ?`).run(actor.ws);
  await db
    .prepare('UPDATE books_settings SET country = ?, base_currency = ?, tax_condition = ?, tax_id = ?, updated_at = ? WHERE workspace_id = ?')
    .run(country, defaultCurrency(country), country === 'AR' ? 'ri' : '', '', nowDb(), actor.ws);
  await seedTemplates(actor.ws, country);
  await audit(actor, 'settings.country', 'settings', null, country);
  return settingsDto((await ensureBooks(actor.ws))!);
}

// ---------- Cuentas ----------

export async function listAccounts(ws: string, opts: { includeArchived?: boolean } = {}): Promise<AccountRow[]> {
  await ensureBooks(ws);
  return (await getDb()
    .prepare(`SELECT * FROM books_accounts WHERE workspace_id = ?${opts.includeArchived ? '' : ' AND archived = 0'} ORDER BY code ASC`)
    .all(ws)) as AccountRow[];
}

export async function accountByKey(ws: string, key: SystemKey): Promise<AccountRow> {
  const find = async () => (await getDb().prepare('SELECT * FROM books_accounts WHERE workspace_id = ? AND system_key = ?').get(ws, key)) as AccountRow | undefined;
  const row = await find();
  if (row) return row;
  // Una cuenta de sistema que la plantilla sumó después de armar el workspace: se crea con el código de la plantilla.
  const s = await ensureBooks(ws);
  const tpl = accountTemplate((BOOKS_COUNTRIES as readonly string[]).includes(s.country) ? (s.country as BooksCountry) : 'generic').find((a) => a.key === key);
  if (tpl) {
    const taken = await getDb().prepare('SELECT 1 AS x FROM books_accounts WHERE workspace_id = ? AND code = ?').get(ws, tpl.code);
    const ts = nowDb();
    await getDb()
      .prepare('INSERT OR IGNORE INTO books_accounts (id, workspace_id, code, name, type, subtype, system_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('acc'), ws, taken ? `${tpl.code}-${key}` : tpl.code, tpl.name, tpl.type, tpl.subtype, key, ts, ts);
  }
  const again = await find();
  if (!again) throw new BooksError('missing_system_account', 500, { key });
  return again;
}

export async function getAccount(ws: string, id: string): Promise<AccountRow | null> {
  return ((await getDb().prepare('SELECT * FROM books_accounts WHERE id = ? AND workspace_id = ?').get(id, ws)) as AccountRow | undefined) ?? null;
}

export async function createAccount(actor: BooksActor, input: { code: string; name: string; type: AccountType; subtype?: string }): Promise<AccountRow> {
  assertCan(actor, 'accounting.write');
  await ensureBooks(actor.ws);
  const code = clean(input.code, 20);
  const name = clean(input.name, 120);
  if (!code || !name) throw new BooksError('invalid_input');
  if (!(ACCOUNT_TYPES as readonly string[]).includes(input.type)) throw new BooksError('invalid_type');
  const id = newId('acc');
  const ts = nowDb();
  try {
    await getDb()
      .prepare('INSERT INTO books_accounts (id, workspace_id, code, name, type, subtype, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, actor.ws, code, name, input.type, clean(input.subtype ?? (input.type === 'expense' ? 'expense' : 'other'), 20) || 'other', ts, ts);
  } catch {
    throw new BooksError('duplicate_code', 409);
  }
  await audit(actor, 'account.create', 'account', id, `${code} ${name}`);
  return (await getAccount(actor.ws, id))!;
}

export async function updateAccount(actor: BooksActor, id: string, patch: { code?: string; name?: string; archived?: boolean }): Promise<AccountRow> {
  assertCan(actor, 'accounting.write');
  const acc = await getAccount(actor.ws, id);
  if (!acc) throw new BooksError('not_found', 404);
  if (patch.archived && acc.system_key) throw new BooksError('system_account', 409);
  const code = patch.code !== undefined ? clean(patch.code, 20) : acc.code;
  const name = patch.name !== undefined ? clean(patch.name, 120) : acc.name;
  if (!code || !name) throw new BooksError('invalid_input');
  try {
    await getDb()
      .prepare('UPDATE books_accounts SET code = ?, name = ?, archived = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .run(code, name, patch.archived === undefined ? acc.archived : patch.archived ? 1 : 0, nowDb(), id, actor.ws);
  } catch {
    throw new BooksError('duplicate_code', 409);
  }
  await audit(actor, 'account.update', 'account', id, `${code} ${name}`);
  return (await getAccount(actor.ws, id))!;
}

/** Borra una cuenta sin movimientos ni rol de sistema. */
export async function deleteAccount(actor: BooksActor, id: string): Promise<void> {
  assertCan(actor, 'accounting.write');
  const acc = await getAccount(actor.ws, id);
  if (!acc) throw new BooksError('not_found', 404);
  if (acc.system_key) throw new BooksError('system_account', 409);
  const used = await getDb().prepare('SELECT 1 AS x FROM books_journal_lines WHERE account_id = ? LIMIT 1').get(id);
  const bank = await getDb().prepare('SELECT 1 AS x FROM books_bank_accounts WHERE account_id = ? LIMIT 1').get(id);
  if (used || bank) throw new BooksError('account_in_use', 409);
  await getDb().prepare('DELETE FROM books_accounts WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  await audit(actor, 'account.delete', 'account', id, `${acc.code} ${acc.name}`);
}

// ---------- Impuestos ----------

export async function listTaxRates(ws: string, opts: { includeArchived?: boolean } = {}): Promise<TaxRateRow[]> {
  await ensureBooks(ws);
  return (await getDb()
    .prepare(`SELECT * FROM books_tax_rates WHERE workspace_id = ?${opts.includeArchived ? '' : ' AND archived = 0'} ORDER BY rate_bps DESC, name ASC`)
    .all(ws)) as TaxRateRow[];
}

export async function getTaxRate(ws: string, id: string | null | undefined): Promise<TaxRateRow | null> {
  if (!id) return null;
  return ((await getDb().prepare('SELECT * FROM books_tax_rates WHERE id = ? AND workspace_id = ?').get(id, ws)) as TaxRateRow | undefined) ?? null;
}

export async function saveTaxRate(actor: BooksActor, input: { id?: string; name: string; code?: string; rateBps: number; isDefault?: boolean; archived?: boolean }): Promise<TaxRateRow> {
  assertCan(actor, 'settings.write');
  await ensureBooks(actor.ws);
  const name = clean(input.name, 80);
  const bps = Math.trunc(Number(input.rateBps));
  if (!name || !Number.isFinite(bps) || bps < 0 || bps > 10_000) throw new BooksError('invalid_input');
  const db = getDb();
  if (input.isDefault) await db.prepare('UPDATE books_tax_rates SET is_default = 0 WHERE workspace_id = ?').run(actor.ws);
  if (input.id) {
    const cur = await getTaxRate(actor.ws, input.id);
    if (!cur) throw new BooksError('not_found', 404);
    // La tasa de una tasa usada no cambia: las líneas guardan su propia copia, pero el nombre debe seguir diciendo la verdad.
    if (cur.rate_bps !== bps) {
      const used = await db.prepare('SELECT 1 AS x FROM books_lines WHERE tax_rate_id = ? LIMIT 1').get(cur.id);
      if (used) throw new BooksError('tax_rate_in_use', 409);
    }
    await db
      .prepare('UPDATE books_tax_rates SET name = ?, code = ?, rate_bps = ?, is_default = ?, archived = ? WHERE id = ? AND workspace_id = ?')
      .run(name, clean(input.code ?? cur.code, 20), bps, input.isDefault === undefined ? cur.is_default : input.isDefault ? 1 : 0, input.archived === undefined ? cur.archived : input.archived ? 1 : 0, cur.id, actor.ws);
    await audit(actor, 'tax.update', 'tax_rate', cur.id, name);
    return (await getTaxRate(actor.ws, cur.id))!;
  }
  const id = newId('tax');
  await db
    .prepare('INSERT INTO books_tax_rates (id, workspace_id, name, code, rate_bps, scope, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, actor.ws, name, clean(input.code ?? '', 20), bps, 'both', input.isDefault ? 1 : 0, nowDb());
  await audit(actor, 'tax.create', 'tax_rate', id, name);
  return (await getTaxRate(actor.ws, id))!;
}

// ---------- Series ----------

export async function listSeries(ws: string, docType?: DocType): Promise<SeriesRow[]> {
  await ensureBooks(ws);
  return (await getDb()
    .prepare(`SELECT * FROM books_series WHERE workspace_id = ? AND archived = 0${docType ? ' AND doc_type = ?' : ''} ORDER BY doc_type, point_of_sale, letter`)
    .all(...(docType ? [ws, docType] : [ws]))) as SeriesRow[];
}

export async function getSeries(ws: string, id: string | null | undefined): Promise<SeriesRow | null> {
  if (!id) return null;
  return ((await getDb().prepare('SELECT * FROM books_series WHERE id = ? AND workspace_id = ?').get(id, ws)) as SeriesRow | undefined) ?? null;
}

export async function defaultSeries(ws: string, docType: DocType, letter?: string): Promise<SeriesRow | null> {
  const all = await listSeries(ws, docType);
  if (letter) {
    const byLetter = all.filter((s) => s.letter === letter);
    if (byLetter.length) return byLetter.find((s) => s.is_default) ?? byLetter[0];
  }
  return all.find((s) => s.is_default) ?? all[0] ?? null;
}

export async function saveSeries(
  actor: BooksActor,
  input: { id?: string; docType: DocType; name: string; letter?: string; pointOfSale: number; nextNumber?: number; isDefault?: boolean; archived?: boolean },
): Promise<SeriesRow> {
  assertCan(actor, 'settings.write');
  await ensureBooks(actor.ws);
  const name = clean(input.name, 80);
  const pos = Math.trunc(Number(input.pointOfSale));
  const letter = clean(input.letter ?? '', 3).toUpperCase();
  if (!name || !(pos >= 1 && pos <= 99_999) || !['invoice', 'credit_note'].includes(input.docType)) throw new BooksError('invalid_input');
  const db = getDb();
  if (input.isDefault) await db.prepare('UPDATE books_series SET is_default = 0 WHERE workspace_id = ? AND doc_type = ?').run(actor.ws, input.docType);
  if (input.id) {
    const cur = await getSeries(actor.ws, input.id);
    if (!cur) throw new BooksError('not_found', 404);
    const next = input.nextNumber !== undefined ? Math.trunc(Number(input.nextNumber)) : cur.next_number;
    // La numeración solo avanza: nunca vuelve a un número ya emitido.
    const maxRow = (await db.prepare('SELECT MAX(number) AS m FROM books_documents WHERE series_id = ?').get(cur.id)) as { m: number | null };
    if (!(next >= 1) || next <= Number(maxRow.m ?? 0)) throw new BooksError('number_already_used', 409);
    const used = maxRow.m != null;
    if (used && (letter !== cur.letter || pos !== cur.point_of_sale)) throw new BooksError('series_in_use', 409);
    try {
      await db
        .prepare('UPDATE books_series SET name = ?, letter = ?, point_of_sale = ?, next_number = ?, is_default = ?, archived = ? WHERE id = ? AND workspace_id = ?')
        .run(name, letter, pos, next, input.isDefault === undefined ? cur.is_default : input.isDefault ? 1 : 0, input.archived ? 1 : 0, cur.id, actor.ws);
    } catch {
      throw new BooksError('duplicate_series', 409);
    }
    await audit(actor, 'series.update', 'series', cur.id, name);
    return (await getSeries(actor.ws, cur.id))!;
  }
  const id = newId('ser');
  try {
    await db
      .prepare('INSERT INTO books_series (id, workspace_id, doc_type, name, letter, point_of_sale, next_number, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, actor.ws, input.docType, name, letter, pos, Math.max(1, Math.trunc(Number(input.nextNumber ?? 1))), input.isDefault ? 1 : 0, nowDb());
  } catch {
    throw new BooksError('duplicate_series', 409);
  }
  await audit(actor, 'series.create', 'series', id, name);
  return (await getSeries(actor.ws, id))!;
}

// ---------- Contactos ----------

export interface ContactInput {
  kind?: ContactKind;
  name?: string;
  email?: string;
  phone?: string;
  taxId?: string;
  taxIdType?: TaxIdType;
  taxCondition?: string;
  address?: string;
  country?: string;
  currency?: string | null;
  termsDays?: number | null;
  notes?: string;
  crmCompanyId?: string | null;
  crmContactId?: string | null;
}

export interface ContactDto {
  id: string;
  kind: ContactKind;
  name: string;
  email: string;
  phone: string;
  taxId: string;
  taxIdType: string;
  taxCondition: string;
  address: string;
  country: string;
  currency: string | null;
  termsDays: number | null;
  notes: string;
  crmCompanyId: string | null;
  crmContactId: string | null;
  archived: boolean;
  receivable?: number;
  payable?: number;
  updatedAt: string;
}

export function contactDto(r: ContactRow): ContactDto {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    email: r.email,
    phone: r.phone,
    taxId: r.tax_id,
    taxIdType: r.tax_id_type,
    taxCondition: r.tax_condition,
    address: r.address,
    country: r.country,
    currency: r.currency,
    termsDays: r.terms_days,
    notes: r.notes,
    crmCompanyId: r.crm_company_id,
    crmContactId: r.crm_contact_id,
    archived: r.archived === 1,
    updatedAt: r.updated_at,
  };
}

function contactFields(input: ContactInput, current?: ContactRow) {
  const kind = input.kind ?? current?.kind ?? 'customer';
  if (!(CONTACT_KINDS as readonly string[]).includes(kind)) throw new BooksError('invalid_kind');
  const name = input.name !== undefined ? clean(input.name, 160) : (current?.name ?? '');
  if (!name) throw new BooksError('invalid_name');
  const email = input.email !== undefined ? clean(input.email, 200).toLowerCase() : (current?.email ?? '');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BooksError('invalid_email');
  const country = (input.country !== undefined ? clean(input.country, 2) : (current?.country ?? '')).toUpperCase();
  if (country && !/^[A-Z]{2}$/.test(country)) throw new BooksError('invalid_country');
  const typeRaw = input.taxIdType ?? (current?.tax_id_type as TaxIdType | undefined) ?? taxIdTypeFor(country);
  const taxIdType = (TAX_ID_TYPES as readonly string[]).includes(typeRaw) ? typeRaw : 'other';
  const taxIdRaw = input.taxId !== undefined ? clean(input.taxId, 40) : (current?.tax_id ?? '');
  if (!validateTaxId(taxIdType, taxIdRaw)) throw new BooksError('invalid_tax_id', 400, { type: taxIdType });
  const taxCondition = input.taxCondition !== undefined ? clean(input.taxCondition, 40) : (current?.tax_condition ?? '');
  if (taxCondition && country === 'AR' && !(AR_TAX_CONDITIONS as readonly string[]).includes(taxCondition)) throw new BooksError('invalid_tax_condition');
  const currency = input.currency !== undefined ? (input.currency ? input.currency.toUpperCase() : null) : (current?.currency ?? null);
  if (currency && !CURRENCY_RE.test(currency)) throw new BooksError('invalid_currency');
  const terms = input.termsDays !== undefined ? (input.termsDays === null ? null : Math.max(0, Math.min(365, Math.trunc(Number(input.termsDays) || 0)))) : (current?.terms_days ?? null);
  return {
    kind,
    name,
    email,
    phone: input.phone !== undefined ? clean(input.phone, 40) : (current?.phone ?? ''),
    taxId: normalizeTaxId(taxIdType, taxIdRaw),
    taxIdType: taxIdRaw ? taxIdType : '',
    taxCondition,
    address: input.address !== undefined ? clean(input.address, 400) : (current?.address ?? ''),
    country,
    currency,
    terms,
    notes: input.notes !== undefined ? clean(input.notes, 2000) : (current?.notes ?? ''),
  };
}

export async function getContactRow(ws: string, id: string | null | undefined): Promise<ContactRow | null> {
  if (!id) return null;
  return ((await getDb().prepare('SELECT * FROM books_contacts WHERE id = ? AND workspace_id = ?').get(id, ws)) as ContactRow | undefined) ?? null;
}

export async function getContact(ws: string, id: string): Promise<ContactDto | null> {
  const r = await getContactRow(ws, id);
  if (!r) return null;
  const dto = contactDto(r);
  const bal = (await getDb()
    .prepare(
      `SELECT doc_type, SUM(total - paid_total - credited_total) AS due FROM books_documents
       WHERE workspace_id = ? AND contact_id = ? AND status IN ('sent','partial','overdue') GROUP BY doc_type`,
    )
    .all(ws, id)) as Array<{ doc_type: string; due: number }>;
  dto.receivable = Number(bal.find((b) => b.doc_type === 'invoice')?.due ?? 0);
  dto.payable = Number(bal.find((b) => b.doc_type === 'bill')?.due ?? 0);
  return dto;
}

export async function listContacts(ws: string, opts: { q?: string; kind?: string; includeArchived?: boolean; limit?: number } = {}): Promise<ContactDto[]> {
  await ensureBooks(ws);
  const where = ['workspace_id = ?'];
  const args: Array<string | number> = [ws];
  if (!opts.includeArchived) where.push('archived = 0');
  if (opts.kind === 'customer') where.push("kind IN ('customer','both')");
  if (opts.kind === 'supplier') where.push("kind IN ('supplier','both')");
  if (opts.q?.trim()) {
    const l = likeEsc(opts.q.trim());
    where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR tax_id LIKE ? ESCAPE '\\')");
    args.push(l, l, l);
  }
  const rows = (await getDb()
    .prepare(`SELECT * FROM books_contacts WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE ASC LIMIT ?`)
    .all(...args, Math.min(opts.limit ?? 500, 2000))) as ContactRow[];
  return rows.map(contactDto);
}

export async function createContact(actor: BooksActor, input: ContactInput, opts: { syncCrm?: boolean } = {}): Promise<ContactDto> {
  assertCan(actor, 'contacts.write');
  const s = await ensureBooks(actor.ws);
  const f = contactFields(input);
  const id = newId('con');
  const ts = nowDb();
  await getDb()
    .prepare(
      `INSERT INTO books_contacts (id, workspace_id, kind, name, email, phone, tax_id, tax_id_type, tax_condition, address, country, currency, terms_days, notes, crm_company_id, crm_contact_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, actor.ws, f.kind, f.name, f.email, f.phone, f.taxId, f.taxIdType, f.taxCondition, f.address, f.country, f.currency, f.terms, f.notes, input.crmCompanyId ?? null, input.crmContactId ?? null, ts, ts);
  await audit(actor, 'contact.create', 'contact', id, f.name);
  if ((opts.syncCrm ?? s.crm_sync === 1) && !input.crmCompanyId) {
    const { syncContactToCrm } = await import('./books-integrations');
    await syncContactToCrm(actor, id).catch(() => undefined);
  }
  return (await getContact(actor.ws, id))!;
}

export async function updateContact(actor: BooksActor, id: string, input: ContactInput & { archived?: boolean }): Promise<ContactDto> {
  assertCan(actor, 'contacts.write');
  const cur = await getContactRow(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  const f = contactFields(input, cur);
  await getDb()
    .prepare(
      `UPDATE books_contacts SET kind = ?, name = ?, email = ?, phone = ?, tax_id = ?, tax_id_type = ?, tax_condition = ?, address = ?, country = ?, currency = ?, terms_days = ?, notes = ?,
       crm_company_id = ?, archived = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`,
    )
    .run(
      f.kind,
      f.name,
      f.email,
      f.phone,
      f.taxId,
      f.taxIdType,
      f.taxCondition,
      f.address,
      f.country,
      f.currency,
      f.terms,
      f.notes,
      input.crmCompanyId !== undefined ? input.crmCompanyId : cur.crm_company_id,
      input.archived === undefined ? cur.archived : input.archived ? 1 : 0,
      nowDb(),
      id,
      actor.ws,
    );
  await audit(actor, 'contact.update', 'contact', id, f.name);
  return (await getContact(actor.ws, id))!;
}

/** Un contacto con documentos no se borra (se archiva): los comprobantes lo necesitan. */
export async function deleteContact(actor: BooksActor, id: string): Promise<{ archived: boolean }> {
  assertCan(actor, 'contacts.write');
  const cur = await getContactRow(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  const db = getDb();
  const used =
    (await db.prepare('SELECT 1 AS x FROM books_documents WHERE contact_id = ? LIMIT 1').get(id)) ||
    (await db.prepare('SELECT 1 AS x FROM books_expenses WHERE contact_id = ? LIMIT 1').get(id)) ||
    (await db.prepare('SELECT 1 AS x FROM books_purchase_orders WHERE contact_id = ? LIMIT 1').get(id)) ||
    (await db.prepare('SELECT 1 AS x FROM books_recurring WHERE contact_id = ? LIMIT 1').get(id));
  if (used) {
    await db.prepare('UPDATE books_contacts SET archived = 1, updated_at = ? WHERE id = ?').run(nowDb(), id);
    await audit(actor, 'contact.archive', 'contact', id, cur.name);
    return { archived: true };
  }
  await db.prepare('DELETE FROM books_contacts WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  await audit(actor, 'contact.delete', 'contact', id, cur.name);
  return { archived: false };
}

// ---------- Ítems ----------

export interface ItemInput {
  kind?: 'product' | 'service';
  name?: string;
  sku?: string;
  description?: string;
  unit?: string;
  price?: number | string;
  cost?: number | string;
  taxRateId?: string | null;
  salesAccountId?: string | null;
  purchaseAccountId?: string | null;
  trackStock?: boolean;
  shopVariantId?: string | null;
  archived?: boolean;
}

export interface ItemDto {
  id: string;
  kind: 'product' | 'service';
  name: string;
  sku: string;
  description: string;
  unit: string;
  price: number;
  cost: number;
  taxRateId: string | null;
  salesAccountId: string | null;
  purchaseAccountId: string | null;
  trackStock: boolean;
  stock: number;
  shopVariantId: string | null;
  /** Stock del ítem de Shop vinculado (suma de ubicaciones, disponible menos reservado). */
  shopLinked: { product: string; variant: string } | null;
  archived: boolean;
  updatedAt: string;
}

async function shopStock(ws: string, variantId: string): Promise<{ qty: number; product: string; variant: string } | null> {
  try {
    const row = (await getDb()
      .prepare(
        `SELECT p.title AS product, v.title AS variant, COALESCE((SELECT SUM(i.available - i.reserved) FROM shop_inventory i WHERE i.variant_id = v.id), 0) AS qty
         FROM shop_variants v JOIN shop_products p ON p.id = v.product_id WHERE v.id = ? AND v.workspace_id = ?`,
      )
      .get(variantId, ws)) as { product: string; variant: string; qty: number } | undefined;
    return row ? { qty: Number(row.qty), product: row.product, variant: row.variant } : null;
  } catch {
    return null;
  }
}

export async function itemDto(r: ItemRow): Promise<ItemDto> {
  const linked = r.shop_variant_id ? await shopStock(r.workspace_id, r.shop_variant_id) : null;
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    sku: r.sku,
    description: r.description,
    unit: r.unit,
    price: r.price,
    cost: r.cost,
    taxRateId: r.tax_rate_id,
    salesAccountId: r.sales_account_id,
    purchaseAccountId: r.purchase_account_id,
    trackStock: r.track_stock === 1 || Boolean(linked),
    stock: linked ? linked.qty : Number(r.stock_qty),
    shopVariantId: r.shop_variant_id,
    shopLinked: linked ? { product: linked.product, variant: linked.variant } : null,
    archived: r.archived === 1,
    updatedAt: r.updated_at,
  };
}

export async function getItemRow(ws: string, id: string | null | undefined): Promise<ItemRow | null> {
  if (!id) return null;
  return ((await getDb().prepare('SELECT * FROM books_items WHERE id = ? AND workspace_id = ?').get(id, ws)) as ItemRow | undefined) ?? null;
}

export async function getItem(ws: string, id: string): Promise<ItemDto | null> {
  const r = await getItemRow(ws, id);
  return r ? itemDto(r) : null;
}

export async function listItems(ws: string, opts: { q?: string; includeArchived?: boolean; limit?: number } = {}): Promise<ItemDto[]> {
  await ensureBooks(ws);
  const where = ['workspace_id = ?'];
  const args: Array<string | number> = [ws];
  if (!opts.includeArchived) where.push('archived = 0');
  if (opts.q?.trim()) {
    const l = likeEsc(opts.q.trim());
    where.push("(name LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\')");
    args.push(l, l);
  }
  const rows = (await getDb()
    .prepare(`SELECT * FROM books_items WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE ASC LIMIT ?`)
    .all(...args, Math.min(opts.limit ?? 500, 2000))) as ItemRow[];
  return Promise.all(rows.map(itemDto));
}

async function itemFields(ws: string, currency: string, input: ItemInput, cur?: ItemRow) {
  const name = input.name !== undefined ? clean(input.name, 160) : (cur?.name ?? '');
  if (!name) throw new BooksError('invalid_name');
  const kind = input.kind ?? cur?.kind ?? 'service';
  if (kind !== 'product' && kind !== 'service') throw new BooksError('invalid_kind');
  const money = (v: number | string | undefined, fallback: number) => {
    if (v === undefined) return fallback;
    const n = typeof v === 'number' ? Math.trunc(v) : parseAmount(v, currency);
    if (n == null || n < 0) throw new BooksError('invalid_amount');
    return n;
  };
  const taxRateId = input.taxRateId !== undefined ? input.taxRateId : (cur?.tax_rate_id ?? null);
  if (taxRateId && !(await getTaxRate(ws, taxRateId))) throw new BooksError('invalid_tax_rate');
  for (const acc of [input.salesAccountId, input.purchaseAccountId]) if (acc && !(await getAccount(ws, acc))) throw new BooksError('invalid_account');
  let shopVariantId = input.shopVariantId !== undefined ? input.shopVariantId : (cur?.shop_variant_id ?? null);
  if (shopVariantId) {
    const v = await getDb().prepare('SELECT 1 AS x FROM shop_variants WHERE id = ? AND workspace_id = ?').get(shopVariantId, ws).catch(() => undefined);
    if (!v) throw new BooksError('invalid_shop_variant');
  } else shopVariantId = null;
  return {
    kind,
    name,
    sku: input.sku !== undefined ? clean(input.sku, 60) : (cur?.sku ?? ''),
    description: input.description !== undefined ? clean(input.description, 2000) : (cur?.description ?? ''),
    unit: input.unit !== undefined ? clean(input.unit, 20) : (cur?.unit ?? ''),
    price: money(input.price, cur?.price ?? 0),
    cost: money(input.cost, cur?.cost ?? 0),
    taxRateId,
    salesAccountId: input.salesAccountId !== undefined ? input.salesAccountId : (cur?.sales_account_id ?? null),
    purchaseAccountId: input.purchaseAccountId !== undefined ? input.purchaseAccountId : (cur?.purchase_account_id ?? null),
    trackStock: input.trackStock !== undefined ? (input.trackStock ? 1 : 0) : (cur?.track_stock ?? (kind === 'product' ? 1 : 0)),
    shopVariantId,
  };
}

export async function createItem(actor: BooksActor, input: ItemInput): Promise<ItemDto> {
  assertCan(actor, 'items.write');
  const s = await ensureBooks(actor.ws);
  const f = await itemFields(actor.ws, s.base_currency, input);
  const id = newId('itm');
  const ts = nowDb();
  await getDb()
    .prepare(
      `INSERT INTO books_items (id, workspace_id, kind, name, sku, description, unit, price, cost, tax_rate_id, sales_account_id, purchase_account_id, track_stock, shop_variant_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, actor.ws, f.kind, f.name, f.sku, f.description, f.unit, f.price, f.cost, f.taxRateId, f.salesAccountId, f.purchaseAccountId, f.trackStock, f.shopVariantId, ts, ts);
  await audit(actor, 'item.create', 'item', id, f.name);
  return (await getItem(actor.ws, id))!;
}

export async function updateItem(actor: BooksActor, id: string, input: ItemInput): Promise<ItemDto> {
  assertCan(actor, 'items.write');
  const s = await ensureBooks(actor.ws);
  const cur = await getItemRow(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  const f = await itemFields(actor.ws, s.base_currency, input, cur);
  await getDb()
    .prepare(
      `UPDATE books_items SET kind = ?, name = ?, sku = ?, description = ?, unit = ?, price = ?, cost = ?, tax_rate_id = ?, sales_account_id = ?, purchase_account_id = ?, track_stock = ?, shop_variant_id = ?, archived = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .run(f.kind, f.name, f.sku, f.description, f.unit, f.price, f.cost, f.taxRateId, f.salesAccountId, f.purchaseAccountId, f.trackStock, f.shopVariantId, input.archived === undefined ? cur.archived : input.archived ? 1 : 0, nowDb(), id, actor.ws);
  await audit(actor, 'item.update', 'item', id, f.name);
  return (await getItem(actor.ws, id))!;
}

export async function deleteItem(actor: BooksActor, id: string): Promise<{ archived: boolean }> {
  assertCan(actor, 'items.write');
  const cur = await getItemRow(actor.ws, id);
  if (!cur) throw new BooksError('not_found', 404);
  const db = getDb();
  const used = (await db.prepare('SELECT 1 AS x FROM books_lines WHERE item_id = ? LIMIT 1').get(id)) || (await db.prepare('SELECT 1 AS x FROM books_po_lines WHERE item_id = ? LIMIT 1').get(id));
  if (used) {
    await db.prepare('UPDATE books_items SET archived = 1, updated_at = ? WHERE id = ?').run(nowDb(), id);
    await audit(actor, 'item.archive', 'item', id, cur.name);
    return { archived: true };
  }
  await db.prepare('DELETE FROM books_stock_moves WHERE item_id = ? AND workspace_id = ?').run(id, actor.ws);
  await db.prepare('DELETE FROM books_items WHERE id = ? AND workspace_id = ?').run(id, actor.ws);
  await audit(actor, 'item.delete', 'item', id, cur.name);
  return { archived: false };
}

/**
 * Mueve el stock de un ítem. Si está vinculado a una variante de Shop, el
 * stock es el de Shop (ubicación por defecto) y se ajusta allá, con su
 * historial; si no, el propio de Books con compare-and-set.
 */
export async function moveStock(actor: BooksActor, itemId: string, quantity: number, reason: string, ref: { type: string; id: string } | null): Promise<void> {
  const it = await getItemRow(actor.ws, itemId);
  if (!it) throw new BooksError('not_found', 404);
  const qty = normalizeQuantity(quantity);
  if (!qty) return;
  const db = getDb();
  if (it.shop_variant_id) {
    const { adjustInventory, listLocations } = await import('./shop');
    const loc = (await listLocations(actor.ws)).find((l) => l.isDefault);
    if (!loc) throw new BooksError('shop_location_missing', 409);
    await adjustInventory({ ws: actor.ws, person: actor.person, admin: actor.admin }, { variantId: it.shop_variant_id, locationId: loc.id, delta: Math.round(qty), reason: `books:${reason}`, ref: ref?.id ?? null });
  } else if (it.track_stock) {
    for (let i = 0; i < 5; i++) {
      const cur = (await db.prepare('SELECT stock_qty FROM books_items WHERE id = ?').get(itemId)) as { stock_qty: number };
      const res = await db.prepare('UPDATE books_items SET stock_qty = ?, updated_at = ? WHERE id = ? AND stock_qty = ?').run(normalizeQuantity(Number(cur.stock_qty) + qty), nowDb(), itemId, cur.stock_qty);
      if (res.changes) break;
      if (i === 4) throw new BooksError('conflict', 409);
    }
  } else return;
  await db
    .prepare('INSERT INTO books_stock_moves (id, workspace_id, item_id, quantity, reason, ref_type, ref_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId('stm'), actor.ws, itemId, qty, clean(reason, 40), ref?.type ?? null, ref?.id ?? null, actor.person, nowDb());
}

export async function stockMoves(ws: string, itemId: string): Promise<Array<{ id: string; quantity: number; reason: string; refType: string | null; refId: string | null; createdAt: string }>> {
  const rows = (await getDb().prepare('SELECT * FROM books_stock_moves WHERE workspace_id = ? AND item_id = ? ORDER BY created_at DESC LIMIT 100').all(ws, itemId)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ id: String(r.id), quantity: Number(r.quantity), reason: String(r.reason), refType: (r.ref_type as string) ?? null, refId: (r.ref_id as string) ?? null, createdAt: String(r.created_at) }));
}
