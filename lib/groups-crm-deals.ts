/**
 * Los negocios del CRM de un chat de Lines, para la pestaña CRM del panel: los del contacto y la empresa vinculados
 * al chat. Con la visibilidad del CRM de quien mira (lib/crm-visibility.ts): sin la app CRM no hay nada; un
 * contacto o una empresa que no ve no cuenta (ni se nombra), y un negocio fuera de su alcance no aparece.
 */
import { getDb } from './db';
import type { SessionUser } from './session';
import { userCanUseApp } from './workspace';
import { canSeeRecord, scopeAnd, sessionScope } from './crm-visibility';

export interface ChatCrmDeal {
  id: string;
  name: string;
  amount: number;
  currency: string;
  stage: string;
  /** 'open' | 'won' | 'lost' */
  state: 'open' | 'won' | 'lost';
}

export async function chatCrmDeals(user: SessionUser, ws: string, chatId: string): Promise<ChatCrmDeal[]> {
  if (!userCanUseApp(user, 'crm')) return [];
  const chat = (await getDb().prepare('SELECT crm_contact_id, crm_company_id FROM groups_chats WHERE id = ? AND user_id = ?').get(chatId, ws)) as
    | { crm_contact_id: string | null; crm_company_id: string | null }
    | undefined;
  if (!chat) return [];
  return crmDealsFor(user, ws, { contactId: chat.crm_contact_id, companyId: chat.crm_company_id });
}

/**
 * Los negocios de un contacto y una empresa del CRM (los de un chat de Lines o de Inbox), con la visibilidad de
 * quien mira: un contacto o una empresa que no ve no cuenta, y un negocio fuera de su alcance no aparece.
 */
export async function crmDealsFor(user: SessionUser, ws: string, refs: { contactId: string | null; companyId: string | null }): Promise<ChatCrmDeal[]> {
  if (!userCanUseApp(user, 'crm') || user.role === 'guest') return [];
  const db = getDb();
  const scope = await sessionScope(user);
  const contactId = refs.contactId && (await canSeeRecord(ws, 'crm_contacts', refs.contactId, scope)) ? refs.contactId : null;
  const companyId = refs.companyId && (await canSeeRecord(ws, 'crm_companies', refs.companyId, scope)) ? refs.companyId : null;
  if (!contactId && !companyId) return [];
  const cond = scopeAnd('d', scope);
  const rows = (await db
    .prepare(
      `SELECT d.id, d.name, d.amount, d.currency, COALESCE(s.name, '') AS stage, COALESCE(s.is_won, 0) AS won, COALESCE(s.is_lost, 0) AS lost
       FROM crm_deals d
       LEFT JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ?
         AND (d.id IN (SELECT deal_id FROM crm_deal_contacts WHERE contact_id = ?)
           OR d.id IN (SELECT deal_id FROM crm_deal_companies WHERE company_id = ? AND user_id = ?))${cond.sql}
       ORDER BY COALESCE(s.is_won, 0) + COALESCE(s.is_lost, 0), d.updated_at DESC
       LIMIT 20`,
    )
    .all(ws, contactId ?? '', companyId ?? '', ws, ...cond.args)) as Array<{ id: string; name: string; amount: number; currency: string; stage: string; won: number; lost: number }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    amount: Number(r.amount) || 0,
    currency: r.currency || 'USD',
    stage: r.stage,
    state: Number(r.won) ? 'won' : Number(r.lost) ? 'lost' : 'open',
  }));
}
