/**
 * Invitar gente al workspace por email: crear (o reusar) la invitación,
 * mandar el email (lib/invite-email.ts) y registrar cómo salió. Si el email
 * no sale, la invitación igual queda y la UI ofrece copiar el link.
 */
import { getDb, type TeamInviteRow, type TeamRow } from './db';
import { rateLimit } from './rate-limit';
import {
  createInvite,
  getInvite,
  markInviteSent,
  normalizeInviteRole,
  renewInvite,
  sendInviteEmail,
  type InviteRole,
} from './teams';
import { getMembership, parseApps, updateWorkspace, workspaceModeOf, type AppAccess } from './workspace';

export const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export const MAX_INVITES_PER_REQUEST = 50;

/** Separa una lista pegada ("a@x.com, b@y.com\nc@z.com", "Ana <ana@x.com>") en emails únicos, en minúsculas. */
export function parseEmailList(raw: unknown): { valid: string[]; invalid: string[] } {
  // "Ana Pérez <ana@x.com>" → "ana@x.com" antes de partir por comas y espacios.
  const text = (Array.isArray(raw) ? raw.map(String).join(',') : String(raw ?? '')).replace(/[^,;\n<>]*<([^<>]+)>/g, ',$1,');
  const parts = text
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/<([^>]+)>/.exec(p)?.[1] ?? p).replace(/^mailto:/i, '').trim().toLowerCase());
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (EMAIL_RE.test(p) && p.length <= 254) {
      if (!valid.includes(p)) valid.push(p);
    } else if (!/^<|>$/.test(p) && !invalid.includes(p)) invalid.push(p);
  }
  return { valid, invalid };
}

export function inviteUrl(base: string, token: string, locale: string): string {
  const l = locale === 'es' || locale === 'pt' ? locale : 'en';
  return `${base.replace(/\/$/, '')}/${l}/invite/${token}`;
}

export type InviteOutcome = {
  email: string;
  status: 'sent' | 'failed' | 'skipped' | 'member' | 'invalid' | 'limited';
  inviteId?: string;
  url?: string;
  error?: string;
};

export interface Inviter {
  id: string;
  name: string | null;
  email: string;
}

async function validGroupIds(ownerId: string, ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const id of [...new Set(ids.filter((x): x is string => typeof x === 'string'))].slice(0, 50)) {
    const ok = await getDb().prepare('SELECT 1 AS x FROM workspace_groups WHERE id = ? AND workspace_id = ?').get(id, ownerId);
    if (ok) out.push(id);
  }
  return out;
}

/** Manda (o vuelve a mandar) el email de una invitación y lo registra (teams.sendInviteEmail). */
async function deliver(_team: TeamRow, invite: TeamInviteRow, inviter: Inviter, base: string): Promise<InviteOutcome> {
  const url = inviteUrl(base, invite.token, invite.locale ?? 'en');
  const res = await sendInviteEmail(invite, { url, locale: invite.locale, invitedBy: inviter });
  return { email: invite.email, status: res.status, inviteId: invite.id, url, ...(res.error ? { error: res.error } : {}) };
}

/**
 * Invita a varias personas. Quien ya es parte queda como 'member' (no se le
 * manda nada); cada una de las demás recibe su link de un solo uso.
 */
export async function inviteMany(opts: {
  team: TeamRow;
  inviter: Inviter;
  emails: unknown;
  role?: unknown;
  apps?: unknown;
  groupIds?: unknown;
  locale?: string;
  base: string;
}): Promise<{ results: InviteOutcome[]; invalid: string[] }> {
  const { valid, invalid } = parseEmailList(opts.emails);
  const role: InviteRole = normalizeInviteRole(opts.role);
  const apps: AppAccess = role === 'guest' ? [] : parseApps(Array.isArray(opts.apps) ? opts.apps : opts.apps ?? '*');
  const groupIds = role === 'guest' ? [] : await validGroupIds(opts.team.owner_id, opts.groupIds);
  const results: InviteOutcome[] = [];
  // Invitar a alguien pasa el workspace a modo equipo.
  if (valid.length && workspaceModeOf(opts.team) === 'personal') await updateWorkspace(opts.team.id, { mode: 'team' });
  // Cuentas nuevas (menos de 7 días): como mucho 20 invitaciones por día, para frenar el envío masivo.
  const inviterRow = (await getDb().prepare('SELECT created_at FROM users WHERE id = ?').get(opts.inviter.id)) as { created_at?: string } | undefined;
  const createdMs = inviterRow?.created_at ? Date.parse(inviterRow.created_at.replace(' ', 'T') + (inviterRow.created_at.includes('Z') ? '' : 'Z')) : 0;
  const newAccount = Number.isFinite(createdMs) && Date.now() - createdMs < 7 * 86_400_000;
  for (const email of valid.slice(0, MAX_INVITES_PER_REQUEST)) {
    const existing = (await getDb().prepare('SELECT id FROM users WHERE lower(email) = ?').get(email)) as { id: string } | undefined;
    if (existing) {
      const m = await getMembership(opts.team, existing.id);
      if (m && (m.role !== 'guest' || role === 'guest')) {
        results.push({ email, status: 'member' });
        continue;
      }
    }
    const limit = newAccount
      ? await rateLimit(`invite:new-account:${opts.inviter.id}`, 20, 86_400)
      : await rateLimit(`invite:send:${opts.team.id}`, 200, 86_400);
    if (!limit.ok) {
      results.push({ email, status: 'limited' });
      continue;
    }
    const invite = await createInvite(opts.team.id, email, opts.inviter.id, { role, apps, groupIds, locale: opts.locale });
    results.push(await deliver(opts.team, invite, opts.inviter, opts.base));
  }
  return { results, invalid: [...invalid, ...valid.slice(MAX_INVITES_PER_REQUEST)] };
}

/**
 * Reenvía una invitación pendiente: renueva el vencimiento y vuelve a mandar
 * el email. Como mucho una vez por minuto y cinco por día por invitación.
 */
export async function resendInvite(opts: {
  team: TeamRow;
  inviteId: string;
  inviter: Inviter;
  base: string;
}): Promise<InviteOutcome | { error: 'not_found' | 'rate_limited' }> {
  const invite = await getInvite(opts.inviteId, opts.team.id);
  if (!invite || invite.status !== 'pending') return { error: 'not_found' };
  const minute = await rateLimit(`invite:resend:${invite.id}`, 1, 60);
  const day = minute.ok ? await rateLimit(`invite:resend-day:${invite.id}`, 5, 86_400) : minute;
  if (!minute.ok || !day.ok) return { error: 'rate_limited' };
  // Reenviar renueva el plazo (también si ya había vencido).
  await renewInvite(invite.id, opts.team.id);
  const fresh = (await getInvite(invite.id, opts.team.id))!;
  return deliver(opts.team, fresh, opts.inviter, opts.base);
}
