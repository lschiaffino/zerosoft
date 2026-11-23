/**
 * CRM, bloque C4: la fila que se despliega en los índices (contactos,
 * empresas, deals), como la vista previa de fila de HubSpot. Muestra los
 * asociados que más se miran y la última actividad:
 *
 * - empresa: sus contactos y sus deals abiertos;
 * - contacto: sus deals;
 * - deal: sus contactos y sus empresas (la primaria primero).
 *
 * Solo campos estándar que la fila ya muestra en otros lados (nombre, email,
 * cargo, monto, etapa, dominio): nunca propiedades propias, así una oculta
 * para quien mira no sale por acá. Cada lista pasa por el alcance de quien
 * mira (scopeAnd, el mismo de las fichas) y cuenta solo lo que ve; la última
 * actividad sale del timeline con sus mismas reglas (activityScopeSql y los
 * chats privados, lib/crm-timeline.ts). El registro mismo lo valida la ruta
 * (guardRecord) antes de llamar.
 */
import { getDb, type Db } from './db';
import { scopeAnd, type OwnerScope } from './crm-visibility';
import { listRecordActivities, type TimelineRecordKind } from './crm-timeline';
import type { ChatReader } from './crm-chat-privacy';

/** Cuántos asociados de cada tipo se listan (el total cuenta todos los que la persona ve). */
export const ROW_EXPAND_LIMIT = 5;
/** Largo del texto de la última actividad. */
const TEXT_MAX = 140;
/** Actividades que se miran para encontrar la última (el timeline ordena primero lo fijado y lo que vence). */
const ACTIVITY_SCAN = 50;

export type RowExpandKind = TimelineRecordKind;

export interface ExpandContact {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
}

export interface ExpandDeal {
  id: string;
  name: string;
  amount: number;
  currency: string;
  stage: string | null;
  closeDate: string | null;
  status: 'open' | 'won' | 'lost';
}

export interface ExpandCompany {
  id: string;
  name: string;
  domain: string;
  primary: boolean;
}

export interface ExpandActivity {
  type: string;
  text: string;
  at: string;
  done: boolean;
}

export interface ExpandList<T> {
  rows: T[];
  total: number;
}

export interface RowExpansion {
  contacts?: ExpandList<ExpandContact>;
  deals?: ExpandList<ExpandDeal>;
  companies?: ExpandList<ExpandCompany>;
  lastActivity: ExpandActivity | null;
}

type Args = Array<string | number>;

async function page<T>(db: Db, select: string, from: string, args: Args): Promise<{ rows: T[]; total: number }> {
  const [rows, count] = await Promise.all([
    db.prepare(`${select} ${from} LIMIT ?`).all(...args, ROW_EXPAND_LIMIT) as Promise<T[]>,
    db.prepare(`SELECT COUNT(*) AS n ${from.replace(/\sORDER BY[\s\S]*$/, '')}`).get(...args) as Promise<{ n: number }>,
  ]);
  return { rows, total: Number(count?.n ?? 0) };
}

interface ContactRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  job_title: string;
}

