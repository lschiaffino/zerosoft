/**
 * Groups: aviso por email (y en la app) cuando vence el SLA de un ticket.
 * Lo llama markBreachedTickets después de reclamar la fila (breached_at), así
 * que cada vencimiento avisa una sola vez aunque corran dos crons. Los
 * destinatarios salen de los ajustes: la persona asignada, los admins del
 * workspace y emails extra. El email va por lib/email.ts (Resend si está
 * RESEND_API_KEY; si no, a la consola). Server-only.
 */
import { getDb } from './db';
import { appSender, escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { createNotification } from './notifications';
import { siteUrl } from './board-urls';
import { getSettings } from './groups';
import type { GroupsSettings } from './groups-rules';
import type { TicketDto } from './groups-tickets';
import en from '@/messages/en/groups.json';
import es from '@/messages/es/groups.json';
import pt from '@/messages/pt/groups.json';

type Locale = 'en' | 'es' | 'pt';
type SlaStrings = typeof en.slaEmail;

const STRINGS: Record<Locale, SlaStrings> = {
  en: en.slaEmail,
  es: { ...en.slaEmail, ...es.slaEmail },
  pt: { ...en.slaEmail, ...pt.slaEmail },
};

function fill(s: string, vars: Record<string, string>): string {
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

export interface SlaRecipient {
  email: string;
  /** Persona del workspace (recibe también el aviso en la app). */
  userId?: string;
}

/** Destinatarios según los ajustes, sin repetir emails. */
export async function slaRecipients(ws: string, settings: GroupsSettings, ticket: Pick<TicketDto, 'assigneeId'>): Promise<SlaRecipient[]> {
  const db = getDb();
  const out = new Map<string, SlaRecipient>();
  const add = (email: string | null | undefined, userId?: string) => {
    const e = String(email ?? '').trim().toLowerCase();
    if (!e || out.has(e)) return;
    out.set(e, { email: e, ...(userId ? { userId } : {}) });
  };
  if (settings.slaEmailAssignee && ticket.assigneeId) {
    const u = (await db.prepare('SELECT id, email FROM users WHERE id = ?').get(ticket.assigneeId)) as { id: string; email: string } | undefined;
    if (u) add(u.email, u.id);
  }
  if (settings.slaEmailAdmins) {
    const owner = (await db.prepare('SELECT id, email FROM users WHERE id = ?').get(ws)) as { id: string; email: string } | undefined;
    if (owner) add(owner.email, owner.id);
    const admins = (await db
      .prepare(
        `SELECT u.id, u.email FROM team_members m JOIN teams t ON t.id = m.team_id JOIN users u ON u.id = m.user_id
         WHERE t.owner_id = ? AND m.role IN ('owner', 'admin')`,
      )
      .all(ws)) as Array<{ id: string; email: string }>;
    for (const a of admins) add(a.email, a.id);
  }
  for (const e of settings.slaEmailExtra) add(e);
  return [...out.values()];
}

export function buildSlaEmail(
  ticket: Pick<TicketDto, 'number' | 'title' | 'chatName'>,
  kind: 'first_response' | 'resolution',
  locale: Locale,
  link: string,
): { subject: string; text: string; html: string } {
  const s = STRINGS[locale];
  const vars = { number: String(ticket.number), title: ticket.title, chat: ticket.chatName || '-', kind: kind === 'first_response' ? s.firstResponse : s.resolution };
  const subject = fill(s.subject, vars);
  const body = fill(s.body, vars);
  const text = [body, '', `${s.open}: ${link}`, '', s.why].join('\n');
  const html = renderBrandedHtml({
    heading: s.heading,
    eyebrow: 'zerosoft · groups',
    paragraphs: [
      escapeHtml(body),
      `<a href="${escapeHtml(link)}">${escapeHtml(s.open)}</a>`,
      `<span style="color:#888888;font-size:12px;">${escapeHtml(s.why)}</span>`,
    ],
  });
  return { subject, text, html };
}

/** Avisa el vencimiento. Devuelve a cuántos les mandó el email. */
export async function notifyBreach(ws: string, ticket: TicketDto, kind: 'first_response' | 'resolution'): Promise<number> {
  const settings = await getSettings(ws);
  if (!settings.slaEmail) return 0;
  const recipients = await slaRecipients(ws, settings, ticket);
  if (recipients.length === 0) return 0;
  const locale = settings.locale;
  const href = `/app/groups/tickets?open=${encodeURIComponent(ticket.id)}`;
  const mail = buildSlaEmail(ticket, kind, locale, `${siteUrl()}/${locale}${href}`);
  let sent = 0;
  for (const r of recipients) {
    const res = await sendEmail({ to: r.email, from: appSender(), ...mail }).catch(() => ({ ok: false }));
    if (res.ok) sent++;
    if (r.userId) {
      await createNotification({
        userId: r.userId,
        type: 'groups_sla',
        title: mail.subject,
        body: ticket.chatName || undefined,
        href,
        sourceType: 'groups_ticket',
        sourceId: ticket.id,
        meta: { number: ticket.number, kind },
      }).catch(() => undefined);
    }
  }
  return sent;
}
