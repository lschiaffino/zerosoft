/**
 * Rec: compartir con personas puntuales (como Drive o Loom). Server-only.
 *
 * - Cada video tiene una lista de emails invitados (allowed_emails) con un rol
 *   por email (people_roles): mira, o mira y comenta. Las reglas de quién ve
 *   viven en lib/rec.ts (publicAccess, canCommentAs).
 * - Quien está en la lista entra con una cuenta de ese email o con un link
 *   mágico: un token al azar de un solo uso (se guarda su hash, vence en 7
 *   días) que, al abrirse desde la página del video, deja una cookie firmada
 *   atada al link del video y al email. Sacar a alguien de la lista o cambiar
 *   el link corta el acceso al toque, con cookie o sin ella.
 * - Desde la página del video, quien no tiene acceso escribe su email: si
 *   está en la lista recibe un link nuevo; si no, queda un pedido de acceso
 *   para quien grabó. La respuesta es la misma en los dos casos.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import { escapeHtml } from './email';
import { getManageableVideo, inTx, nowDb, RecError, rolesOf, type RecActor, type RecVideoRow } from './rec';
import { cleanEmails, cleanRoles, MAX_REC_ALLOWED, type RecRole } from './rec-schema';
import { emailLang, lang, limited, requestAccess, type Lang } from './rec-admin';

/** Lo que dura el link mágico sin usarse. */
export const REC_MAGIC_TTL_DAYS = 7;
/** Lo que dura la cookie que deja el link mágico. */
export const REC_INVITE_COOKIE_DAYS = 30;
/** Mails de invitación por workspace y por día. */
export const REC_INVITES_DAILY = 300;

