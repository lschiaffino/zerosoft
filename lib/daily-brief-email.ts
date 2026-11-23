/**
 * El email del resumen del día (lib/daily-brief.ts): sale del tick horario a
 * las personas que lo pidieron en Ajustes › Avisos, una vez por día, entre
 * las 8 y las 11 de su zona horaria y solo si hay algo pendiente. Lleva lo
 * mismo que la tarjeta: cuentas y nombres de chats de Lines (del workspace
 * activo, con lo que la persona ve) y de su Inbox. Nunca el texto de un
 * mensaje ni de una nota. Por lib/email.ts (Resend o la consola). Server-only.
 */
import { createTranslator } from 'next-intl';
import { getDb } from './db';
import { appSender, escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { siteUrl } from './board-urls';
import { groupsViewer } from './groups-access';
import { localDayIn, localHourIn } from './track-recurrence';
import { canUseApp, getMembership } from './workspace';
import { briefIsEmpty, inboxBrief, linesBrief, type DailyBrief } from './daily-brief';
import en from '@/messages/en/groups.json';
import es from '@/messages/es/groups.json';
import pt from '@/messages/pt/groups.json';

type Locale = 'en' | 'es' | 'pt';
const MESSAGES = { en, es, pt } as const;

export const BRIEF_EMAIL_FIRST_HOUR = 8;
export const BRIEF_EMAIL_LAST_HOUR = 11;

/** El día local en que le toca el email a esa zona horaria, o null si no es la hora (o ya salió hoy). */
export function briefEmailDue(timeZone: string, sentDay: string | null, now: Date): string | null {
  const hour = localHourIn(timeZone || 'UTC', now);
  if (hour < BRIEF_EMAIL_FIRST_HOUR || hour > BRIEF_EMAIL_LAST_HOUR) return null;
  const day = localDayIn(timeZone || 'UTC', now);
  return sentDay === day ? null : day;
}

interface Candidate {
  user_id: string;
  email: string;
  locale: string | null;
  time_zone: string | null;
  active_team_id: string | null;
  email_day: string | null;
}

/** Lo de Lines de la persona: del workspace activo si sigue siendo parte (no invitada) y tiene la app; si no, del propio. */
async function linesFor(c: Candidate, now: Date): Promise<DailyBrief | null> {
  const db = getDb();
  let ws = c.user_id;
  let role: 'owner' | 'admin' | 'member' = 'owner';
  let apps: Parameters<typeof canUseApp>[0]['apps'] = '*';
  if (c.active_team_id) {
    const team = (await db.prepare('SELECT id, owner_id FROM teams WHERE id = ?').get(c.active_team_id)) as { id: string; owner_id: string } | undefined;
    const m = team ? await getMembership(team, c.user_id) : null;
    if (team && m && m.role !== 'guest') {
      ws = team.owner_id;
      role = m.role === 'owner' ? 'owner' : m.role === 'admin' ? 'admin' : 'member';
      apps = m.apps;
    }
  }
  if (!canUseApp({ role, apps }, 'groups')) return null;
  const lines = await db.prepare('SELECT 1 AS x FROM groups_numbers WHERE user_id = ? LIMIT 1').get(ws);
  if (!lines) return null;
  return linesBrief(await groupsViewer(ws, c.user_id, role), now);
}

async function inboxFor(c: Candidate, now: Date): Promise<DailyBrief | null> {
  const has = await getDb().prepare('SELECT 1 AS x FROM inbox_accounts WHERE owner_id = ? LIMIT 1').get(c.user_id);
  return has ? inboxBrief(c.user_id, now) : null;
}

/** El email (texto y HTML) con lo que haya de cada app. Puro salvo por las URLs. */
export function buildBriefEmail(briefs: DailyBrief[], locale: Locale): { subject: string; text: string; html: string } {
  const t = createTranslator({ locale, messages: MESSAGES[locale] as unknown as Record<string, unknown>, namespace: 'wa.brief' as never }) as unknown as (key: string, values?: Record<string, string | number>) => string;
  const base = siteUrl();
  const appName = { lines: 'Lines', inbox: 'Inbox' } as const;
  const href = { lines: `${base}/app/lines/inbox`, inbox: `${base}/app/inbox` } as const;
  const textParts: string[] = [t('email.intro')];
  const htmlParts: string[] = [escapeHtml(t('email.intro'))];
  for (const b of briefs) {
    const items = b.items.filter((i) => i.count > 0);
    if (!items.length) continue;
    const lines = items.map((i) => {
      const names = i.chats.map((ch) => ch.name || t('unnamed')).join(', ');
      return { text: `${i.count} ${t(`kind.${i.kind}`, { n: i.count })}${names ? `: ${names}` : ''}`, html: `<strong>${i.count}</strong> ${escapeHtml(t(`kind.${i.kind}`, { n: i.count }))}${names ? `: ${escapeHtml(names)}` : ''}` };
    });
    textParts.push(`${appName[b.app]}\n${lines.map((l) => `- ${l.text}`).join('\n')}\n${t('email.open', { app: appName[b.app] })}: ${href[b.app]}`);
    htmlParts.push(
      `<strong>${appName[b.app]}</strong><br />${lines.map((l) => l.html).join('<br />')}<br /><a href="${escapeHtml(href[b.app])}">${escapeHtml(t('email.open', { app: appName[b.app] }))}</a>`,
    );
  }
  const footer = t('email.footer');
  return {
    subject: t('email.subject'),
    text: `${textParts.join('\n\n')}\n\n${footer}`,
    html: renderBrandedHtml({ heading: t('email.heading'), paragraphs: htmlParts, eyebrow: 'zerosoft · daily brief', note: escapeHtml(footer) }),
  };
}

/**
 * Los emails de la mañana (tick horario). Cada persona se reclama antes de
 * mandar (email_day), así dos ticks a la vez no lo mandan dos veces.
 * Devuelve cuántos salieron.
 */
export async function sendDailyBriefEmails(opts: { now?: Date; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const db = getDb();
  const candidates = (await db
    .prepare(
      `SELECT p.user_id, p.email_day, u.email, u.locale, u.time_zone, u.active_team_id
       FROM daily_brief_prefs p JOIN users u ON u.id = p.user_id
       WHERE p.email = 1 AND u.email <> '' LIMIT ?`,
    )
    .all(Math.min(Math.max(opts.limit ?? 500, 1), 2000))) as Candidate[];
  let sent = 0;
  for (const c of candidates) {
    const day = briefEmailDue(c.time_zone ?? 'UTC', c.email_day, now);
    if (!day) continue;
    const claimed = await db
      .prepare('UPDATE daily_brief_prefs SET email_day = ? WHERE user_id = ? AND email = 1 AND (email_day IS NULL OR email_day <> ?)')
      .run(day, c.user_id, day);
    if (!claimed.changes) continue;
    try {
      const briefs = [await linesFor(c, now), await inboxFor(c, now)].filter((b): b is DailyBrief => !!b && !briefIsEmpty(b));
      if (!briefs.length) continue;
      const locale: Locale = c.locale === 'es' || c.locale === 'pt' ? c.locale : 'en';
      const mail = buildBriefEmail(briefs, locale);
      const res = await sendEmail({ to: c.email, from: appSender(), ...mail });
      if (res.ok) sent++;
    } catch (err) {
      // Sin datos de la persona en el log: solo que falló.
      // eslint-disable-next-line no-console
      console.error('[daily-brief] email failed', (err as Error)?.name ?? 'error');
    }
  }
  return sent;
}
