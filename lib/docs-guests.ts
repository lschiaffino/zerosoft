/**
 * Docs: invitados externos por email (como los guests de Notion).
 *
 * Invitar un email sin cuenta crea una invitación pendiente y manda un mail
 * con un link de un solo uso. Al abrirlo con una sesión de ese mismo email
 * (entrando o creando la cuenta) la invitación se vuelve un share por persona
 * con el rol elegido: la persona ve solo esa página y sus subpáginas, sin
 * entrar al workspace. Es compatible con un rol "guest" de workspace futuro:
 * el acceso vive en docs_shares, por recurso.
 */
import { createHash, randomBytes } from 'crypto';
import { getDb, getUserByEmail, type DocsPageRow, type UserRow } from './db';
import { createDocShare } from './docs';
import { normalizeDocsRole, type DocsRole } from './docs-access';
import { appSender, escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { siteUrl } from './board-urls';
import en from '@/messages/en/docs.json';
import es from '@/messages/es/docs.json';
import pt from '@/messages/pt/docs.json';

/** Una invitación sin aceptar vence a los 30 días. */
export const INVITE_TTL_DAYS = 30;
/** Tope de invitaciones pendientes por página. */
export const INVITES_PER_PAGE_MAX = 100;

export interface DocsGuestInvite {
  id: string;
  page_id: string;
  email: string;
  role: DocsRole;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
}

type Locale = 'en' | 'es' | 'pt';
const STRINGS = { en: en.emails, es: es.emails, pt: pt.emails };

function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class GuestInviteLimitError extends Error {
  constructor() {
    super('invite_limit');
  }
}

/** Crea (o renueva) la invitación de un email a una página y devuelve el token en claro. */
export async function createGuestInvite(args: {
  page: DocsPageRow;
  email: string;
  role: DocsRole;
  invitedBy: UserRow;
  locale?: string | null;
}): Promise<{ invite: DocsGuestInvite; token: string; emailed: boolean }> {
  const email = args.email.trim().toLowerCase();
  const pending = (await getDb()
    .prepare('SELECT COUNT(*) AS n FROM docs_guest_invites WHERE page_id = ? AND accepted_at IS NULL')
    .get(args.page.id)) as { n: number };
  if (Number(pending.n) >= INVITES_PER_PAGE_MAX) throw new GuestInviteLimitError();
  const token = randomBytes(24).toString('base64url');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await getDb()
    .prepare(
      `INSERT INTO docs_guest_invites (id, page_id, workspace_id, email, role, token_hash, invited_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id, email) DO UPDATE SET role = excluded.role, token_hash = excluded.token_hash,
         invited_by = excluded.invited_by, created_at = excluded.created_at, accepted_at = NULL, accepted_user_id = NULL`,
    )
    .run(id, args.page.id, args.page.user_id, email, args.role, hashToken(token), args.invitedBy.id, now);
  const row = (await getDb()
    .prepare('SELECT * FROM docs_guest_invites WHERE page_id = ? AND email = ?')
    .get(args.page.id, email)) as DocsGuestInvite & { role: string };
  const locale: Locale = args.locale === 'es' || args.locale === 'pt' ? args.locale : 'en';
  const s = STRINGS[locale];
  const inviter = args.invitedBy.name?.trim() || args.invitedBy.email;
  const title = args.page.title.trim() || s.untitled;
  const link = `${siteUrl()}/${locale}/app/docs/invite/${token}`;
  const sent = await sendEmail({
    from: appSender(),
    to: email,
    subject: fill(s.guestSubject, { name: inviter, title }),
    text: `${fill(s.guestLine, { name: inviter, title })}\n\n${link}\n\n${s.guestNote}`,
    html: renderBrandedHtml({
      eyebrow: 'zerosoft · docs',
      heading: title,
      paragraphs: [
        escapeHtml(fill(s.guestLine, { name: inviter, title })),
        `<a href="${escapeHtml(link)}">${escapeHtml(s.guestOpen)}</a>`,
        escapeHtml(s.guestNote),
      ],
    }),
  }).catch(() => ({ ok: false }));
  return { invite: { ...row, role: normalizeDocsRole(row.role) }, token, emailed: sent.ok };
}

export async function listPageInvites(pageId: string): Promise<DocsGuestInvite[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT id, page_id, email, role, invited_by, created_at, accepted_at FROM docs_guest_invites
       WHERE page_id = ? AND accepted_at IS NULL ORDER BY created_at DESC`,
    )
    .all(pageId)) as Array<DocsGuestInvite & { role: string }>;
  return rows.map((r) => ({ ...r, role: normalizeDocsRole(r.role) }));
}

export async function revokeGuestInvite(pageId: string, inviteId: string): Promise<DocsGuestInvite | null> {
  const row = (await getDb()
    .prepare('SELECT * FROM docs_guest_invites WHERE id = ? AND page_id = ? AND accepted_at IS NULL')
    .get(inviteId, pageId)) as (DocsGuestInvite & { role: string }) | undefined;
  if (!row) return null;
  await getDb().prepare('DELETE FROM docs_guest_invites WHERE id = ?').run(inviteId);
  return { ...row, role: normalizeDocsRole(row.role) };
}

export type AcceptResult =
  | { ok: true; pageId: string; workspaceId: string; email: string; /** Recién aceptada (no una segunda visita al link). */ first: boolean }
  | { ok: false; reason: 'invalid' | 'expired' | 'email_mismatch'; email?: string };

/**
 * Acepta una invitación con la sesión de `user`. El email de la cuenta tiene
 * que ser el invitado: un link reenviado no le da acceso a otra persona.
 * El claim es por fila (accepted_at IS NULL): dos clics no crean dos shares.
 */
export async function acceptGuestInvite(token: string, user: UserRow, now = new Date()): Promise<AcceptResult> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, reason: 'invalid' };
  const row = (await getDb()
    .prepare('SELECT * FROM docs_guest_invites WHERE token_hash = ?')
    .get(hashToken(token))) as
    | { id: string; page_id: string; workspace_id: string; email: string; role: string; created_at: string; accepted_at: string | null; accepted_user_id: string | null }
    | undefined;
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.accepted_at) {
    // Ya aceptada por esta misma persona: vuelve a la página.
    if (row.accepted_user_id === user.id) return { ok: true, pageId: row.page_id, workspaceId: row.workspace_id, email: row.email, first: false };
    return { ok: false, reason: 'invalid' };
  }
  if (now.getTime() - Date.parse(row.created_at) > INVITE_TTL_DAYS * 86_400_000) return { ok: false, reason: 'expired' };
  if (user.email.trim().toLowerCase() !== row.email) return { ok: false, reason: 'email_mismatch', email: row.email };
  const claim = await getDb()
    .prepare('UPDATE docs_guest_invites SET accepted_at = ?, accepted_user_id = ? WHERE id = ? AND accepted_at IS NULL')
    .run(now.toISOString(), user.id, row.id);
  if (!claim.changes) return { ok: false, reason: 'invalid' };
  await createDocShare(row.workspace_id, row.page_id, 'user', user.id, normalizeDocsRole(row.role));
  return { ok: true, pageId: row.page_id, workspaceId: row.workspace_id, email: row.email, first: true };
}

/** ¿El email ya tiene cuenta? (para decidir share directo o invitación). */
export async function existingUserByEmail(email: string): Promise<UserRow | null> {
  return (await getUserByEmail(email.trim().toLowerCase())) ?? null;
}
