/**
 * CRM — asociaciones nivel HubSpot. Server-only.
 *
 * - contact ↔ company: many-to-many con label (CONTACT_COMPANY_LABELS) y una
 *   primaria por contacto. crm_contacts.company_id es SIEMPRE el espejo de la
 *   primaria (compatibilidad con la API/listados existentes).
 * - deal ↔ company: many-to-many con una primaria por deal.
 * - deal ↔ contact: la tabla de siempre (crm_deal_contacts).
 * - company → parent company: jerarquía sin ciclos (parent_company_id).
 *
 * Invariante: si un registro tiene asociaciones a empresas, exactamente una es
 * primaria. Al quitar la primaria se promueve la más antigua que quede.
 * Todos los ids se validan contra el workspace (CrmRefError → 400).
 */
import { CrmRefError } from './crm-refs';
import { baseAmountSql, getCrmSettings } from './crm-currency';
import { CONTACT_COMPANY_LABELS } from './crm-constants';
import {
  getDb,
  type CrmCompanyRow,
  type CrmContactRow,
  type CrmDealRow,
  type Db,
} from './db';

export type AssocObject = 'contact' | 'company' | 'deal';

function nowDb(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

async function ownsRow(db: Db, table: string, userId: string, id: string): Promise<boolean> {
  return !!(await db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId));
}

async function assertOwned(db: Db, type: AssocObject, userId: string, id: string): Promise<void> {
  const table = type === 'contact' ? 'crm_contacts' : type === 'company' ? 'crm_companies' : 'crm_deals';
  if (!id || !(await ownsRow(db, table, userId, id))) throw new CrmRefError(`invalid_${type}`);
}

function normLabel(label: string | undefined | null): string {
  const v = (label ?? '').trim();
  if (!v) return '';
  if (!(CONTACT_COMPANY_LABELS as readonly string[]).includes(v)) throw new CrmRefError('invalid_label');
  return v;
}

// ============================================================
// SYNC DE PRIMARIAS
// ============================================================

/** Garantiza una primaria (promueve la más antigua) y espeja company_id en el contacto. */
export async function syncContactPrimary(contactId: string, db: Db = getDb()): Promise<string | null> {
  let primary = (await db
    .prepare('SELECT company_id FROM crm_contact_companies WHERE contact_id = ? AND is_primary = 1')
    .get(contactId)) as { company_id: string } | undefined;
  if (!primary) {
    const oldest = (await db
      .prepare(
        'SELECT company_id FROM crm_contact_companies WHERE contact_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1',
      )
      .get(contactId)) as { company_id: string } | undefined;
    if (oldest) {
      await db
        .prepare('UPDATE crm_contact_companies SET is_primary = 1 WHERE contact_id = ? AND company_id = ?')
        .run(contactId, oldest.company_id);
      primary = oldest;
    }
  }
  const companyId = primary?.company_id ?? null;
  await db
    .prepare('UPDATE crm_contacts SET company_id = ? WHERE id = ? AND company_id IS NOT ?')
    .run(companyId, contactId, companyId);
  return companyId;
}

/** Garantiza una primaria entre las empresas del deal (promueve la más antigua). */
export async function syncDealPrimary(dealId: string, db: Db = getDb()): Promise<string | null> {
  const primary = (await db
    .prepare('SELECT company_id FROM crm_deal_companies WHERE deal_id = ? AND is_primary = 1')
    .get(dealId)) as { company_id: string } | undefined;
  if (primary) return primary.company_id;
  const oldest = (await db
    .prepare('SELECT company_id FROM crm_deal_companies WHERE deal_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1')
    .get(dealId)) as { company_id: string } | undefined;
  if (!oldest) return null;
  await db
    .prepare('UPDATE crm_deal_companies SET is_primary = 1 WHERE deal_id = ? AND company_id = ?')
    .run(dealId, oldest.company_id);
  return oldest.company_id;
}

// ============================================================
// CONTACT ↔ COMPANY
// ============================================================

export type ContactCompanyRow = CrmCompanyRow & { is_primary: number; label: string };
export type CompanyContactRow = CrmContactRow & { is_primary: number; label: string };

export async function listContactCompanies(
  userId: string,
  contactId: string,
  db: Db = getDb(),
): Promise<ContactCompanyRow[]> {
  return (await db
    .prepare(
      `SELECT co.*, cc.is_primary, cc.label FROM crm_contact_companies cc
       JOIN crm_companies co ON co.id = cc.company_id AND co.user_id = cc.user_id
       WHERE cc.contact_id = ? AND cc.user_id = ?
       ORDER BY cc.is_primary DESC, cc.created_at ASC, cc.rowid ASC`,
    )
    .all(contactId, userId)) as ContactCompanyRow[];
}