function parseJson<T>(text: string | null | undefined, fallback: T): T {
  try {
    return (JSON.parse(text ?? '') ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function secret(): string {
  return process.env.NEXTAUTH_SECRET ?? 'rec';
}

// ============================================================
// Cookie del link mágico
// ============================================================

export function inviteCookieName(shareId: string): string {
  return `rec_iv_${shareId}`;
}

function inviteSig(shareId: string, email: string, exp: number): string {
  return createHmac('sha256', secret()).update(`invite:${shareId}:${email}:${exp}`).digest('base64url');
}

/** Valor firmado: email, vencimiento y firma atada al link (cambiar el link la invalida). */
export function inviteCookieValue(shareId: string, email: string, now = Date.now()): string {
  const e = email.trim().toLowerCase();
  const exp = Math.floor(now / 1000) + REC_INVITE_COOKIE_DAYS * 86400;
  return `${Buffer.from(e).toString('base64url')}.${exp}.${inviteSig(shareId, e, exp)}`;
}

/** Email de una cookie válida para este link, o null. */
export function readInviteCookie(shareId: string, value: string | null | undefined, now = Date.now()): string | null {
  if (!value || value.length > 600) return null;
  const [b64, expRaw, sig] = value.split('.');
  if (!b64 || !expRaw || !sig || !/^\d{1,12}$/.test(expRaw)) return null;
  const exp = Number(expRaw);
  if (exp * 1000 <= now) return null;
  let email: string;
  try {
    email = Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const want = inviteSig(shareId, email, exp);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  return email;
}

// ============================================================
// Link mágico
// ============================================================

const hashToken = (t: string) => createHash('sha256').update(`rec-magic:${t}`).digest('hex');

/** Token nuevo de un solo uso para este email y este video. */
export async function createMagicToken(videoId: string, email: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  const exp = new Date(Date.now() + REC_MAGIC_TTL_DAYS * 86400_000).toISOString().slice(0, 19).replace('T', ' ');
  await getDb()
    .prepare('INSERT INTO rec_magic_links (token_hash, video_id, email, expires_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), videoId, email.trim().toLowerCase(), exp);
  return token;
}

/**
 * Usa el token (una sola vez, aun con dos clics a la vez) y devuelve el email
 * si sigue en la lista del video. Vencido, usado, de otro video o de alguien
 * que ya no está: null.
 */
export async function consumeMagicToken(v: Pick<RecVideoRow, 'id' | 'allowed_emails'>, token: string): Promise<string | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const db = getDb();
  const h = hashToken(token);
  const row = (await db.prepare('SELECT email FROM rec_magic_links WHERE token_hash = ? AND video_id = ? AND used_at IS NULL AND expires_at > ?').get(h, v.id, nowDb())) as
    | { email: string }
    | undefined;
  if (!row) return null;
  const claim = await db.prepare('UPDATE rec_magic_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(nowDb(), h);
  if (!claim.changes) return null;
  return parseJson<string[]>(v.allowed_emails, []).includes(row.email) ? row.email : null;
}

export function magicUrl(base: string, locale: string, shareId: string, token: string): string {
  return `${base}/${locale}/v/${shareId}?invite=${encodeURIComponent(token)}`;
}

// ============================================================
// Mails
// ============================================================

const TEXT = {
  en: {
    memberSubject: (who: string, title: string) => `${who} shared "${title}" with you`,
    memberBody: (who: string, title: string) => `${who} shared the video "${title}" with you.`,
    outsideSubject: 'A video was shared with you',
    outsideBody: 'A video was shared with you on zerosoft.',
    linkSubject: 'Your link to watch the video',
    linkBody: 'Here is your link to the video you asked for.',
    approvedSubject: 'You can now watch the video you asked for',
    approvedBody: 'Your request was approved.',
    open: 'Open the video',
    once: `The link works once and expires in ${REC_MAGIC_TTL_DAYS} days. If it stops working, open the video page and ask for a new one with this email.`,
  },
  es: {
    memberSubject: (who: string, title: string) => `${who} te compartió "${title}"`,
    memberBody: (who: string, title: string) => `${who} te compartió el video "${title}".`,
    outsideSubject: 'Te compartieron un video',
    outsideBody: 'Te compartieron un video en zerosoft.',
    linkSubject: 'Tu link para ver el video',
    linkBody: 'Este es tu link al video que pediste.',
    approvedSubject: 'Ya podés ver el video que pediste',
    approvedBody: 'Aprobaron tu pedido.',
    open: 'Abrir el video',
    once: `El link sirve una vez y vence en ${REC_MAGIC_TTL_DAYS} días. Si deja de andar, abrí la página del video y pedí uno nuevo con este email.`,
  },
  pt: {
    memberSubject: (who: string, title: string) => `${who} compartilhou "${title}" com você`,
    memberBody: (who: string, title: string) => `${who} compartilhou o vídeo "${title}" com você.`,
    outsideSubject: 'Compartilharam um vídeo com você',
    outsideBody: 'Compartilharam um vídeo com você na zerosoft.',
    linkSubject: 'Seu link para assistir ao vídeo',
    linkBody: 'Aqui está o seu link para o vídeo que você pediu.',
    approvedSubject: 'Você já pode assistir ao vídeo que pediu',
    approvedBody: 'Seu pedido foi aprovado.',
    open: 'Abrir o vídeo',
    once: `O link funciona uma vez e vence em ${REC_MAGIC_TTL_DAYS} dias. Se parar de funcionar, abra a página do vídeo e peça um novo com este email.`,
  },
};

export type RecMailKind = 'invite' | 'link' | 'approved';

/**
 * Mail con link mágico. A un miembro del workspace, con quién y qué; a
 * alguien de afuera, texto fijo y el link (nada que haya escrito una persona).
 */
export function magicEmail(
  kind: RecMailKind,
  url: string,
  l: Lang,
  member: { who: string; title: string } | null,
): { subject: string; text: string; html: string } {
  const tx = TEXT[l];
  const subject = kind === 'link' ? tx.linkSubject : kind === 'approved' ? tx.approvedSubject : member ? tx.memberSubject(member.who, member.title).slice(0, 200) : tx.outsideSubject;
  const lead = kind === 'link' ? tx.linkBody : kind === 'approved' ? tx.approvedBody : member ? tx.memberBody(member.who, member.title) : tx.outsideBody;
  return {
    subject,
    text: `${lead}\n\n${tx.open}: ${url}\n\n${tx.once}`,
    html: `<p>${escapeHtml(lead)}</p><p><a href="${escapeHtml(url)}">${escapeHtml(tx.open)}</a></p><p style="color:#666">${escapeHtml(tx.once)}</p>`,
  };
}

/** Manda un link mágico nuevo a un email de la lista. */
export async function sendMagicLink(
  v: Pick<RecVideoRow, 'id' | 'share_id' | 'title'>,
  email: string,
  kind: RecMailKind,
  opts: { base: string; locale: string; member?: { who: string } | null },
): Promise<boolean> {
  const { sendEmail, appSender } = await import('./email');
  const token = await createMagicToken(v.id, email);
  const known = await getDb().prepare('SELECT 1 FROM users WHERE lower(email) = ? LIMIT 1').get(email);
  const l = known ? await emailLang(email) : lang(opts.locale);
  const mail = magicEmail(kind, magicUrl(opts.base, l, v.share_id, token), l, opts.member ? { who: opts.member.who, title: v.title } : null);
  const r = await sendEmail({ to: email, from: appSender(), ...mail, idempotencyKey: `rec-magic-${hashToken(token).slice(0, 32)}` }).catch(() => ({ ok: false }));
  return r.ok;
}

// ============================================================
// Personas con acceso
// ============================================================

export interface RecPersonDto {
  email: string;
  role: RecRole;
  /** Nombre si es alguien del workspace. */
  name: string;
  member: boolean;
  /** Última vez que miró (con su cuenta o su link mágico), o null. */
  viewedAt: string | null;
}

/** Quién miró, por email: con su cuenta o con un link mágico de este video. */
async function viewsByEmail(videoId: string): Promise<Map<string, string>> {
  const rows = (await getDb()
    .prepare(
      `SELECT lower(COALESCE(u.email, CASE WHEN w.viewer_key LIKE 'i:%' THEN substr(w.viewer_key, 3) END)) AS email, MAX(w.started_at) AS last
       FROM rec_views w LEFT JOIN users u ON u.id = w.user_id
       WHERE w.video_id = ? GROUP BY 1`,
    )
    .all(videoId)) as Array<{ email: string | null; last: string }>;
  return new Map(rows.filter((r) => r.email).map((r) => [r.email!, r.last]));
}

export async function listPeople(a: RecActor, id: string, members: Array<{ email: string; name: string }>): Promise<RecPersonDto[]> {
  const v = await getManageableVideo(a, id);
  const roles = rolesOf(v);
  const views = await viewsByEmail(id);
  const byEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.name]));
  return parseJson<string[]>(v.allowed_emails, []).map((email) => ({
    email,
    role: roles[email] ?? 'commenter',
    name: byEmail.get(email) ?? '',
    member: byEmail.has(email),
    viewedAt: views.get(email) ?? null,
  }));
}

/**
 * Suma personas (o les cambia el rol si ya estaban) en una sola transacción:
 * dos invitaciones a la vez no se pisan. Devuelve los emails que entraron nuevos.
 */
export async function addPeople(a: RecActor, id: string, rawEmails: string[], role: RecRole): Promise<{ added: string[]; video: RecVideoRow }> {
  await getManageableVideo(a, id);
  const emails = cleanInput(rawEmails);
  if (!emails.length) throw new RecError('invalid_email');
  return inTx(async (t) => {
    const cur = (await t.prepare('SELECT allowed_emails, people_roles FROM rec_videos WHERE id = ?').get(id)) as Pick<RecVideoRow, 'allowed_emails' | 'people_roles'>;
    const list = parseJson<string[]>(cur.allowed_emails, []);
    const added = emails.filter((e) => !list.includes(e));
    if (list.length + added.length > MAX_REC_ALLOWED) throw new RecError('allowed_full');
    const next = [...list, ...added];
    const roles = { ...rolesOf(cur), ...Object.fromEntries(emails.map((e) => [e, role])) };
    await t
      .prepare("UPDATE rec_videos SET allowed_emails = ?, people_roles = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(next), JSON.stringify(cleanRoles(roles, next)), id);
    const video = (await t.prepare('SELECT * FROM rec_videos WHERE id = ?').get(id)) as RecVideoRow;
    return { added, video };
  });
}

function cleanInput(raw: string[]): string[] {
  const all = raw.flatMap((r) => String(r ?? '').split(/[\s,;]+/)).filter(Boolean);
  if (all.length > MAX_REC_ALLOWED) throw new RecError('allowed_full');
  const clean = cleanEmails(all);
  if (clean.length < new Set(all.map((x) => x.trim().toLowerCase())).size) throw new RecError('invalid_email');
  return clean;
}

export async function setPersonRole(a: RecActor, id: string, email: string, role: RecRole): Promise<void> {
  await getManageableVideo(a, id);
  const e = email.trim().toLowerCase();
  await inTx(async (t) => {
    const cur = (await t.prepare('SELECT allowed_emails, people_roles FROM rec_videos WHERE id = ?').get(id)) as Pick<RecVideoRow, 'allowed_emails' | 'people_roles'>;
    const list = parseJson<string[]>(cur.allowed_emails, []);
    if (!list.includes(e)) throw new RecError('not_found', 404);
    await t.prepare("UPDATE rec_videos SET people_roles = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(cleanRoles({ ...rolesOf(cur), [e]: role }, list)), id);
  });
}

/** Saca a una persona: pierde el acceso al toque y sus links sin usar dejan de servir. */
export async function removePerson(a: RecActor, id: string, email: string): Promise<void> {
  await getManageableVideo(a, id);
  const e = email.trim().toLowerCase();
  await inTx(async (t) => {
    const cur = (await t.prepare('SELECT allowed_emails, people_roles FROM rec_videos WHERE id = ?').get(id)) as Pick<RecVideoRow, 'allowed_emails' | 'people_roles'>;
    const list = parseJson<string[]>(cur.allowed_emails, []).filter((x) => x !== e);
    await t
      .prepare("UPDATE rec_videos SET allowed_emails = ?, people_roles = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(list), JSON.stringify(cleanRoles(rolesOf(cur), list)), id);
    await t.prepare('DELETE FROM rec_magic_links WHERE video_id = ? AND email = ?').run(id, e);
  });
}

/**
 * Invitaciones por mail (con tope diario por workspace). A los miembros del
 * workspace, además, un aviso en la app.
 */
export async function inviteByEmail(
  a: RecActor,
  v: Pick<RecVideoRow, 'id' | 'share_id' | 'title' | 'workspace_id'>,
  emails: string[],
  opts: { base: string; locale: string; members: Array<{ id: string; email: string; name: string }> },
): Promise<number> {
  if (!emails.length) return 0;
  // El tope cuenta destinatarios, no pedidos.
  for (let i = 0; i < emails.length; i++) {
    await limited(`rec:invite:ws:${a.ws}`, REC_INVITES_DAILY, 86400).catch(() => {
      throw new RecError('invite_quota', 429);
    });
  }
  const byEmail = new Map(opts.members.map((m) => [m.email.toLowerCase(), m]));
  let sent = 0;
  for (const email of emails) {
    const m = byEmail.get(email);
    if (await sendMagicLink(v, email, 'invite', { base: opts.base, locale: opts.locale, member: m ? { who: a.name || 'Someone' } : null })) sent++;
    if (m && m.id !== a.actor) {
      try {
        const { createNotification } = await import('./notifications');
        const title = TEXT[await emailLang(email)].memberSubject(a.name || 'Someone', v.title);
        await createNotification({ userId: m.id, type: 'rec_access', title, href: `/v/${v.share_id}`, sourceType: 'rec_video', sourceId: v.id, meta: { actorName: a.name, title: v.title } });
      } catch {
        /* el aviso no corta la invitación */
      }
    }
  }
  return sent;
}

/**
 * Desde la página del video, sin acceso: si el email está en la lista le llega
 * un link nuevo; si no, queda un pedido para quien grabó (sin verificar: si lo
 * aprueba, el link va a ese email y solo quien lo lee entra). Misma respuesta
 * en los dos casos: no dice quién está en la lista.
 */
export async function askForLink(
  v: Pick<RecVideoRow, 'id' | 'share_id' | 'title' | 'created_by' | 'notify' | 'allowed_emails'>,
  rawEmail: string,
  name: string,
  opts: { base: string; locale: string },
): Promise<void> {
  const email = cleanEmails([rawEmail])[0];
  if (!email) throw new RecError('invalid_email');
  await limited(`rec:magic:email:${v.id}:${email}`, 5, 3600);
  // Mismo tiempo y misma respuesta en los dos caminos: el trabajo va después de responder y sus errores no salen.
  const work = async () => {
    if (parseJson<string[]>(v.allowed_emails, []).includes(email)) await sendMagicLink(v, email, 'link', { base: opts.base, locale: opts.locale });
    else await requestAccess(v, { email, name });
  };
  const quiet = () => work().catch(() => undefined);
  try {
    const { after } = await import('next/server');
    after(quiet);
  } catch {
    await quiet();
  }
}
