/**
 * Docs: wiki con páginas verificadas (como Notion). Una página se verifica
 * por N días o sin vencimiento; tiene un dueño que recibe el aviso cuando la
 * verificación vence (cron cada hora, claim por fila en verify_notified_at).
 */
import { getDb, type DocsPageRow } from './db';
import { createNotification } from './notifications';
import { escapeHtml, renderBrandedHtml, sendEmail } from './email';
import { siteUrl } from './board-urls';
import en from '@/messages/en/docs.json';
import es from '@/messages/es/docs.json';
import pt from '@/messages/pt/docs.json';

/** Plazos que ofrece el menú (días); null = sin vencimiento. */
export const VERIFY_DAYS = [7, 30, 90, 180, 365] as const;
export const VERIFY_MAX_DAYS = 3650;

export async function verifyDocPage(
  page: Pick<DocsPageRow, 'id' | 'user_id'>,
  verifierId: string,
  days: number | null,
  ownerId: string | null,
  locale: string | null = null,
  now = new Date(),
): Promise<void> {
  const until = days == null ? null : new Date(now.getTime() + days * 86_400_000).toISOString();
  await getDb()
    .prepare(
      `UPDATE docs_pages SET verified_by = ?, verified_at = ?, verified_until = ?, verify_notified_at = NULL,
         page_owner_id = COALESCE(?, page_owner_id, ?), verify_locale = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(verifierId, now.toISOString(), until, ownerId, verifierId, locale === 'es' || locale === 'pt' ? locale : 'en', page.id, page.user_id);
}

export async function unverifyDocPage(page: Pick<DocsPageRow, 'id' | 'user_id'>): Promise<void> {
  await getDb()
    .prepare(
      'UPDATE docs_pages SET verified_by = NULL, verified_at = NULL, verified_until = NULL, verify_notified_at = NULL WHERE id = ? AND user_id = ?',
    )
    .run(page.id, page.user_id);
}

export interface WikiPage {
  id: string;
  title: string;
  icon: string | null;
  page_owner_id: string | null;
  owner_name: string | null;
  verified_by: string | null;
  verified_at: string | null;
  verified_until: string | null;
  teamspace_id: string | null;
  updated_at: string;
}

/** Páginas verificadas (vigentes y vencidas) del workspace, para la vista Wiki. */
export async function listWikiPages(workspaceId: string, hide: string[] = []): Promise<WikiPage[]> {
  const filter = hide.length ? ` AND (p.teamspace_id IS NULL OR p.teamspace_id NOT IN (${hide.map(() => '?').join(',')}))` : '';
  return (await getDb()
    .prepare(
      `SELECT p.id, p.title, p.icon, p.page_owner_id, u.name AS owner_name, p.verified_by, p.verified_at, p.verified_until,
              p.teamspace_id, p.updated_at
       FROM docs_pages p LEFT JOIN users u ON u.id = p.page_owner_id
       WHERE p.user_id = ? AND p.archived = 0 AND (p.verified_at IS NOT NULL OR p.page_owner_id IS NOT NULL)${filter}
       ORDER BY (p.verified_until IS NOT NULL AND p.verified_until <= ?) DESC, p.title COLLATE NOCASE`,
    )
    .all(workspaceId, ...hide, new Date().toISOString())) as WikiPage[];
}

type Locale = 'en' | 'es' | 'pt';
const STRINGS = { en: en.emails, es: es.emails, pt: pt.emails };
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

/**
 * Avisa a los dueños de las páginas cuya verificación venció. Corre en el
 * cron horario: cada fila se reclama (verify_notified_at IS NULL y el mismo
 * verified_until) antes de avisar, así dos corridas no mandan dos avisos.
 */
export async function fireVerificationExpiry(opts: { now?: Date; limit?: number } = {}): Promise<number> {
  const db = getDb();
  const now = (opts.now ?? new Date()).toISOString();
  const rows = (await db
    .prepare(
      `SELECT p.id, p.title, p.verified_until, COALESCE(p.page_owner_id, p.verified_by) AS owner_id, u.email, p.verify_locale AS locale
       FROM docs_pages p LEFT JOIN users u ON u.id = COALESCE(p.page_owner_id, p.verified_by)
       WHERE p.archived = 0 AND p.verified_at IS NOT NULL AND p.verified_until IS NOT NULL
         AND p.verified_until <= ? AND p.verify_notified_at IS NULL
       ORDER BY p.verified_until ASC LIMIT ?`,
    )
    .all(now, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as Array<{
    id: string;
    title: string;
    verified_until: string;
    owner_id: string | null;
    email: string | null;
    locale: string | null;
  }>;
  let fired = 0;
  for (const r of rows) {
    const claimed = await db
      .prepare('UPDATE docs_pages SET verify_notified_at = ? WHERE id = ? AND verify_notified_at IS NULL AND verified_until = ?')
      .run(now, r.id, r.verified_until);
    if (!claimed.changes || !r.owner_id) continue;
    fired++;
    const locale: Locale = r.locale === 'es' || r.locale === 'pt' ? r.locale : 'en';
    const s = STRINGS[locale];
    const title = r.title.trim() || s.untitled;
    await createNotification({
      userId: r.owner_id,
      type: 'docs_reminder',
      title: fill(s.verifyExpiredTitle, { title }),
      body: s.verifyExpiredBody,
      href: `/app/docs/${encodeURIComponent(r.id)}`,
      sourceType: 'docs_page',
      sourceId: r.id,
      meta: { verifyExpired: true },
    }).catch(() => undefined);
    if (r.email) {
      const link = `${siteUrl()}/${locale}/app/docs/${encodeURIComponent(r.id)}`;
      await sendEmail({
        to: r.email,
        subject: fill(s.verifyExpiredTitle, { title }),
        text: `${s.verifyExpiredBody}\n\n${link}`,
        html: renderBrandedHtml({
          eyebrow: 'zerosoft · docs',
          heading: title,
          paragraphs: [escapeHtml(s.verifyExpiredBody), `<a href="${escapeHtml(link)}">${escapeHtml(s.verifyOpen)}</a>`],
        }),
      }).catch(() => undefined);
    }
  }
  return fired;
}