export async function listCompanyContacts(
  userId: string,
  companyId: string,
  db: Db = getDb(),
): Promise<CompanyContactRow[]> {
  return (await db
    .prepare(
      `SELECT c.*, cc.is_primary, cc.label FROM crm_contact_companies cc
       JOIN crm_contacts c ON c.id = cc.contact_id AND c.user_id = cc.user_id
       WHERE cc.company_id = ? AND cc.user_id = ?
       ORDER BY c.created_at DESC`,
    )
    .all(companyId, userId)) as CompanyContactRow[];
}

/**
 * Asocia (o actualiza) contacto ↔ empresa. `primary: true` la vuelve primaria
 * (la anterior queda asociada, no primaria). La primera asociación siempre es primaria.
 */
export async function associateContactCompany(
  userId: string,
  contactId: string,
  companyId: string,
  opts: { primary?: boolean; label?: string | null } = {},
  db: Db = getDb(),
): Promise<void> {
  await assertOwned(db, 'contact', userId, contactId);
  await assertOwned(db, 'company', userId, companyId);
  const label = opts.label === undefined ? undefined : normLabel(opts.label);
  const existing = (await db
    .prepare('SELECT is_primary FROM crm_contact_companies WHERE contact_id = ? AND company_id = ?')
    .get(contactId, companyId)) as { is_primary: number } | undefined;
  if (opts.primary) {
    await db
      .prepare('UPDATE crm_contact_companies SET is_primary = 0 WHERE contact_id = ? AND company_id != ?')
      .run(contactId, companyId);
  }
  if (existing) {
    const sets: string[] = [];
    const args: Array<string | number> = [];
    if (opts.primary) sets.push('is_primary = 1');
    if (label !== undefined) {
      sets.push('label = ?');
      args.push(label);
    }
    if (sets.length) {
      await db
        .prepare(`UPDATE crm_contact_companies SET ${sets.join(', ')} WHERE contact_id = ? AND company_id = ?`)
        .run(...args, contactId, companyId);
    }
  } else {
    await db
      .prepare(
        `INSERT INTO crm_contact_companies (contact_id, company_id, user_id, is_primary, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(contactId, companyId, userId, opts.primary ? 1 : 0, label ?? '', nowDb());
  }
  await syncContactPrimary(contactId, db);
}

export async function removeContactCompany(
  userId: string,
  contactId: string,
  companyId: string,
  db: Db = getDb(),
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM crm_contact_companies WHERE contact_id = ? AND company_id = ? AND user_id = ?')
    .run(contactId, companyId, userId);
  if (res.changes > 0) await syncContactPrimary(contactId, db);
  return res.changes > 0;
}

/**
 * Compatibilidad con `companyId` del contacto: un id la vuelve primaria
 * (asociándola si hace falta); null quita la primaria actual (se promueve la
 * siguiente asociación, si hay).
 */
export async function setContactPrimaryCompany(
  userId: string,
  contactId: string,
  companyId: string | null,
  db: Db = getDb(),
): Promise<void> {
  if (companyId) {
    await associateContactCompany(userId, contactId, companyId, { primary: true }, db);
    return;
  }
  await db
    .prepare('DELETE FROM crm_contact_companies WHERE contact_id = ? AND is_primary = 1 AND user_id = ?')
    .run(contactId, userId);
  await syncContactPrimary(contactId, db);
}

// ============================================================
// DEAL ↔ COMPANY / CONTACT
// ============================================================

export type DealCompanyRow = CrmCompanyRow & { is_primary: number };
export type CompanyDealRow = CrmDealRow & { is_primary: number; stage_name: string | null; is_won: number; is_lost: number };

export async function listDealCompanies(userId: string, dealId: string, db: Db = getDb()): Promise<DealCompanyRow[]> {
  return (await db
    .prepare(
      `SELECT co.*, dc.is_primary FROM crm_deal_companies dc
       JOIN crm_companies co ON co.id = dc.company_id AND co.user_id = dc.user_id
       WHERE dc.deal_id = ? AND dc.user_id = ?
       ORDER BY dc.is_primary DESC, dc.created_at ASC, dc.rowid ASC`,
    )
    .all(dealId, userId)) as DealCompanyRow[];
}

export async function listCompanyDeals(userId: string, companyId: string, db: Db = getDb()): Promise<CompanyDealRow[]> {
  return (await db
    .prepare(
      `SELECT d.*, dc.is_primary, s.name AS stage_name, COALESCE(s.is_won, 0) AS is_won, COALESCE(s.is_lost, 0) AS is_lost
       FROM crm_deal_companies dc
       JOIN crm_deals d ON d.id = dc.deal_id AND d.user_id = dc.user_id
       LEFT JOIN crm_stages s ON s.id = d.stage_id
       WHERE dc.company_id = ? AND dc.user_id = ?
       ORDER BY d.created_at DESC`,
    )
    .all(companyId, userId)) as CompanyDealRow[];
}

export async function associateDealCompany(
  userId: string,
  dealId: string,
  companyId: string,
  opts: { primary?: boolean } = {},
  db: Db = getDb(),
): Promise<void> {
  await assertOwned(db, 'deal', userId, dealId);
  await assertOwned(db, 'company', userId, companyId);
  if (opts.primary) {
    await db
      .prepare('UPDATE crm_deal_companies SET is_primary = 0 WHERE deal_id = ? AND company_id != ?')
      .run(dealId, companyId);
  }
  await db
    .prepare(
      `INSERT INTO crm_deal_companies (deal_id, company_id, user_id, is_primary, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(deal_id, company_id) DO UPDATE SET is_primary = MAX(is_primary, excluded.is_primary)`,
    )
    .run(dealId, companyId, userId, opts.primary ? 1 : 0, nowDb());
  await syncDealPrimary(dealId, db);
}

export async function removeDealCompany(
  userId: string,
  dealId: string,
  companyId: string,
  db: Db = getDb(),
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM crm_deal_companies WHERE deal_id = ? AND company_id = ? AND user_id = ?')
    .run(dealId, companyId, userId);
  if (res.changes > 0) await syncDealPrimary(dealId, db);
  return res.changes > 0;
}

/**
 * Al vincular contactos a un deal, sus empresas primarias quedan asociadas al
 * deal (como hace HubSpot). Si el deal no tenía empresa, la primera es primaria.
 */
export async function autoAssociateContactCompanies(
  userId: string,
  dealId: string,
  contactIds: string[],
  db: Db = getDb(),
): Promise<void> {
  for (const contactId of contactIds) {
    const row = (await db
      .prepare(
        `SELECT cc.company_id FROM crm_contact_companies cc
         JOIN crm_companies co ON co.id = cc.company_id AND co.user_id = ?
         WHERE cc.contact_id = ? AND cc.is_primary = 1`,
      )
      .get(userId, contactId)) as { company_id: string } | undefined;
    if (!row) continue;
    await db
      .prepare(
        `INSERT OR IGNORE INTO crm_deal_companies (deal_id, company_id, user_id, is_primary, created_at)
         VALUES (?, ?, ?, 0, ?)`,
      )
      .run(dealId, row.company_id, userId, nowDb());
  }
  await syncDealPrimary(dealId, db);
}

export async function associateDealContact(
  userId: string,
  dealId: string,
  contactId: string,
  db: Db = getDb(),
): Promise<void> {
  await assertOwned(db, 'deal', userId, dealId);
  await assertOwned(db, 'contact', userId, contactId);
  await db
    .prepare('INSERT OR IGNORE INTO crm_deal_contacts (deal_id, contact_id) VALUES (?, ?)')
    .run(dealId, contactId);
  await autoAssociateContactCompanies(userId, dealId, [contactId], db);
}

export async function removeDealContact(
  userId: string,
  dealId: string,
  contactId: string,
  db: Db = getDb(),
): Promise<boolean> {
  if (!(await ownsRow(db, 'crm_deals', userId, dealId))) return false;
  return (
    (await db
      .prepare('DELETE FROM crm_deal_contacts WHERE deal_id = ? AND contact_id = ?')
      .run(dealId, contactId)).changes > 0
  );
}

// ============================================================
// API GENÉRICA (session + v1)
// ============================================================

export interface AssociationInput {
  fromType: AssocObject;
  fromId: string;
  toType: AssocObject;
  toId: string;
  primary?: boolean;
  label?: string | null;
}

type Pair = 'contact-company' | 'deal-company' | 'deal-contact';

function normalizePair(a: AssociationInput): { pair: Pair; ids: [string, string] } {
  const key = `${a.fromType}-${a.toType}`;
  switch (key) {
    case 'contact-company':
    case 'deal-company':
    case 'deal-contact':
      return { pair: key, ids: [a.fromId, a.toId] };
    case 'company-contact':
      return { pair: 'contact-company', ids: [a.toId, a.fromId] };
    case 'company-deal':
      return { pair: 'deal-company', ids: [a.toId, a.fromId] };
    case 'contact-deal':
      return { pair: 'deal-contact', ids: [a.toId, a.fromId] };
    default:
      throw new CrmRefError('invalid_association');
  }
}

export async function associate(userId: string, a: AssociationInput, db: Db = getDb()): Promise<void> {
  const { pair, ids } = normalizePair(a);
  if (pair === 'contact-company') {
    await associateContactCompany(userId, ids[0], ids[1], { primary: a.primary, label: a.label }, db);
  } else if (pair === 'deal-company') {
    if (a.label) throw new CrmRefError('invalid_label');
    await associateDealCompany(userId, ids[0], ids[1], { primary: a.primary }, db);
  } else {
    if (a.label || a.primary) throw new CrmRefError('invalid_association');
    await associateDealContact(userId, ids[0], ids[1], db);
  }
}

export async function dissociate(
  userId: string,
  a: Omit<AssociationInput, 'primary' | 'label'>,
  db: Db = getDb(),
): Promise<boolean> {
  const { pair, ids } = normalizePair(a);
  if (pair === 'contact-company') return removeContactCompany(userId, ids[0], ids[1], db);
  if (pair === 'deal-company') return removeDealCompany(userId, ids[0], ids[1], db);
  return removeDealContact(userId, ids[0], ids[1], db);
}

export interface AssociationList {
  companies?: Array<{ id: string; name: string; domain: string; is_primary: boolean; label?: string }>;
  contacts?: Array<{ id: string; name: string; email: string; is_primary?: boolean; label?: string }>;
  deals?: Array<{ id: string; name: string; amount: number; currency: string; is_primary?: boolean }>;
  parent?: { id: string; name: string } | null;
  children?: Array<{ id: string; name: string }>;
}

const personName = (c: { first_name: string; last_name: string; email: string }) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;

/** Todas las asociaciones de un registro (null si no existe en el workspace). */
export async function listAssociations(
  userId: string,
  type: AssocObject,
  id: string,
  db: Db = getDb(),
): Promise<AssociationList | null> {
  const table = type === 'contact' ? 'crm_contacts' : type === 'company' ? 'crm_companies' : 'crm_deals';
  if (!(await ownsRow(db, table, userId, id))) return null;
  if (type === 'contact') {
    const companies = await listContactCompanies(userId, id, db);
    const deals = (await db
      .prepare(
        `SELECT d.id, d.name, d.amount, d.currency FROM crm_deals d
         JOIN crm_deal_contacts dc ON dc.deal_id = d.id
         WHERE dc.contact_id = ? AND d.user_id = ? ORDER BY d.created_at DESC`,
      )
      .all(id, userId)) as Array<{ id: string; name: string; amount: number; currency: string }>;
    return {
      companies: companies.map((c) => ({ id: c.id, name: c.name, domain: c.domain, is_primary: !!c.is_primary, label: c.label })),
      deals,
    };
  }
  if (type === 'deal') {
    const companies = await listDealCompanies(userId, id, db);
    const contacts = (await db
      .prepare(
        `SELECT c.id, c.first_name, c.last_name, c.email FROM crm_contacts c
         JOIN crm_deal_contacts dc ON dc.contact_id = c.id
         WHERE dc.deal_id = ? AND c.user_id = ? ORDER BY dc.rowid ASC`,
      )
      .all(id, userId)) as Array<{ id: string; first_name: string; last_name: string; email: string }>;
    return {
      companies: companies.map((c) => ({ id: c.id, name: c.name, domain: c.domain, is_primary: !!c.is_primary })),
      contacts: contacts.map((c) => ({ id: c.id, name: personName(c), email: c.email })),
    };
  }
  const contacts = await listCompanyContacts(userId, id, db);
  const deals = await listCompanyDeals(userId, id, db);
  const company = (await db.prepare('SELECT parent_company_id FROM crm_companies WHERE id = ?').get(id)) as {
    parent_company_id: string | null;
  };
  const parent = company.parent_company_id
    ? (((await db
        .prepare('SELECT id, name FROM crm_companies WHERE id = ? AND user_id = ?')
        .get(company.parent_company_id, userId)) as { id: string; name: string } | undefined) ?? null)
    : null;
  return {
    contacts: contacts.map((c) => ({ id: c.id, name: personName(c), email: c.email, is_primary: !!c.is_primary, label: c.label })),
    deals: deals.map((d) => ({ id: d.id, name: d.name, amount: d.amount, currency: d.currency, is_primary: !!d.is_primary })),
    parent,
    children: (await listChildCompanies(userId, id, db)).map((c) => ({ id: c.id, name: c.name })),
  };
}

// ============================================================
// JERARQUÍA DE EMPRESAS
// ============================================================

/** Ids de todas las empresas descendientes (hijas, nietas…), sin incluir la propia. */
export async function descendantCompanyIds(userId: string, companyId: string, db: Db = getDb()): Promise<string[]> {
  const rows = (await db
    .prepare(
      `WITH RECURSIVE tree(id, depth) AS (
         SELECT id, 1 FROM crm_companies WHERE parent_company_id = ? AND user_id = ?
         UNION
         SELECT c.id, tree.depth + 1 FROM crm_companies c JOIN tree ON c.parent_company_id = tree.id
         WHERE c.user_id = ? AND tree.depth < 50
       )
       SELECT DISTINCT id FROM tree`,
    )
    .all(companyId, userId, userId)) as Array<{ id: string }>;
  return rows.map((r) => r.id).filter((id) => id !== companyId);
}

/** Cadena de empresas madre, de la inmediata a la raíz. */
export async function companyAncestors(
  userId: string,
  companyId: string,
  db: Db = getDb(),
): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>([companyId]);
  let current = (await db
    .prepare('SELECT parent_company_id FROM crm_companies WHERE id = ? AND user_id = ?')
    .get(companyId, userId)) as { parent_company_id: string | null } | undefined;
  while (current?.parent_company_id && !seen.has(current.parent_company_id) && out.length < 50) {
    const parent = (await db
      .prepare('SELECT id, name, parent_company_id FROM crm_companies WHERE id = ? AND user_id = ?')
      .get(current.parent_company_id, userId)) as { id: string; name: string; parent_company_id: string | null } | undefined;
    if (!parent) break;
    seen.add(parent.id);
    out.push({ id: parent.id, name: parent.name });
    current = parent;
  }
  return out;
}

export async function listChildCompanies(userId: string, companyId: string, db: Db = getDb()): Promise<CrmCompanyRow[]> {
  return (await db
    .prepare('SELECT * FROM crm_companies WHERE parent_company_id = ? AND user_id = ? ORDER BY name COLLATE NOCASE ASC')
    .all(companyId, userId)) as CrmCompanyRow[];
}

/**
 * Cambia la empresa madre. Rechaza: empresa ajena (invalid_company), ella misma
 * o una descendiente (hierarchy_cycle). null la deja como raíz.
 */
export async function setParentCompany(
  userId: string,
  companyId: string,
  parentId: string | null,
  db: Db = getDb(),
): Promise<void> {
  await assertOwned(db, 'company', userId, companyId);
  if (parentId) {
    await assertOwned(db, 'company', userId, parentId);
    if (parentId === companyId) throw new CrmRefError('hierarchy_cycle');
    const descendants = await descendantCompanyIds(userId, companyId, db);
    if (descendants.includes(parentId)) throw new CrmRefError('hierarchy_cycle');
  }
  await db
    .prepare('UPDATE crm_companies SET parent_company_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(parentId, nowDb(), companyId, userId);
}

export interface CompanyRollup {
  currency: string;
  /** Solo esta empresa. */
  own: { open: number; won: number; count: number };
  /** Esta empresa + todas sus descendientes (cada deal se cuenta una vez). */
  total: { open: number; won: number; count: number };
  childCount: number;
}

/** Valor de deals (en moneda base) de la empresa y de su árbol de hijas. */
export async function companyRollup(userId: string, companyId: string, db: Db = getDb()): Promise<CompanyRollup> {
  const { baseCurrency } = await getCrmSettings(userId, db);
  const descendants = await descendantCompanyIds(userId, companyId, db);
  const amt = baseAmountSql('d');
  async function sums(ids: string[]): Promise<{ open: number; won: number; count: number }> {
    const ph = ids.map(() => '?').join(',');
    const row = (await db
      .prepare(
        `SELECT COUNT(*) AS c,
           COALESCE(SUM(CASE WHEN COALESCE(s.is_won, 0) = 0 AND COALESCE(s.is_lost, 0) = 0 THEN ${amt} END), 0) AS open,
           COALESCE(SUM(CASE WHEN s.is_won = 1 THEN ${amt} END), 0) AS won
         FROM crm_deals d
         LEFT JOIN crm_stages s ON s.id = d.stage_id
         WHERE d.user_id = ? AND d.id IN (SELECT deal_id FROM crm_deal_companies WHERE company_id IN (${ph}))`,
      )
      .get(userId, ...ids)) as { c: number; open: number; won: number };
    return { open: row.open, won: row.won, count: row.c };
  }
  return {
    currency: baseCurrency,
    own: await sums([companyId]),
    total: await sums([companyId, ...descendants]),
    childCount: descendants.length,
  };
}
