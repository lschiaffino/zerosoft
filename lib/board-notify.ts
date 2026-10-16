import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from './db';
import type { RoadmapItemRow } from './db';
import { escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { createNotification } from './notifications';
import { absoluteBoardUrl, absoluteItemUrl, siteUrl } from './board-urls';
import { boardItemAppHref } from './board-paths';

/**
 * Avisos del board: autor, votantes y comentaristas quedan suscriptos solos
 * (roadmap_subscriptions). Cuando un ítem pasa a planned / in_progress / done
 * reciben una notificación in-app y, si RESEND_API_KEY está configurada, un
 * email con link para desuscribirse. Sin RESEND_API_KEY no se manda email.
 */

type MailLocale = 'en' | 'es' | 'pt';

const COPY: Record<MailLocale, {
  status: Record<string, string>;
  subject: string;
  heading: string;
  body: string;
  shipped: string;
  view: string;
  unsubscribe: string;
  why: string;
}> = {
  en: {
    status: { planned: 'Planned', in_progress: 'In progress', done: 'Launched' },
    subject: '{title}: {status}',
    heading: '{status}',
    body: '"{title}" moved to {status}.',
    shipped: 'It is out. See what changed in the changelog: {url}',
    view: 'See the idea',
    unsubscribe: 'Stop updates for this idea',
    why: 'You get this because you posted, voted or commented on this idea.',
  },
  es: {
    status: { planned: 'Planeado', in_progress: 'En curso', done: 'Lanzado' },
    subject: '{title}: {status}',
    heading: '{status}',
    body: '"{title}" pasó a {status}.',
    shipped: 'Ya salió. Mirá qué cambió en el changelog: {url}',
    view: 'Ver la idea',
    unsubscribe: 'Dejar de recibir avisos de esta idea',
    why: 'Te llega porque propusiste, votaste o comentaste esta idea.',
  },
  pt: {
    status: { planned: 'Planejado', in_progress: 'Em andamento', done: 'Lançado' },
    subject: '{title}: {status}',
    heading: '{status}',
    body: '"{title}" passou para {status}.',
    shipped: 'Já saiu. Veja o que mudou no changelog: {url}',
    view: 'Ver a ideia',
    unsubscribe: 'Parar de receber avisos desta ideia',
    why: 'Você recebe isto porque propôs, votou ou comentou nesta ideia.',
  },
};

function mailLocale(locale: string | null | undefined): MailLocale {
  return locale === 'es' || locale === 'pt' ? locale : 'en';
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'zerosoft-board';
}

/** Token para desuscribirse de un ítem sin sesión (link del email). */
export function unsubscribeToken(itemId: string, userId: string): string {
  return createHmac('sha256', secret()).update(`board-unsub:${itemId}:${userId}`).digest('hex').slice(0, 32);
}

export function verifyUnsubscribeToken(itemId: string, userId: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(itemId, userId));
  const got = Buffer.from(token);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function unsubscribeUrl(itemId: string, userId: string): string {
  const q = new URLSearchParams({ i: itemId, u: userId, t: unsubscribeToken(itemId, userId) });
  return `${siteUrl()}/api/board/unsubscribe?${q.toString()}`;
}

interface Subscriber {
  user_id: string;
  email: string;
  locale: string;
}

export async function listActiveSubscribers(itemId: string): Promise<Subscriber[]> {
  return (await getDb()
    .prepare(
      `SELECT s.user_id, u.email, s.locale FROM roadmap_subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE s.item_id = ? AND s.active = 1`,
    )
    .all(itemId)) as Subscriber[];
}

/**
 * Avisa a los suscriptos que el ítem cambió de estado. Nunca tira: el cambio
 * de estado ya quedó guardado. Devuelve cuántos emails salieron.
 */
export async function notifyStatusChange(item: RoadmapItemRow, from: string | null): Promise<{ notified: number; emailed: number }> {
  let notified = 0;
  let emailed = 0;
  if (from === item.status) return { notified, emailed };
  const subscribers = await listActiveSubscribers(item.id).catch(() => []);
  const sendMail = Boolean(process.env.RESEND_API_KEY);
  for (const sub of subscribers) {
    const lang = mailLocale(sub.locale);
    const c = COPY[lang];
    const status = c.status[item.status] ?? item.status;
    const itemUrl = absoluteItemUrl(lang, item.id, item.title);
    try {
      await createNotification({
        userId: sub.user_id,
        type: 'roadmap_status',
        title: fill(c.subject, { title: item.title, status }),
        body: fill(c.body, { title: item.title, status }),
        href: boardItemAppHref(item.id, item.title),
        sourceType: 'roadmap_item',
        sourceId: item.id,
        meta: { from, to: item.status },
      });
      notified += 1;
    } catch {
      // la notificación in-app es best effort
    }
    if (!sendMail) continue;
    const changelogUrl =
      item.status === 'done' && item.shipped_changelog_id
        ? `${absoluteBoardUrl(lang, '/changelog')}#${item.shipped_changelog_id}`
        : null;
    const unsub = unsubscribeUrl(item.id, sub.user_id);
    const paragraphs = [
      escapeHtml(fill(c.body, { title: item.title, status })),
      ...(changelogUrl
        ? [fill(escapeHtml(c.shipped), { url: `<a href="${escapeHtml(changelogUrl)}">${escapeHtml(changelogUrl)}</a>` })]
        : []),
      `<a href="${escapeHtml(itemUrl)}">${escapeHtml(c.view)}</a>`,
      `<span style="color:#888888;font-size:12px;">${escapeHtml(c.why)} <a href="${escapeHtml(unsub)}" style="color:#888888;">${escapeHtml(c.unsubscribe)}</a></span>`,
    ];
    const text = [
      fill(c.body, { title: item.title, status }),
      ...(changelogUrl ? [fill(c.shipped, { url: changelogUrl })] : []),
      `${c.view}: ${itemUrl}`,
      '',
      `${c.why} ${c.unsubscribe}: ${unsub}`,
    ].join('\n');
    try {
      const res = await sendEmail({
        to: sub.email,
        subject: fill(c.subject, { title: item.title, status }),
        text,
        html: renderBrandedHtml({ heading: fill(c.heading, { status }), paragraphs, eyebrow: 'zerosoft · feedback' }),
      });
      if (res.ok) emailed += 1;
    } catch {
      // seguir con el resto
    }
  }
  return { notified, emailed };
}
