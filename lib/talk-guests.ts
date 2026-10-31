/**
 * Talk: invitados (como los guests de Slack). Un invitado es una cuenta que no
 * está en el team del workspace: solo entra a Talk y solo ve los canales donde
 * lo sumaron (ni los públicos, ni el directorio, ni otras apps del workspace).
 *
 * Un admin invita un email a uno o más canales. Si la cuenta ya existe y ya
 * es invitada, se suma a los canales al toque; si no, sale un email con un
 * link de un solo uso (/api/talk/guests/accept?token=…) que se acepta con una
 * sesión de ese mismo email. La persona elige el workspace de Talk con el
 * selector del sidebar (cookie TALK_WS_COOKIE); resolveTalkActor solo lo
 * respeta si sigue siendo invitada ahí.
 *
 * Sacar a un invitado borra su fila de talk_guests y corre talkPersonRemoved:
 * pierde los canales, los avisos y el tiempo real en el momento.
 */
import { createHash, randomBytes } from 'crypto';
import { getDb, getUserByEmail } from './db';
import { appSender, escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { siteUrl } from './board-urls';
import type { SessionUser } from './session';
import { roleAtLeast } from './teams';
import { personAppAccess } from './api-auth';
import {
  TalkError,
  addMembers,
  emitTalkEvent,
  getChannelDto,
  nowIso,
  readableChannel,
  talkActor,
  talkPersonRemoved,
  workspacePersonKind,
  type TalkActor,
} from './talk';
import en from '@/messages/en/talk.json';
import es from '@/messages/es/talk.json';
import pt from '@/messages/pt/talk.json';

export const TALK_WS_COOKIE = 'zs_talk_ws';
export const GUEST_INVITE_TTL_DAYS = 14;
const MAX_PENDING = 200;

type Locale = 'en' | 'es' | 'pt';
const MAIL = { en: en.guests.email, es: { ...en.guests.email, ...es.guests.email }, pt: { ...en.guests.email, ...pt.guests.email } };

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

export async function isTalkGuest(workspaceId: string, userId: string): Promise<boolean> {
  return (await workspacePersonKind(workspaceId, userId)) === 'guest';
}

/** Lee la cookie del workspace de Talk elegido (fuera de una request, null). */
async function chosenWorkspace(): Promise<string | null> {
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get(TALK_WS_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Actor de Talk de la sesión: el workspace activo, o el workspace donde la
 * persona es invitada si lo eligió en el selector (y lo sigue siendo).
 */
export async function resolveTalkActor(user: SessionUser, opts: { workspaceId?: string | null } = {}): Promise<TalkActor> {
  const base = talkActor(user);
  const ws = opts.workspaceId ?? (await chosenWorkspace());
  if (ws && ws !== base.workspaceId && (await isTalkGuest(ws, base.personId))) {
    return { workspaceId: ws, personId: base.personId, role: 'member', teamId: null, guest: true };
  }
  return base;
}

export interface TalkWorkspaceOption {
  id: string;
  name: string;
  guest: boolean;
}

export type TalkChannelRoute = { kind: 'here' } | { kind: 'switch'; workspaceId: string } | { kind: 'missing' };

/**
 * Qué hacer con un link a un canal: abrirlo acá, cambiar a otro workspace de
 * Talk de la persona (el suyo o uno donde es invitada) o responder 404. Un
 * canal de un workspace ajeno, o uno que no puede leer, da lo mismo que un id
 * inventado: 'missing'. Es la única búsqueda de canales sin filtro de workspace.
 */
export async function resolveTalkChannelRoute(user: SessionUser, channelId: string): Promise<TalkChannelRoute> {
  const actor = await resolveTalkActor(user);
  if (await getChannelDto(actor, channelId)) return { kind: 'here' };
  const row = (await getDb().prepare('SELECT workspace_id FROM talk_channels WHERE id = ?').get(channelId)) as { workspace_id: string } | undefined;
  if (!row || row.workspace_id === actor.workspaceId) return { kind: 'missing' };
  const other = await resolveTalkActor(user, { workspaceId: row.workspace_id });
  if (other.workspaceId !== row.workspace_id || !(await getChannelDto(other, channelId))) return { kind: 'missing' };
  return { kind: 'switch', workspaceId: row.workspace_id };
}

/** Workspaces de Talk de la persona: el de su sesión y los que la invitaron. */
export async function talkWorkspaces(user: SessionUser): Promise<TalkWorkspaceOption[]> {
  const base = talkActor(user);
  const own = user.team?.name?.trim() || user.name?.trim() || user.email;
  const rows = (await getDb()
    .prepare(
      `SELECT g.workspace_id, COALESCE((SELECT t.name FROM teams t WHERE t.owner_id = g.workspace_id ORDER BY t.created_at LIMIT 1), u.name, u.email) AS name
       FROM talk_guests g JOIN users u ON u.id = g.workspace_id WHERE g.user_id = ? ORDER BY name`,
    )
    .all(base.personId)) as Array<{ workspace_id: string; name: string | null }>;
  return [
    { id: base.workspaceId, name: own, guest: false },
    ...rows.filter((r) => r.workspace_id !== base.workspaceId).map((r) => ({ id: r.workspace_id, name: r.name?.trim() || 'Workspace', guest: true })),
  ];
}

export interface TalkGuestDto {
  userId: string;
  name: string;
  email: string;
  channelIds: string[];
  createdAt: string;
}

export interface TalkGuestInviteDto {
  id: string;
  email: string;
  channelIds: string[];
  createdAt: string;
  expiresAt: string;
}

function assertAdmin(actor: TalkActor): void {
  if (actor.guest || !roleAtLeast(actor.role, 'admin')) throw new TalkError('forbidden', 403);
}

export async function listGuests(actor: TalkActor): Promise<{ guests: TalkGuestDto[]; invites: TalkGuestInviteDto[] }> {
  assertAdmin(actor);
  const db = getDb();
  const guests = (await db
    .prepare(
      `SELECT g.user_id, g.created_at, u.name, u.email,
         (SELECT group_concat(m.channel_id) FROM talk_members m JOIN talk_channels c ON c.id = m.channel_id
           WHERE m.user_id = g.user_id AND c.workspace_id = g.workspace_id AND c.kind IN ('public', 'private')) AS channels
       FROM talk_guests g JOIN users u ON u.id = g.user_id WHERE g.workspace_id = ? ORDER BY COALESCE(u.name, u.email)`,
    )
    .all(actor.workspaceId)) as Array<{ user_id: string; created_at: string; name: string | null; email: string; channels: string | null }>;
  const invites = (await db
    .prepare('SELECT id, email, channel_ids, created_at, expires_at FROM talk_guest_invites WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at DESC')
    .all(actor.workspaceId)) as Array<{ id: string; email: string; channel_ids: string; created_at: string; expires_at: string }>;
  return {
    guests: guests.map((g) => ({
      userId: g.user_id,
      name: g.name?.trim() || g.email.split('@')[0],
      email: g.email,
      channelIds: g.channels ? g.channels.split(',') : [],
      createdAt: g.created_at,
    })),
    invites: invites.map((i) => ({ id: i.id, email: i.email, channelIds: parseIds(i.channel_ids), createdAt: i.created_at, expiresAt: i.expires_at })),
  };
}

function parseIds(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Canales a los que se puede invitar: de este workspace, sin archivar, y legibles por quien invita. */
async function invitableChannels(actor: TalkActor, ids: string[]): Promise<Array<{ id: string; name: string }>> {
  const unique = [...new Set(ids)].slice(0, 20);
  if (!unique.length) throw new TalkError('guest_needs_channel');
  const out: Array<{ id: string; name: string }> = [];
  for (const id of unique) {
    const access = await readableChannel(actor, id);
    if (!access || access.channel.archived_at || (access.channel.kind !== 'public' && access.channel.kind !== 'private')) throw new TalkError('invalid_channel');
    // A un privado solo invita alguien que está adentro.
    if (access.channel.kind === 'private' && !access.member) throw new TalkError('invalid_channel');
    out.push({ id, name: access.channel.name });
  }
  return out;
}

export type InviteGuestResult = { kind: 'added'; userId: string } | { kind: 'invited'; invite: TalkGuestInviteDto; emailed: boolean; token: string };

export async function inviteGuest(actor: TalkActor, input: { email: string; channelIds: string[]; locale?: string | null; inviterName?: string }): Promise<InviteGuestResult> {
  assertAdmin(actor);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new TalkError('invalid_email');
  const channels = await invitableChannels(actor, input.channelIds);
  const db = getDb();
  const existing = await getUserByEmail(email);
  if (existing) {
    const kind = await workspacePersonKind(actor.workspaceId, existing.id);
    // Ya es del team (aunque sin la app Talk): se le da la app desde Equipos, no se la invita.
    if (kind === 'member' || (await personAppAccess(actor.workspaceId, existing.id))) throw new TalkError('already_member', 409);
    if (kind === 'guest') {
      await addMembers(channels[0].id, [existing.id]);
      for (const c of channels.slice(1)) await addMembers(c.id, [existing.id]);
      for (const c of channels) await emitTalkEvent(actor.workspaceId, 'channel', { channelId: c.id, actorId: actor.personId, payload: { change: 'members' } });
      return { kind: 'added', userId: existing.id };
    }
  }
  const pending = (await db.prepare('SELECT COUNT(*) AS n FROM talk_guest_invites WHERE workspace_id = ? AND accepted_at IS NULL').get(actor.workspaceId)) as { n: number };
  if (Number(pending.n) >= MAX_PENDING) throw new TalkError('invite_limit', 429);
  const token = randomBytes(24).toString('base64url');
  const now = nowIso();
  const expires = new Date(Date.now() + GUEST_INVITE_TTL_DAYS * 86_400_000).toISOString();
  await db
    .prepare(
      `INSERT INTO talk_guest_invites (id, workspace_id, email, channel_ids, token_hash, invited_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, email) DO UPDATE SET channel_ids = excluded.channel_ids, token_hash = excluded.token_hash,
         invited_by = excluded.invited_by, created_at = excluded.created_at, expires_at = excluded.expires_at, accepted_at = NULL, accepted_user_id = NULL`,
    )
    .run(crypto.randomUUID(), actor.workspaceId, email, JSON.stringify(channels.map((c) => c.id)), hashToken(token), actor.personId, now, expires);
  const row = (await db.prepare('SELECT id, email, channel_ids, created_at, expires_at FROM talk_guest_invites WHERE workspace_id = ? AND email = ?').get(actor.workspaceId, email)) as {
    id: string;
    email: string;
    channel_ids: string;
    created_at: string;
    expires_at: string;
  };
  const locale: Locale = input.locale === 'es' || input.locale === 'pt' ? input.locale : 'en';
  const s = MAIL[locale];
  const where = channels.map((c) => `#${c.name}`).join(', ');
  const inviter = input.inviterName?.trim() || 'Someone';
  const link = `${siteUrl()}/api/talk/guests/accept?token=${token}&locale=${locale}`;
  const sent = await sendEmail({
    from: appSender(),
    to: email,
    subject: fill(s.subject, { name: inviter }),
    text: `${fill(s.line, { name: inviter, channels: where })}\n\n${link}\n\n${s.note}`,
    html: renderBrandedHtml({
      eyebrow: 'zerosoft · talk',
      heading: fill(s.subject, { name: inviter }),
      paragraphs: [escapeHtml(fill(s.line, { name: inviter, channels: where })), `<a href="${escapeHtml(link)}">${escapeHtml(s.open)}</a>`, escapeHtml(s.note)],
    }),
  }).catch(() => ({ ok: false }));
  return {
    kind: 'invited',
    invite: { id: row.id, email: row.email, channelIds: parseIds(row.channel_ids), createdAt: row.created_at, expiresAt: row.expires_at },
    emailed: sent.ok,
    token,
  };
}

export async function revokeGuestInvite(actor: TalkActor, inviteId: string): Promise<boolean> {
  assertAdmin(actor);
  return (await getDb().prepare('DELETE FROM talk_guest_invites WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL').run(inviteId, actor.workspaceId)).changes > 0;
}

export type AcceptGuestResult =
  | { ok: true; workspaceId: string; channelId: string | null }
  | { ok: false; reason: 'invalid' | 'expired' | 'email_mismatch' | 'already_member' };

/**
 * Acepta la invitación con la cuenta de la sesión (tiene que ser el email
 * invitado). Claim por fila: dos clics no suman dos veces.
 */
export async function acceptGuestInvite(token: string, user: { id: string; email: string }, now = new Date()): Promise<AcceptGuestResult> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, reason: 'invalid' };
  const db = getDb();
  const row = (await db.prepare('SELECT * FROM talk_guest_invites WHERE token_hash = ?').get(hashToken(token))) as
    | { id: string; workspace_id: string; email: string; channel_ids: string; expires_at: string; accepted_at: string | null; accepted_user_id: string | null; invited_by: string | null }
    | undefined;
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.accepted_at) {
    if (row.accepted_user_id === user.id && (await isTalkGuest(row.workspace_id, user.id))) return { ok: true, workspaceId: row.workspace_id, channelId: parseIds(row.channel_ids)[0] ?? null };
    return { ok: false, reason: 'invalid' };
  }
  if (Date.parse(row.expires_at) < now.getTime()) return { ok: false, reason: 'expired' };
  if (user.email.trim().toLowerCase() !== row.email) return { ok: false, reason: 'email_mismatch' };
  const kind = await workspacePersonKind(row.workspace_id, user.id);
  if (kind === 'member' || (await personAppAccess(row.workspace_id, user.id))) return { ok: false, reason: 'already_member' };
  const claim = await db.prepare('UPDATE talk_guest_invites SET accepted_at = ?, accepted_user_id = ? WHERE id = ? AND accepted_at IS NULL').run(now.toISOString(), user.id, row.id);
  if (!claim.changes) return { ok: false, reason: 'invalid' };
  await db.prepare('INSERT OR IGNORE INTO talk_guests (workspace_id, user_id, invited_by, created_at) VALUES (?, ?, ?, ?)').run(row.workspace_id, user.id, row.invited_by, now.toISOString());
  await db.prepare('INSERT OR IGNORE INTO talk_prefs (workspace_id, user_id) VALUES (?, ?)').run(row.workspace_id, user.id);
  // Solo los canales que siguen existiendo, abiertos y que no son DMs.
  const ids: string[] = [];
  for (const id of parseIds(row.channel_ids)) {
    const c = (await db.prepare("SELECT id FROM talk_channels WHERE id = ? AND workspace_id = ? AND kind IN ('public', 'private') AND archived_at IS NULL").get(id, row.workspace_id)) as
      | { id: string }
      | undefined;
    if (c) ids.push(c.id);
  }
  for (const id of ids) {
    await addMembers(id, [user.id]);
    await emitTalkEvent(row.workspace_id, 'channel', { channelId: id, actorId: user.id, payload: { change: 'members' } });
  }
  return { ok: true, workspaceId: row.workspace_id, channelId: ids[0] ?? null };
}

/** Saca a un invitado del workspace: pierde todo en el momento. */
export async function removeGuest(actor: TalkActor, userId: string): Promise<boolean> {
  assertAdmin(actor);
  const db = getDb();
  const res = await db.prepare('DELETE FROM talk_guests WHERE workspace_id = ? AND user_id = ?').run(actor.workspaceId, userId);
  if (!res.changes) return false;
  await talkPersonRemoved(actor.workspaceId, userId);
  return true;
}
