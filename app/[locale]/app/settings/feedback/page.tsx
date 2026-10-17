import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { FEEDBACK_STATUSES, isAdminEmail, listFeedback, type FeedbackStatus } from '@/lib/feedback';
import FeedbackAdminList from '@/components/app/FeedbackAdminList';
import AdminNav, { LinkGroup } from '@/components/app/AdminNav';
import EmptyState from '@/components/ui/EmptyState';
import { itemsForFeedback, listRoadmapItemsAdmin } from '@/lib/roadmap';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings' });
  return { title: `${t('admin.feedback')} · ${t('title')}` };
}

/** Feedback recibido. Solo ADMIN_EMAILS; para el resto (o sin la env) es un 404. */
export default async function FeedbackAdminPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await props.params;
  const { status } = await props.searchParams;
  const user = await requireUser(locale);
  if (!isAdminEmail(user.actingUser?.email ?? user.email)) notFound();

  const t = await getTranslations({ locale, namespace: 'feedback.admin' });
  const ts = await getTranslations({ locale, namespace: 'settings.admin' });
  const filter = FEEDBACK_STATUSES.includes(status as FeedbackStatus) ? (status as FeedbackStatus) : undefined;
  const rows = await listFeedback({ status: filter });
  const [items, linkedMap] = await Promise.all([listRoadmapItemsAdmin(), itemsForFeedback(rows.map((r) => r.id))]);
  const targets = items.filter((i) => i.status !== 'declined').map((i) => ({ id: i.id, title: i.title }));
  const linked = Object.fromEntries(linkedMap);

  return (
    <div className="st-stack">
      <AdminNav
        locale={locale}
        current="feedback"
        description={ts('feedbackDesc')}
        aside={
          <LinkGroup
            label={ts('filter')}
            items={[
              { key: 'all', href: '/app/settings/feedback', label: t('all'), active: !filter },
              ...FEEDBACK_STATUSES.map((s) => ({
                key: s,
                href: `/app/settings/feedback?status=${s}`,
                label: t(`status.${s}`),
                active: filter === s,
              })),
            ]}
          />
        }
      />

      {rows.length === 0 ? (
        filter ? (
          <EmptyState
            title={ts('feedbackEmptyFiltered')}
            action={<Link href="/app/settings/feedback" className="btn btn-secondary">{ts('showAll')}</Link>}
          />
        ) : (
          <EmptyState title={ts('feedbackEmptyTitle')} body={ts('feedbackEmptyBody')} />
        )
      ) : (
        <FeedbackAdminList initial={rows} locale={locale} targets={targets} linked={linked} />
      )}
    </div>
  );
}
