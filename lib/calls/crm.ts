/**
 * Calls ↔ CRM. Server-only.
 * - Vínculo automático: los emails de los asistentes (del evento del
 *   calendario) → contactos del CRM → el deal abierto más reciente de esos
 *   contactos. Si la persona eligió un deal a mano, no se toca.
 * - Actividad "reunión" en el deal (y el contacto) con el resumen, los
 *   próximos pasos y el link. Una sola por llamada (compare-and-set).
 * - Deals con actividad de llamadas y señales de riesgo.
 */
import { getDb } from '../db';
import { createActivity, updateActivity } from '../crm';
import { canSeeOwner, type OwnerScope } from '../crm-visibility';
import { appBaseUrl } from '../calendar-notify';
import { getSettings } from './settings';
import { parseJson, type Attendee, type CallAnalysis, type CallsActor } from './types';
import type { CallRow } from './core';

const db = () => getDb();

/** Contactos del CRM por email (los primeros 20 asistentes con email). */
export async function contactsForEmails(ws: string, emails: string[]): Promise<Array<{ id: string; email: string; company_id: string | null }>> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))].slice(0, 20);
  if (!list.length) return [];
  return (await db()
    .prepare(`SELECT id, lower(email) AS email, company_id FROM crm_contacts WHERE user_id = ? AND lower(email) IN (${list.map(() => '?').join(',')})`)
    .all(ws, ...list)) as Array<{ id: string; email: string; company_id: string | null }>;
}

/** El deal abierto más reciente de esos contactos (o de sus empresas). */
export async function openDealFor(ws: string, contactIds: string[], companyIds: string[], scope: OwnerScope = null): Promise<string | null> {
  if (!contactIds.length && !companyIds.length) return null;
  const parts: string[] = [];
  const args: string[] = [ws];
  if (contactIds.length) {
    parts.push(`d.id IN (SELECT deal_id FROM crm_deal_contacts WHERE contact_id IN (${contactIds.map(() => '?').join(',')}))`);
    args.push(...contactIds);
  }
  if (companyIds.length) {
    parts.push(`d.id IN (SELECT deal_id FROM crm_deal_companies WHERE company_id IN (${companyIds.map(() => '?').join(',')}))`);
    args.push(...companyIds);
  }
  const rows = (await db()
    .prepare(`SELECT d.id, d.owner_id FROM crm_deals d WHERE d.user_id = ? AND d.closed_at IS NULL AND (${parts.join(' OR ')}) ORDER BY d.updated_at DESC LIMIT 20`)
    .all(...args)) as Array<{ id: string; owner_id: string | null }>;
  // Solo un deal que quien grabó ve en el CRM.
  return rows.find((r) => canSeeOwner(scope, r.owner_id, ws))?.id ?? null;
}

/** Alcance del CRM de quien grabó (no de quien procesa). */
async function ownerScope(ws: string, personId: string): Promise<OwnerScope> {
  const { ownerScopeFor } = await import('../crm-visibility');
  if (personId === ws) return null;
  const m = (await db()
    .prepare("SELECT m.role FROM team_members m JOIN teams t ON t.id = m.team_id WHERE t.owner_id = ? AND m.user_id = ? ORDER BY m.role = 'admin' DESC LIMIT 1")
    .get(ws, personId)) as { role: string } | undefined;
  return ownerScopeFor({ workspaceId: ws, personId, role: (m?.role ?? 'member') as never });
}

/** ¿Alguno de estos asistentes tiene un deal abierto? (regla "solo con deals"). */
export async function attendeesHaveDeal(ws: string, attendees: Attendee[]): Promise<boolean> {
  const contacts = await contactsForEmails(ws, attendees.map((a) => a.email));
  return Boolean(await openDealFor(ws, contacts.map((c) => c.id), contacts.map((c) => c.company_id).filter((x): x is string => Boolean(x))));
}

