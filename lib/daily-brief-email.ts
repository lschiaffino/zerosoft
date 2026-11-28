/**
 * El email del resumen del día (lib/daily-brief.ts): sale del tick horario a
 * las personas que lo pidieron en Ajustes › Avisos, una vez por día, entre
 * las 8 y las 11 de su zona horaria y solo si hay algo pendiente. Lleva lo
 * mismo que la tarjeta: cuentas y nombres de chats de Lines (del workspace
 * activo, con lo que la persona ve allí) y de su Inbox. Nunca el texto de un
 * mensaje ni de una nota.
 *
 * El acceso es el mismo que el de la sesión (como lib/wa-live-auth.ts): el
 * workspace activo, sin la app si el workspace pide dos pasos y la persona no
 * los tiene, y sin las apps que el workspace le apagó o limitó a otros. Por
 * lib/email.ts (Resend o la consola). Server-only.
 */
import { createTranslator } from 'next-intl';
import { getDb, getUserById, type UserRow } from './db';
import { appSender, escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { siteUrl } from './board-urls';
import { groupsViewer } from './groups-access';
import { mfaEnabled } from './account-security';
import { resolveWorkspace, type TeamRole } from './teams';
import { userCanUseApp } from './workspace';
import { blockedAppsFor } from './workspace-apps';
import { localDayIn, localHourIn } from './track-recurrence';
import { briefIsEmpty, inboxBrief, linesBrief, type DailyBrief } from './daily-brief';
import { loadInternalSet } from './internal-contacts';
import { briefUnsubscribeHeaders, briefUnsubscribeLinks } from './daily-brief-unsub';
import type { ProductKey } from './products';
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
  locale: string | null;
  tz: string;
  email_day: string | null;
}

/**
 * Lo que la persona puede abrir ahora, como lo arma la sesión: el workspace activo, su rol y si puede usar Lines e
 * Inbox. null si el workspace pide dos pasos y no los tiene (la sesión la manda a su propio workspace, que no es
 * el que se resumiría).
 */
async function accessOf(user: UserRow): Promise<{ ws: string; role: TeamRole; can: (app: ProductKey) => boolean } | null> {
  const { owner, workspace, role, apps } = await resolveWorkspace(user);
  if (owner.id !== user.id && workspace?.require_mfa && !mfaEnabled(user)) return null;
  const blockedApps = await blockedAppsFor({ ownerId: owner.id, personId: user.id, role, email: user.email });
  return { ws: owner.id, role, can: (app) => role !== 'guest' && userCanUseApp({ role, apps, blockedApps }, app) };
}

/** El fin del día local (para las tareas "de hoy"): la medianoche que viene en esa zona (también con media hora). */
export function dayEndIn(timeZone: string, now: Date): Date {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'UTC', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - elapsed + 24 * 60 * 60 * 1000);
}

/** El email (texto y HTML) con lo que haya de cada app. Los nombres ya vienen limpios y cortos (briefName). */
export function buildBriefEmail(briefs: DailyBrief[], locale: Locale, unsubscribeUrl?: string | null): { subject: string; text: string; html: string } {
  const t = createTranslator({ locale, messages: MESSAGES[locale] as never, namespace: 'wa.brief' as never }) as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const base = siteUrl();
  const appName = { lines: 'Lines', inbox: 'Inbox' } as const;
  const href = { lines: `${base}/app/lines/inbox`, inbox: `${base}/app/inbox` } as const;
  const textParts: string[] = [t('email.intro')];
  const htmlParts: string[] = [escapeHtml(t('email.intro'))];
  for (const b of briefs) {
    const items = b.items.filter((i) => i.count > 0);
    if (!items.length) continue;
    const lines = items.map((i) => {
      const label = t(`kind.${i.kind}`, { n: i.count });
      const names = i.chats.map((ch) => ch.name || t('unnamed')).join(', ');
      return { text: `${i.count} ${label}${names ? `: ${names}` : ''}`, html: `<strong>${i.count}</strong> ${escapeHtml(label)}${names ? `: ${escapeHtml(names)}` : ''}` };
    });
    const open = t('email.open', { app: appName[b.app] });
    textParts.push(`${appName[b.app]}\n${lines.map((l) => `- ${l.text}`).join('\n')}\n${open}: ${href[b.app]}`);
    htmlParts.push(`<strong>${appName[b.app]}</strong><br />${lines.map((l) => l.html).join('<br />')}<br /><a href="${escapeHtml(href[b.app])}">${escapeHtml(open)}</a>`);
  }
  const footer = t('email.footer');
  // La baja de un clic (lib/daily-brief-unsub.ts): abre una confirmación, no apaga nada al abrirse.
  const unsub = unsubscribeUrl ? t('email.unsubscribe') : '';
  return {
    subject: t('email.subject'),
    text: `${textParts.join('\n\n')}\n\n${footer}${unsub ? `\n${unsub}: ${unsubscribeUrl}` : ''}`,
    html: renderBrandedHtml({
      heading: t('email.heading'),
      paragraphs: htmlParts,
      eyebrow: 'zerosoft · daily brief',
      note: `${escapeHtml(footer)}${unsub ? ` <a href="${escapeHtml(unsubscribeUrl!)}">${escapeHtml(unsub)}</a>` : ''}`,
    }),
  };
}

