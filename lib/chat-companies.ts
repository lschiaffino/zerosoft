/**
 * Chat — empresas y atributos propios de las personas (los "Companies" y
 * "custom attributes" de Intercom). La empresa es del workspace; la persona
 * cuelga de una. Server-only.
 */
import { getDb } from './db';
import { ChatCollabError } from './chat-collab';

export interface ChatCompany {
  id: string;
  name: string;
  domain: string | null;
  plan: string | null;
  notes: string | null;
  people: number;
  created_at: string;
  updated_at: string;
}

function text(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/** "https://www.Acme.com/x" → "acme.com". */
export function normalizeDomain(raw: unknown): string | null {
  const s = text(raw, 200)?.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? null;
  return s && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

/** Con `widgetIds`, las personas cuentan solo las de esas bandejas. */
function select(widgetIds?: string[]): { sql: string; args: string[] } {
  const scope = widgetIds ? ` AND v.widget_id IN (${widgetIds.length ? widgetIds.map(() => '?').join(', ') : "''"})` : '';
  return { sql: `SELECT c.*, (SELECT COUNT(*) FROM chat_visitors v WHERE v.company_id = c.id${scope}) AS people FROM chat_companies c`, args: widgetIds ?? [] };
}

export async function listCompanies(workspaceId: string, widgetIds?: string[]): Promise<ChatCompany[]> {
  const q = select(widgetIds);
  const rows = (await getDb().prepare(`${q.sql} WHERE c.workspace_id = ? ORDER BY c.name COLLATE NOCASE LIMIT 500`).all(...q.args, workspaceId)) as ChatCompany[];
  return rows.map((r) => ({ ...r, people: Number(r.people) }));
}

export async function getCompany(workspaceId: string, id: string, widgetIds?: string[]): Promise<ChatCompany | null> {
  const q = select(widgetIds);
  const row = (await getDb().prepare(`${q.sql} WHERE c.workspace_id = ? AND c.id = ?`).get(...q.args, workspaceId, id)) as ChatCompany | undefined;
  return row ? { ...row, people: Number(row.people) } : null;
}

export async function createCompany(workspaceId: string, input: Record<string, unknown>): Promise<ChatCompany> {
  const name = text(input.name, 120);
  if (!name) throw new ChatCollabError('missing_name');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getDb()
    .prepare('INSERT INTO chat_companies (id, workspace_id, name, domain, plan, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId, name, normalizeDomain(input.domain), text(input.plan, 80), text(input.notes, 2000), now, now);
  return (await getCompany(workspaceId, id))!;
}

export async function updateCompany(workspaceId: string, id: string, input: Record<string, unknown>, widgetIds?: string[]): Promise<ChatCompany | null> {
  const current = await getCompany(workspaceId, id);
  if (!current) return null;
  const name = input.name !== undefined ? text(input.name, 120) : current.name;
  if (!name) throw new ChatCollabError('missing_name');
  await getDb()
    .prepare('UPDATE chat_companies SET name = ?, domain = ?, plan = ?, notes = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .run(
      name,
      input.domain !== undefined ? normalizeDomain(input.domain) : current.domain,
      input.plan !== undefined ? text(input.plan, 80) : current.plan,
      input.notes !== undefined ? text(input.notes, 2000) : current.notes,
      new Date().toISOString(),
      id,
      workspaceId,
    );
  return getCompany(workspaceId, id, widgetIds);
}

export async function deleteCompany(workspaceId: string, id: string): Promise<boolean> {
  const db = getDb();
  const res = await db.prepare('DELETE FROM chat_companies WHERE id = ? AND workspace_id = ?').run(id, workspaceId);
  if (res.changes > 0) await db.prepare('UPDATE chat_visitors SET company_id = NULL WHERE company_id = ?').run(id);
  return res.changes > 0;
}

// ---------- Atributos de la persona ----------

export const VISITOR_ATTRIBUTES_MAX = 30;

/** Limpia { clave: valor }: claves cortas, valores de texto, hasta 30. */
export function cleanVisitorAttributes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ChatCollabError('invalid_input');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim().slice(0, 60);
    const val = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v).trim().slice(0, 500) : '';
    if (key && val && Object.keys(out).length < VISITOR_ATTRIBUTES_MAX) out[key] = val;
  }
  return out;
}

export function parseVisitorAttributes(raw: string | null | undefined): Record<string, string> {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function setVisitorProfile(visitorId: string, patch: { companyId?: string | null; attributes?: Record<string, string> }): Promise<void> {
  const db = getDb();
  if (patch.companyId !== undefined) await db.prepare('UPDATE chat_visitors SET company_id = ? WHERE id = ?').run(patch.companyId, visitorId);
  if (patch.attributes !== undefined) await db.prepare('UPDATE chat_visitors SET attributes = ? WHERE id = ?').run(JSON.stringify(patch.attributes), visitorId);
}

export async function setCampaignOptIn(visitorId: string, optIn: boolean): Promise<void> {
  await getDb().prepare('UPDATE chat_visitors SET campaign_opt_in_at = ? WHERE id = ?').run(optIn ? new Date().toISOString() : null, visitorId);
}
