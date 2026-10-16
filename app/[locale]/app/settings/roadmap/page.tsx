import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { isAdminEmail } from '@/lib/feedback';
import { listRoadmapItemsAdmin, ROADMAP_STATUSES, type RoadmapStatus } from '@/lib/roadmap';
import RoadmapAdminList from '@/components/app/RoadmapAdminList';
import RoadmapKanban from '@/components/app/RoadmapKanban';
import '@/styles/roadmap.css';

export const dynamic = 'force-dynamic';

/**
 * Roadmap (ítems del board, el feedback y los chats de soporte). Kanban con
 * drag and drop por defecto; ?view=list es la lista con filtros por estado.
 * Solo ADMIN_EMAILS; para el resto es un 404.
 */
export default async function RoadmapAdminPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; view?: string }>;
}) {
  const { locale } = await props.params;
  const { status, view } = await props.searchParams;
  const user = await requireUser(locale);
  if (!isAdminEmail(user.actingUser?.email ?? user.email)) notFound();

  const t = await getTranslations({ locale, namespace: 'roadmap.admin' });
  const isList = view === 'list';
  const filter = isList && ROADMAP_STATUSES.includes(status as RoadmapStatus) ? (status as RoadmapStatus) : undefined;
  const all = await listRoadmapItemsAdmin();
  const items = filter ? all.filter((i) => i.status === filter) : all;
  const targets = all.map((i) => ({ id: i.id, title: i.title }));

  return (
    <div className="app-page">
      <div>
        <h1 className="app-title">{t('title')}</h1>
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>{t('sub')}</p>
      </div>

      <nav className="rm-admin-filters" aria-label={t('title')}>
        <Link href="/app/settings/roadmap" className={`btn btn-small ${isList ? 'btn-ghost' : 'btn-solid'}`}>
          {t('viewKanban')}
        </Link>
        <Link href="/app/settings/roadmap?view=list" className={`btn btn-small ${isList && !filter ? 'btn-solid' : 'btn-ghost'}`}>
          {t('viewList')}
        </Link>
        {isList &&
          ROADMAP_STATUSES.map((s) => (
            <Link
              key={s}
              href={`/app/settings/roadmap?view=list&status=${s}`}
              className={`btn btn-small ${filter === s ? 'btn-solid' : 'btn-ghost'}`}
            >
              {t(`status.${s}`)}
            </Link>
          ))}
        <span className="rm-admin-spacer" />
        <Link href="/app/settings/feedback" className="btn btn-small btn-ghost">
          ← {t('backToFeedback')}
        </Link>
        <Link href="/app/settings/changelog" className="btn btn-small btn-ghost">
          {t('changelogLink')}
        </Link>
        <Link href="/feedback-board" className="btn btn-small btn-ghost">
          {t('viewPublic')}
        </Link>
      </nav>

      {!isList ? (
        <RoadmapKanban initial={all} locale={locale} />
      ) : items.length === 0 ? (
        <p className="muted mono">{t('empty')}</p>
      ) : (
        <RoadmapAdminList initial={items} targets={targets} locale={locale} />
      )}
    </div>
  );
}