function toContact(r: ContactRow): ExpandContact {
  const name = `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim();
  return { id: r.id, name: name || r.email || '', email: r.email ?? '', jobTitle: r.job_title ?? '' };
}

interface DealRow {
  id: string;
  name: string;
  amount: number;
  currency: string;
  stage_name: string | null;
  close_date: string | null;
  is_won: number;
  is_lost: number;
}

function toDeal(r: DealRow): ExpandDeal {
  return {
    id: r.id,
    name: r.name,
    amount: Number(r.amount ?? 0),
    currency: r.currency ?? '',
    stage: r.stage_name ?? null,
    closeDate: r.close_date ?? null,
    status: r.is_won ? 'won' : r.is_lost ? 'lost' : 'open',
  };
}

const CONTACT_COLS = 'SELECT c.id, c.first_name, c.last_name, c.email, c.job_title';
const DEAL_COLS = `SELECT d.id, d.name, d.amount, d.currency, d.close_date, s.name AS stage_name,
  COALESCE(s.is_won, 0) AS is_won, COALESCE(s.is_lost, 0) AS is_lost`;
const OPEN = 'COALESCE(s.is_won, 0) = 0 AND COALESCE(s.is_lost, 0) = 0';

/** Contactos de una empresa o de un deal que la persona ve. */
async function contactsOf(db: Db, ws: string, kind: 'company' | 'deal', id: string, scope: OwnerScope | undefined) {
  const sc = scopeAnd('c', scope);
  const from =
    kind === 'company'
      ? `FROM crm_contact_companies cc
         JOIN crm_contacts c ON c.id = cc.contact_id AND c.user_id = cc.user_id
         WHERE cc.company_id = ? AND cc.user_id = ?${sc.sql}
         ORDER BY cc.is_primary DESC, c.created_at DESC, c.id ASC`
      : `FROM crm_deal_contacts dc
         JOIN crm_contacts c ON c.id = dc.contact_id AND c.user_id = ?
         JOIN crm_deals dd ON dd.id = dc.deal_id AND dd.user_id = c.user_id
         WHERE dc.deal_id = ?${sc.sql}
         ORDER BY dc.rowid ASC`;
  const args: Args = kind === 'company' ? [id, ws, ...sc.args] : [ws, id, ...sc.args];
  const out = await page<ContactRow>(db, CONTACT_COLS, from, args);
  return { rows: out.rows.map(toContact), total: out.total };
}

/** Deals de una empresa (solo los abiertos) o de un contacto (abiertos primero) que la persona ve. */
async function dealsOf(db: Db, ws: string, kind: 'company' | 'contact', id: string, scope: OwnerScope | undefined) {
  const sc = scopeAnd('d', scope);
  const from =
    kind === 'company'
      ? `FROM crm_deal_companies dco
         JOIN crm_deals d ON d.id = dco.deal_id AND d.user_id = dco.user_id
         LEFT JOIN crm_stages s ON s.id = d.stage_id
         WHERE dco.company_id = ? AND dco.user_id = ? AND ${OPEN}${sc.sql}
         ORDER BY d.close_date IS NULL, d.close_date ASC, d.created_at DESC, d.id ASC`
      : `FROM crm_deal_contacts dct
         JOIN crm_deals d ON d.id = dct.deal_id AND d.user_id = ?
         LEFT JOIN crm_stages s ON s.id = d.stage_id
         WHERE dct.contact_id = ?${sc.sql}
         ORDER BY CASE WHEN ${OPEN} THEN 0 ELSE 1 END, d.created_at DESC, d.id ASC`;
  const args: Args = kind === 'company' ? [id, ws, ...sc.args] : [ws, id, ...sc.args];
  const out = await page<DealRow>(db, DEAL_COLS, from, args);
  return { rows: out.rows.map(toDeal), total: out.total };
}

/** Empresas de un deal que la persona ve (la primaria primero). */
async function companiesOf(db: Db, ws: string, dealId: string, scope: OwnerScope | undefined) {
  const sc = scopeAnd('co', scope);
  const from = `FROM crm_deal_companies dco
    JOIN crm_companies co ON co.id = dco.company_id AND co.user_id = dco.user_id
    WHERE dco.deal_id = ? AND dco.user_id = ?${sc.sql}
    ORDER BY dco.is_primary DESC, dco.created_at ASC, dco.rowid ASC`;
  const out = await page<{ id: string; name: string; domain: string; is_primary: number }>(
    db,
    'SELECT co.id, co.name, co.domain, dco.is_primary',
    from,
    [dealId, ws, ...sc.args],
  );
  return { rows: out.rows.map((r) => ({ id: r.id, name: r.name, domain: r.domain ?? '', primary: !!r.is_primary })), total: out.total };
}

/** Texto de una actividad para una línea: sin etiquetas ni saltos, cortado. */
export function activityLine(subject: string, body: string): string {
  const raw = (subject || body || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return raw.length > TEXT_MAX ? `${raw.slice(0, TEXT_MAX - 1)}…` : raw;
}

/** La última actividad del registro (por fecha de creación) entre las que su timeline le muestra a la persona. */
async function lastActivityOf(ws: string, kind: RowExpandKind, id: string, scope: OwnerScope | undefined, chatReader: ChatReader | null) {
  const { rows } = await listRecordActivities(ws, { kind, id }, { ownerScope: scope, chatReader, limit: ACTIVITY_SCAN });
  let last: (typeof rows)[number] | null = null;
  for (const r of rows) if (!last || r.created_at > last.created_at) last = r;
  if (!last) return null;
  return { type: last.type, text: activityLine(last.subject, last.body), at: last.created_at, done: !!last.done };
}

export async function rowExpansion(
  ws: string,
  kind: RowExpandKind,
  id: string,
  opts: { scope: OwnerScope | undefined; chatReader: ChatReader | null },
  db: Db = getDb(),
): Promise<RowExpansion> {
  const last = lastActivityOf(ws, kind, id, opts.scope, opts.chatReader);
  if (kind === 'company') {
    const [contacts, deals, lastActivity] = await Promise.all([contactsOf(db, ws, 'company', id, opts.scope), dealsOf(db, ws, 'company', id, opts.scope), last]);
    return { contacts, deals, lastActivity };
  }
  if (kind === 'contact') {
    const [deals, lastActivity] = await Promise.all([dealsOf(db, ws, 'contact', id, opts.scope), last]);
    return { deals, lastActivity };
  }
  const [contacts, companies, lastActivity] = await Promise.all([contactsOf(db, ws, 'deal', id, opts.scope), companiesOf(db, ws, id, opts.scope), last]);
  return { contacts, companies, lastActivity };
}