/** Completa contactos y deal de la llamada por los emails de los asistentes. */
export async function linkCallToCrm(row: CallRow): Promise<{ dealId: string | null; contactIds: string[] }> {
  const attendees = parseJson<Attendee[]>(row.attendees, []);
  const contacts = await contactsForEmails(row.workspace_id, attendees.map((a) => a.email));
  const contactIds = contacts.map((c) => c.id);
  let dealId = row.deal_id;
  if (!dealId) {
    const scope = await ownerScope(row.workspace_id, row.owner_id);
    dealId = await openDealFor(row.workspace_id, contactIds, contacts.map((c) => c.company_id).filter((x): x is string => Boolean(x)), scope);
  }
  await db().prepare('UPDATE calls SET contact_ids = ?, deal_id = ? WHERE id = ?').run(JSON.stringify(contactIds), dealId, row.id);
  return { dealId, contactIds };
}

function activityBody(row: CallRow, analysis: CallAnalysis | null): string {
  const out: string[] = [];
  if (analysis?.summary) out.push(analysis.summary, '');
  if (analysis?.nextSteps.length) out.push('Next steps:', ...analysis.nextSteps.map((n) => `- ${n.text}${n.owner ? ` (${n.owner})` : ''}`), '');
  out.push(`${appBaseUrl()}/app/calls/call/${row.id}`);
  return out.join('\n').slice(0, 8000);
}

/** Deja (o actualiza) la actividad de la llamada en el deal y el primer contacto. */
export async function logCallToCrm(row: CallRow): Promise<string | null> {
  const settings = await getSettings(row.workspace_id);
  if (!settings.logToCrm) return null;
  const contactIds = parseJson<string[]>(row.contact_ids, []);
  if (!row.deal_id && !contactIds.length) return null;
  const analysis = parseJson<CallAnalysis | null>(row.analysis, null);
  const subject = (row.title || 'Call').slice(0, 200);
  const durationMin = Math.max(1, Math.round(Number(row.duration_ms) / 60_000));
  // Llamadas privadas: en el CRM (que ven otros) solo queda el link.
  const body = settings.visibility === 'private' ? `${appBaseUrl()}/app/calls/call/${row.id}` : activityBody(row, analysis);
  const input = { subject, body, durationMin, dealId: row.deal_id ?? undefined, contactId: contactIds[0] ?? undefined };
  if (row.crm_activity_id && row.crm_activity_id !== 'pending') {
    const updated = await updateActivity(row.workspace_id, row.crm_activity_id, input).catch(() => null);
    if (updated) return updated.id;
  }
  const claim = await db()
    .prepare("UPDATE calls SET crm_activity_id = 'pending' WHERE id = ? AND (crm_activity_id IS NULL OR crm_activity_id = ?)")
    .run(row.id, row.crm_activity_id ?? '');
  if (!claim.changes) return null;
  try {
    const act = await createActivity(row.workspace_id, { type: 'meeting', ownerId: row.owner_id, ...input });
    await db().prepare('UPDATE calls SET crm_activity_id = ? WHERE id = ?').run(act.id, row.id);
    return act.id;
  } catch (err) {
    await db().prepare("UPDATE calls SET crm_activity_id = NULL WHERE id = ? AND crm_activity_id = 'pending'").run(row.id);
    throw err;
  }
}

// ---------- Deals ----------

export type DealRisk = 'no_recent_call' | 'no_next_step' | 'competitor' | 'objections' | 'single_threaded' | 'close_date_passed';

export interface DealCallsRow {
  id: string;
  name: string;
  amount: number;
  currency: string;
  closeDate: string | null;
  stage: string;
  calls: number;
  lastCallAt: string | null;
  lastCallId: string | null;
  nextSteps: string[];
  competitors: string[];
  externalPeople: number;
  risks: DealRisk[];
}