/** Lo de cada app para la persona, o null si no hay nada (o no puede ver nada). */
async function briefsFor(c: Candidate, now: Date): Promise<DailyBrief[]> {
  const user = await getUserById(c.user_id);
  if (!user?.email) return [];
  const access = await accessOf(user);
  const db = getDb();
  const out: DailyBrief[] = [];
  if (access?.can('groups') && (await db.prepare('SELECT 1 AS x FROM groups_numbers WHERE user_id = ? LIMIT 1').get(access.ws))) {
    out.push(await linesBrief(await groupsViewer(access.ws, user.id, access.role), now, { dayEnd: dayEndIn(c.tz, now) }));
  }
  // Inbox es personal, pero la app la habilita el workspace activo (como en la sesión).
  if ((access ? access.can('inbox') : true) && (await db.prepare('SELECT 1 AS x FROM inbox_accounts WHERE owner_id = ? LIMIT 1').get(user.id))) {
    // Lo interno del workspace activo (como la tarjeta); sin acceso a él, el de su propio workspace.
    out.push(await inboxBrief(user.id, now, await loadInternalSet(access?.ws ?? user.id, { inboxOwner: user.id })));
  }
  return out.filter((b) => !briefIsEmpty(b));
}

/**
 * Los emails de la mañana (tick horario). Recorre a quienes lo pidieron de a páginas, primero quienes hace más que no
 * lo reciben (y por id), y para cada una mira si en su zona es la hora: así nadie queda afuera porque otros llenaron la
 * página, y si un tick no llega a todos, el próximo empieza por quienes quedaron. `limit`: cuántos se arman como
 * mucho por tick; además hay un tope de tiempo. Cada persona se reclama antes de armarlo (email_day) para que dos
 * ticks a la vez no lo manden dos veces; si algo falla, el reclamo se devuelve y sale en el próximo tick (si
 * todavía es la hora). Devuelve cuántos salieron.
 */
export async function sendDailyBriefEmails(opts: { now?: Date; limit?: number; budgetMs?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const budget = opts.budgetMs ?? 60_000;
  const maxSends = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const db = getDb();
  // Ya salió hoy en la zona más adelantada: hoy no le toca a nadie más.
  const latest = localDayIn('Pacific/Kiritimati', now);
  // Cursor (último día de envío, id): quien acaba de recibirlo pasa al final y no se vuelve a armar hoy.
  const candidatesAfter = async (afterDay: string, afterId: string) =>
    (await db
      .prepare(
        `SELECT p.user_id, p.email_day, u.locale, COALESCE(NULLIF(p.time_zone, ''), NULLIF(u.time_zone, ''), 'UTC') AS tz
         FROM daily_brief_prefs p JOIN users u ON u.id = p.user_id
         WHERE p.email = 1 AND u.email <> '' AND (p.email_day IS NULL OR p.email_day < ?)
           AND (COALESCE(p.email_day, ''), p.user_id) > (?, ?)
         ORDER BY COALESCE(p.email_day, ''), p.user_id LIMIT 500`,
      )
      .all(latest, afterDay, afterId)) as Candidate[];
  let sent = 0;
  let attempted = 0;
  let after = { day: '', id: '' };
  for (let page = await candidatesAfter(after.day, after.id); page.length && attempted < maxSends; page = await candidatesAfter(after.day, after.id)) {
    const last = page[page.length - 1];
    after = { day: last.email_day ?? '', id: last.user_id };
    for (const c of page) {
      if (Date.now() - started > budget || attempted >= maxSends) break;
      const day = briefEmailDue(c.tz, c.email_day, now);
      if (!day) continue;
      attempted++;
      const claimed = await db
        .prepare('UPDATE daily_brief_prefs SET email_day = ? WHERE user_id = ? AND email = 1 AND (email_day IS NULL OR email_day <> ?)')
        .run(day, c.user_id, day);
      if (!claimed.changes) continue;
      let ok = false;
      try {
        const briefs = await briefsFor(c, now);
        if (!briefs.length) {
          ok = true;
          continue;
        }
        const user = (await db.prepare('SELECT email FROM users WHERE id = ?').get(c.user_id)) as { email: string } | undefined;
        if (!user?.email) {
          ok = true;
          continue;
        }
        const locale: Locale = c.locale === 'es' || c.locale === 'pt' ? c.locale : 'en';
        // Baja de un clic (RFC 8058) en los encabezados y un link en el pie, con un token firmado de la persona.
        const links = briefUnsubscribeLinks(c.user_id, locale, siteUrl());
        const res = await sendEmail({
          to: user.email,
          from: appSender(),
          ...buildBriefEmail(briefs, locale, links?.pageUrl),
          headers: briefUnsubscribeHeaders(links),
        });
        ok = res.ok;
        if (res.ok) sent++;
      } catch (err) {
        // Sin datos de la persona en el log: solo que falló.
        // eslint-disable-next-line no-console
        console.error('[daily-brief] email failed', (err as Error)?.name ?? 'error');
      } finally {
        // No salió: el reclamo vuelve atrás y el próximo tick lo intenta (si todavía es la hora).
        if (!ok) await db.prepare('UPDATE daily_brief_prefs SET email_day = ? WHERE user_id = ? AND email_day = ?').run(c.email_day, c.user_id, day);
      }
    }
    if (Date.now() - started > budget) break;
  }
  return sent;
}
