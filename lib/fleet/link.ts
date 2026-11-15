/**
 * Fleet fuera de Fleet: avisos por WhatsApp a tu propio chat (el "Mensaje a mí mismo" de tu número conectado en
 * Inbox) cuando un agente termina, te espera o falla, y las respuestas que escribís ahí citando el aviso, que vuelven
 * a la cola del agente. Nunca se le escribe a otra persona: el único destino es el chat propio de la cuenta.
 * Server-only.
 */
import { randomUUID } from 'crypto';
import { getDb, getUserById } from '../db';
import type { SessionUser } from '../session';
import { userCanUseApp } from '../workspace';
import { rateLimit } from '../rate-limit';
import { getPrefs, nowIso, type FleetActor } from './core';
import { queueReply, type IngestOwner } from './sessions';
import { FleetError, clip, oneLine, type SessionStatus } from './types';
import en from '@/messages/en/fleet.json';
import es from '@/messages/es/fleet.json';
import pt from '@/messages/pt/fleet.json';

const NOTIFY_TEXT = { en: en.notifyWa, es: es.notifyWa, pt: pt.notifyWa } as const;
type NotifyKey = keyof typeof en.notifyWa;

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

/** Lo que muestra la sección "Inbox, Lines y WhatsApp" de los ajustes. */
export interface LinkOptions {
  /** Cuentas de WhatsApp de Inbox de la persona (para el aviso a su propio chat). */
  whatsapp: Array<{ id: string; label: string; connected: boolean }>;
  /** La persona tiene Lines en este workspace. */
  lines: boolean;
}

interface InboxAccount {
  id: string;
  owner_id: string;
  kind: string;
  label: string;
  address: string;
  status: string;
}

async function whatsappAccounts(person: string): Promise<InboxAccount[]> {
  try {
    return (await getDb()
      .prepare("SELECT id, owner_id, kind, label, address, status FROM inbox_accounts WHERE owner_id = ? AND kind = 'whatsapp' ORDER BY created_at")
      .all(person)) as InboxAccount[];
  } catch {
    return [];
  }
}

export async function linkOptions(actor: FleetActor, user: SessionUser): Promise<LinkOptions> {
  const accounts = await whatsappAccounts(actor.person);
  return {
    // El número no se muestra entero: alcanza con los últimos dígitos para reconocerlo.
    whatsapp: accounts.map((a) => ({ id: a.id, label: a.label || (a.address ? `…${a.address.slice(-4)}` : 'WhatsApp'), connected: a.status === 'connected' })),
    lines: userCanUseApp(user, 'groups'),
  };
}

/** La cuenta de WhatsApp de los avisos tiene que ser de Inbox de la misma persona. */
export async function checkNotifyAccount(actor: Pick<FleetActor, 'person'>, accountId: string): Promise<void> {
  if (!(await whatsappAccounts(actor.person)).some((a) => a.id === accountId)) throw new FleetError('account_not_found', 400);
}

function wantsNotify(notify: string, status: SessionStatus): boolean {
  if (notify === 'off') return false;
  if (status === 'waiting') return notify === 'waiting' || notify === 'both';
  return notify === 'done' || notify === 'both';
}

/**
 * Después de un Stop, un aviso que te espera o una falla: el aviso por WhatsApp a tu propio chat, si lo pediste.
 * Guarda el id del mensaje mandado (fila oculta role 'link') para reconocer la respuesta que lo cita.
 */