/** Deals abiertos con llamadas (o del alcance de la persona), con señales de riesgo. */
export async function dealsOverview(actor: CallsActor, scope: OwnerScope, now = new Date()): Promise<DealCallsRow[]> {
  const settings = await getSettings(actor.ws);
  const vis = `(? = 1 OR c.owner_id = ? OR ? = 'team')`;
  const deals = (await db()
    .prepare(
      `SELECT d.id, d.name, d.amount, d.currency, d.close_date, d.owner_id, COALESCE(s.name, '') AS stage
       FROM crm_deals d LEFT JOIN crm_stages s ON s.id = d.stage_id
       WHERE d.user_id = ? AND d.closed_at IS NULL
         AND EXISTS (SELECT 1 FROM calls c WHERE c.deal_id = d.id AND c.workspace_id = d.user_id AND c.deleted_at IS NULL AND c.status = 'ready' AND ${vis})
       ORDER BY d.updated_at DESC LIMIT 200`,
    )
    .all(actor.ws, actor.admin ? 1 : 0, actor.person, settings.visibility)) as Array<{ id: string; name: string; amount: number; currency: string; close_date: string | null; owner_id: string | null; stage: string }>;
  const visible = deals.filter((d) => canSeeOwner(scope, d.owner_id, actor.ws));
  if (!visible.length) return [];
  const calls = (await db()
    .prepare(
      `SELECT c.id, c.deal_id, COALESCE(c.started_at, c.created_at) AS at, c.analysis, c.speakers FROM calls c
       WHERE c.workspace_id = ? AND c.deleted_at IS NULL AND c.status = 'ready' AND c.deal_id IN (${visible.map(() => '?').join(',')}) AND ${vis}
       ORDER BY at DESC`,
    )
    .all(actor.ws, ...visible.map((d) => d.id), actor.admin ? 1 : 0, actor.person, settings.visibility)) as Array<{ id: string; deal_id: string; at: string; analysis: string | null; speakers: string }>;
  const today = now.toISOString().slice(0, 10);
  return visible
    .map((d) => {
      const mine = calls.filter((c) => c.deal_id === d.id);
      const last = mine[0];
      const lastAnalysis = parseJson<CallAnalysis | null>(last?.analysis, null);
      const recent = mine.filter((c) => now.getTime() - Date.parse(c.at) < 30 * 86_400_000);
      const competitors = [...new Set(recent.flatMap((c) => parseJson<CallAnalysis | null>(c.analysis, null)?.competitors.map((x) => x.name) ?? []))];
      const external = new Set(mine.flatMap((c) => parseJson<Array<{ name: string; side: string }>>(c.speakers, []).filter((s) => s.side === 'external').map((s) => s.name.toLowerCase())));
      const risks: DealRisk[] = [];
      if (last && now.getTime() - Date.parse(last.at) > 14 * 86_400_000) risks.push('no_recent_call');
      if (lastAnalysis && !lastAnalysis.nextSteps.length) risks.push('no_next_step');
      if (competitors.length) risks.push('competitor');
      if (lastAnalysis?.objections.some((o) => !o.response.trim())) risks.push('objections');
      if (mine.length && external.size <= 1) risks.push('single_threaded');
      if (d.close_date && d.close_date.slice(0, 10) < today) risks.push('close_date_passed');
      return {
        id: d.id,
        name: d.name,
        amount: Number(d.amount) || 0,
        currency: d.currency,
        closeDate: d.close_date,
        stage: d.stage,
        calls: mine.length,
        lastCallAt: last?.at ?? null,
        lastCallId: last?.id ?? null,
        nextSteps: (lastAnalysis?.nextSteps ?? []).slice(0, 3).map((n) => n.text),
        competitors,
        externalPeople: external.size,
        risks,
      };
    })
    .sort((a, b) => b.risks.length - a.risks.length || (b.lastCallAt ?? '').localeCompare(a.lastCallAt ?? ''));
}

/** Deals para el selector de la llamada (por nombre), los que la persona ve. */
export async function searchDeals(actor: CallsActor, scope: OwnerScope, q: string): Promise<Array<{ id: string; name: string }>> {
  const term = q.trim();
  const like = `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const rows = (await db()
    .prepare(`SELECT id, name, owner_id FROM crm_deals WHERE user_id = ? AND closed_at IS NULL ${term ? "AND name LIKE ? ESCAPE '\\'" : ''} ORDER BY updated_at DESC LIMIT 40`)
    .all(...(term ? [actor.ws, like] : [actor.ws]))) as Array<{ id: string; name: string; owner_id: string | null }>;
  return rows.filter((r) => canSeeOwner(scope, r.owner_id, actor.ws)).slice(0, 20).map((r) => ({ id: r.id, name: r.name }));
}
