import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { isAdminEmail } from '@/lib/feedback';
import { listRoadmapItemsAdmin, ROADMAP_STATUSES, type RoadmapStatus } from '@/lib/roadmap';
import RoadmapAdminList from '@/components/app/RoadmapAdminList';
import RoadmapKanban from '@/components/app/RoadmapKanban';
import AdminNav, { LinkGroup } from '@/components/app/AdminNav';
import EmptyState from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings' });
  return { title: `${t('admin.roadmap')} · ${t('title')}` };
}

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
  const ts = await getTranslations({ locale, namespace: 'settings.admin' });
  const isList = view === 'list';
  const filter = isList && ROADMAP_STATUSES.includes(status as RoadmapStatus) ? (status as RoadmapStatus) : undefined;
  const all = await listRoadmapItemsAdmin();
  const items = filter ? all.filter((i) => i.status === filter) : all;
  const targets = all.map((i) => ({ id: i.id, title: i.title }));

  return (
    <div className="st-stack">
      <AdminNav
        locale={locale}
        current="roadmap"
        description={t('sub')}
        aside={
          <>
            <LinkGroup
              label={ts('view')}
              items={[
                { key: 'kanban', href: '/app/settings/roadmap', label: t('viewKanban'), active: !isList },
                { key: 'list', href: '/app/settings/roadmap?view=list', label: t('viewList'), active: isList },
              ]}
            />
            <Link href="/feedback-board" className="btn btn-ghost btn-sm">
              {ts('publicBoard')}
            </Link>
          </>
        }
      />

      {isList && (
        <LinkGroup
          label={ts('filter')}
          items={[
            { key: 'all', href: '/app/settings/roadmap?view=list', label: t('all'), active: !filter },
            ...ROADMAP_STATUSES.map((s) => ({
              key: s,
              href: `/app/settings/roadmap?view=list&status=${s}`,
              label: t(`status.${s}`),
              active: filter === s,
            })),
          ]}
        />
      )}

      {!isList ? (
        <RoadmapKanban initial={all} locale={locale} />
      ) : items.length === 0 ? (
        filter ? (
          <EmptyState
            title={ts('roadmapEmptyFiltered')}
            action={<Link href="/app/settings/roadmap?view=list" className="btn btn-secondary">{ts('showAll')}</Link>}
          />
        ) : (
          <EmptyState
            title={ts('roadmapEmptyTitle')}
            body={t('empty')}
            action={<Link href="/app/settings/roadmap" className="btn btn-primary">{t('viewKanban')}</Link>}
          />
        )
      ) : (
        <RoadmapAdminList initial={items} targets={targets} locale={locale} />
      )}
    </div>
  );
}