export async function afterAgentEvent(owner: IngestOwner, sessionId: string, status: SessionStatus, text: string): Promise<void> {
  const prefs = await getPrefs(owner);
  if (!wantsNotify(prefs.notify, status) || !prefs.notifyAccountId) return;
  if (process.env.RATE_LIMIT_DISABLED !== 'true') {
    const limited = await rateLimit(`fleet:notify:${sessionId}`, 6, 600);
    if (!limited.ok) return;
  }
  const { getAccount } = await import('../inbox/core');
  const { sendWhatsappText } = await import('../inbox/whatsapp');
  const { upsertThread } = await import('../inbox/core');
  let account;
  try {
    account = await getAccount(owner.person, prefs.notifyAccountId);
  } catch {
    return;
  }
  if (account.kind !== 'whatsapp' || account.status !== 'connected' || !account.address) return;
  const session = (await getDb().prepare('SELECT title, custom_title, project FROM fleet_sessions WHERE id = ? AND workspace_id = ? AND person_id = ?').get(sessionId, owner.ws, owner.person)) as
    | { title: string; custom_title: string; project: string }
    | undefined;
  if (!session) return;
  const user = await getUserById(owner.person);
  const loc = (user?.locale === 'es' || user?.locale === 'pt' ? user.locale : 'en') as keyof typeof NOTIFY_TEXT;
  const msgs = NOTIFY_TEXT[loc];
  const key: NotifyKey = status === 'waiting' ? 'waiting' : status === 'failed' ? 'failed' : 'done';
  const name = oneLine(session.custom_title || session.title || session.project || 'Claude Code', 80);
  const body = [fill(msgs[key], { name, project: session.project }), text ? clip(text.trim(), 700) : '', msgs.howToReply].filter(Boolean).join('\n\n');
  // El chat propio de la cuenta: "Mensaje a mí mismo".
  const thread = await upsertThread(account, { externalId: `${account.address}@s.whatsapp.net`, kind: 'dm', handle: account.address });
  const providerId = await sendWhatsappText(account, thread, body, { linkPreview: false });
  if (!providerId) return;
  await getDb()
    .prepare("INSERT INTO fleet_messages (id, session_id, workspace_id, person_id, role, event, text, status, source, external_ref, created_at) VALUES (?, ?, ?, ?, 'link', 'whatsapp', '', '', 'whatsapp', ?, ?)")
    .run(randomUUID(), sessionId, owner.ws, owner.person, providerId, nowIso());
}

/**
 * Un mensaje que escribiste en tu propio chat de WhatsApp (Inbox lo recibe con fromMe) citando un aviso de Fleet:
 * va a la cola de ese agente. Devuelve true si era una respuesta a un agente.
 */
export async function routeWhatsappReply(account: { id: string; owner_id: string; address: string }, e: { chatId: string; fromMe: boolean; body?: string; replyToProviderId?: string; history?: boolean; providerMessageId: string }): Promise<boolean> {
  if (!e.fromMe || e.history || !e.replyToProviderId || !e.body?.trim() || !account.address) return false;
  if (e.chatId !== `${account.address}@s.whatsapp.net`) return false;
  const link = (await getDb()
    .prepare("SELECT session_id, workspace_id, person_id FROM fleet_messages WHERE role = 'link' AND person_id = ? AND external_ref = ? LIMIT 1")
    .get(account.owner_id, e.replyToProviderId)) as { session_id: string; workspace_id: string; person_id: string } | undefined;
  if (!link) return false;
  // Un reintento del mismo mensaje no se encola dos veces.
  const dup = await getDb().prepare("SELECT 1 FROM fleet_messages WHERE session_id = ? AND role = 'reply' AND external_ref = ?").get(link.session_id, e.providerMessageId);
  if (dup) return true;
  await queueReply({ ws: link.workspace_id, person: link.person_id }, link.session_id, e.body, 'whatsapp', e.providerMessageId);
  return true;
}

/**
 * La fila "Agentes" de Inbox o de Lines: null si la persona no tiene Fleet o no prendió el espejo en esa app; si
 * no, cuántos mensajes sin leer y cuántos agentes la esperan.
 */
export async function mirrorSummary(user: SessionUser, app: 'inbox' | 'lines'): Promise<{ unread: number; waiting: number } | null> {
  if (!userCanUseApp(user, 'fleet') || user.role === 'guest') return null;
  const person = user.actingUser?.id ?? user.id;
  try {
    const prefs = await getPrefs({ ws: user.id, person });
    if (!(app === 'inbox' ? prefs.mirrorInbox : prefs.mirrorLines)) return null;
    const row = (await getDb()
      .prepare("SELECT COALESCE(SUM(unread), 0) AS unread, COALESCE(SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END), 0) AS waiting FROM fleet_sessions WHERE workspace_id = ? AND person_id = ? AND archived = 0")
      .get(user.id, person)) as { unread: number; waiting: number } | undefined;
    return { unread: Number(row?.unread ?? 0), waiting: Number(row?.waiting ?? 0) };
  } catch {
    return null;
  }
}
