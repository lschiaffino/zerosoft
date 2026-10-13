import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { isAdminEmail } from '@/lib/feedback';
import { listRoadmapItemsAdmin, ROADMAP_STATUSES, type RoadmapStatus } from '@/lib/roadmap';
import RoadmapAdminList from '@/components/app/RoadmapAdminList';
import '@/styles/roadmap.css';

export const dynamic = 'force-dynamic';

/** Roadmap (ítems desde feedback y soporte). Solo ADMIN_EMAILS; para el resto es un 404. */
export default async function RoadmapAdminPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await props.params;
  const { status } = await props.searchParams;
  const user = await requireUser(locale);
  if (!isAdminEmail(user.actingUser?.email ?? user.email)) notFound();

  const t = await getTranslations({ locale, namespace: 'roadmap.admin' });
  const filter = ROADMAP_STATUSES.includes(status as RoadmapStatus) ? (status as RoadmapStatus) : undefined;
  const items = await listRoadmapItemsAdmin(filter);
  // Para fusionar hace falta ver todos los ítems, no solo los del filtro.
  const all = filter ? await listRoadmapItemsAdmin() : items;
  const targets = all.map((i) => ({ id: i.id, title: i.title }));

  return (
    <div className="app-page">
      <div>
        <h1 className="app-title">{t('title')}</h1>
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>{t('sub')}</p>
      </div>

      <nav className="rm-admin-filters" aria-label={t('title')}>
        <Link href="/app/settings/roadmap" className={`btn btn-small ${filter ? 'btn-ghost' : 'btn-solid'}`}>
          {t('all')}
        </Link>
        {ROADMAP_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/app/settings/roadmap?status=${s}`}
            className={`btn btn-small ${filter === s ? 'btn-solid' : 'btn-ghost'}`}
          >
            {t(`status.${s}`)}
          </Link>
        ))}
        <span className="rm-admin-spacer" />
        <Link href="/app/settings/feedback" className="btn btn-small btn-ghost">
          ← {t('backToFeedback')}
        </Link>
        <Link href="/roadmap" className="btn btn-small btn-ghost">
          {t('viewPublic')}
        </Link>
      </nav>

      {items.length === 0 ? (
        <p className="muted mono">{t('empty')}</p>
      ) : (
        <RoadmapAdminList initial={items} targets={targets} locale={locale} />
      )}
    </div>
  );
}
