/**
 * Inbox: el CRM de zerosoft en la pestaña CRM del panel de un chat de WhatsApp, como en Lines (contacto y empresa
 * vinculados y sus negocios). El chat es de la persona; el CRM, del workspace activo: el vínculo vive en
 * inbox_crm_links por chat y por workspace.
 *
 * Acceso: solo chats de la persona (getThreadRow tira si no es suyo); sin la app CRM, o para un invitado, no hay
 * nada (ni se lee el CRM). Cada contacto o empresa pasa por la visibilidad del CRM de quien mira
 * (lib/crm-visibility.ts): uno que no ve no se nombra ni se puede vincular (el mismo error que uno que no existe).
 * En un 1:1 sin contacto vinculado se sugieren los contactos que quien mira ve con el mismo teléfono.
 * Server-only.
 */
import { getDb } from '../db';
import type { SessionUser } from '../session';
import { userCanUseApp } from '../workspace';
import { canSeeRecord, scopeAnd, sessionScope } from '../crm-visibility';
import { crmDealsFor, type ChatCrmDeal } from '../groups-crm-deals';
import { getThreadRow, nowIso, type ThreadRow } from './core';
import { InboxError } from './types';

export interface InboxCrmRef {
  id: string;
  name: string;
}

export interface InboxCrmDto {
  contact: InboxCrmRef | null;
  company: InboxCrmRef | null;
  /** 1:1 sin contacto vinculado: contactos del CRM con el mismo teléfono (los que quien mira ve). */
  suggestions: InboxCrmRef[];
  deals: ChatCrmDeal[];
}

/** ¿Quien mira usa el CRM del workspace activo? (sin la app o como invitado, la pestaña dice que está apagado). */
export function inboxCrmOn(user: SessionUser): boolean {
  return user.role !== 'guest' && userCanUseApp(user, 'crm');
}

async function linkRow(ws: string, owner: string, threadId: string) {
  return (await getDb()
    .prepare('SELECT crm_contact_id, crm_company_id FROM inbox_crm_links WHERE thread_id = ? AND workspace_id = ? AND owner_id = ?')
    .get(threadId, ws, owner)) as { crm_contact_id: string | null; crm_company_id: string | null } | undefined;
}

async function contactRef(ws: string, id: string): Promise<InboxCrmRef | null> {
  const r = (await getDb()
    .prepare("SELECT id, TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS name, email FROM crm_contacts WHERE id = ? AND user_id = ?")
    .get(id, ws)) as { id: string; name: string; email: string | null } | undefined;
  return r ? { id: r.id, name: r.name || r.email || '' } : null;
}

async function companyRef(ws: string, id: string): Promise<InboxCrmRef | null> {
  const r = (await getDb().prepare('SELECT id, name FROM crm_companies WHERE id = ? AND user_id = ?').get(id, ws)) as InboxCrmRef | undefined;
  return r ? { id: r.id, name: r.name } : null;
}

/** El teléfono de un chat 1:1 de WhatsApp (por número; uno guardado por lid no tiene). */
export function threadPhone(t: Pick<ThreadRow, 'kind' | 'channel' | 'handle' | 'external_id'>): string {
  if (t.channel !== 'whatsapp' || t.kind === 'group') return '';
  const fromId = /^(\d{8,15})@(?:s\.whatsapp\.net|c\.us)$/.exec(t.external_id ?? '')?.[1] ?? '';
  const digits = (t.handle ?? '').replace(/\D/g, '');
  return fromId || (digits.length >= 8 && digits.length <= 15 ? digits : '');
}

/** Contactos del CRM con ese teléfono (compara los últimos 8 dígitos), solo los que quien mira ve. */
async function contactsByPhone(user: SessionUser, ws: string, phone: string): Promise<InboxCrmRef[]> {
  if (phone.length < 8) return [];
  const tail = phone.slice(-8);
  const cond = scopeAnd('c', await sessionScope(user));
  const rows = (await getDb()
    .prepare(
      `SELECT c.id, TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS name, c.email, c.phone FROM crm_contacts c
       WHERE c.user_id = ? AND c.phone LIKE ?${cond.sql} ORDER BY c.created_at ASC LIMIT 20`,
    )
    .all(ws, `%${tail.slice(-4)}%`, ...cond.args)) as Array<{ id: string; name: string; email: string | null; phone: string | null }>;
  return rows
    .filter((r) => (r.phone ?? '').replace(/\D/g, '').endsWith(tail))
    .slice(0, 3)
    .map((r) => ({ id: r.id, name: r.name || r.email || '' }));
}

/** El CRM del chat para quien mira. null: sin CRM para esta persona (la pestaña lo explica). */
export async function inboxCrm(user: SessionUser, owner: string, threadId: string): Promise<InboxCrmDto | null> {
  const thread = await getThreadRow(owner, threadId);
  if (!inboxCrmOn(user)) return null;
  const ws = user.id;
  const scope = await sessionScope(user);
  const link = await linkRow(ws, owner, thread.id);
  const contact = link?.crm_contact_id && (await canSeeRecord(ws, 'crm_contacts', link.crm_contact_id, scope)) ? await contactRef(ws, link.crm_contact_id) : null;
  const company = link?.crm_company_id && (await canSeeRecord(ws, 'crm_companies', link.crm_company_id, scope)) ? await companyRef(ws, link.crm_company_id) : null;
  const suggestions = contact ? [] : await contactsByPhone(user, ws, threadPhone(thread));
  const deals = contact || company ? await crmDealsFor(user, ws, { contactId: contact?.id ?? null, companyId: company?.id ?? null }) : [];
  return { contact, company, suggestions, deals };
}

/**
 * Vincula o desvincula el contacto o la empresa del CRM (null saca el vínculo; undefined no lo toca). Solo uno que
 * quien mira ve en el CRM: otro es `invalid_contact` / `invalid_company`, igual que uno que no existe.
 */
export async function linkInboxCrm(
  user: SessionUser,
  owner: string,
  threadId: string,
  patch: { crmContactId?: string | null; crmCompanyId?: string | null },
): Promise<InboxCrmDto | null> {
  const thread = await getThreadRow(owner, threadId);
  if (!inboxCrmOn(user)) throw new InboxError('forbidden', 403);
  const ws = user.id;
  const scope = await sessionScope(user);
  if (patch.crmContactId && !(await canSeeRecord(ws, 'crm_contacts', patch.crmContactId, scope))) throw new InboxError('invalid_contact', 400);
  if (patch.crmCompanyId && !(await canSeeRecord(ws, 'crm_companies', patch.crmCompanyId, scope))) throw new InboxError('invalid_company', 400);
  const prev = await linkRow(ws, owner, thread.id);
  const contact = patch.crmContactId !== undefined ? patch.crmContactId || null : (prev?.crm_contact_id ?? null);
  const company = patch.crmCompanyId !== undefined ? patch.crmCompanyId || null : (prev?.crm_company_id ?? null);
  const db = getDb();
  if (!contact && !company) {
    await db.prepare('DELETE FROM inbox_crm_links WHERE thread_id = ? AND workspace_id = ? AND owner_id = ?').run(thread.id, ws, owner);
  } else {
    await db
      .prepare(
        `INSERT INTO inbox_crm_links (thread_id, workspace_id, owner_id, crm_contact_id, crm_company_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, workspace_id) DO UPDATE SET crm_contact_id = excluded.crm_contact_id, crm_company_id = excluded.crm_company_id, updated_at = excluded.updated_at`,
      )
      .run(thread.id, ws, owner, contact, company, nowIso());
  }
  return inboxCrm(user, owner, thread.id);
}
