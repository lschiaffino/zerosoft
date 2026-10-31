import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listNumbers } from '@/lib/groups';
import { listBroadcasts } from '@/lib/groups-broadcasts';
import { listRecurring } from '@/lib/groups-recurring';
import { visibleChatIds } from '@/lib/groups-access';
import { pageViewer } from '@/lib/groups-page';
import RecurringTable from '@/components/groups/RecurringTable';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

export const dynamic = 'force-dynamic';

/** Envíos masivos y mensajes programados, con su progreso. */
export default async function GroupsBroadcastsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const [broadcasts, numbers, recurringAll, visible] = await Promise.all([
    listBroadcasts(user.id),
    listNumbers(user.id),
    listRecurring(user.id),
    pageViewer(user).then(visibleChatIds),
  ]);
  const recurring = visible ? recurringAll.filter((r) => r.chatIds.some((id) => visible.has(id))) : recurringAll;
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div className="ui-page">
      <PageHeader
        title={t('broadcasts.title')}
        description={t('broadcasts.desc')}
        actions={
          numbers.length > 0 ? (
            <span className="gr-inline-form">
              <Link href="/app/groups/broadcasts/new?repeat=1" className="btn btn-secondary">
                {t('recurring.new')}
              </Link>
              <Link href="/app/groups/broadcasts/new" className="btn btn-primary">
                {t('broadcasts.new')}
              </Link>
            </span>
          ) : undefined
        }
      />
      {numbers.length > 0 && (
        <section className="gr-detail-section" aria-labelledby="gr-recurring-title">
          <h2 className="gr-detail-title" id="gr-recurring-title">
            {t('recurring.title')}
          </h2>
          <RecurringTable initial={recurring} />
        </section>
      )}
      {broadcasts.length === 0 ? (
        <EmptyState
          title={t('broadcasts.emptyTitle')}
          body={numbers.length ? t('broadcasts.emptyBody') : t('broadcasts.noNumbersBody')}
          action={
            numbers.length
              ? { label: t('broadcasts.new'), href: '/app/groups/broadcasts/new' }
              : { label: t('inbox.connect'), href: '/app/groups/settings?tab=numbers&new=1' }
          }
          product="groups"
        />
      ) : (
        <div className="table-wrap">
          <table className="table gr-table">
            <thead>
              <tr>
                <th>{t('broadcasts.colName')}</th>
                <th>{t('broadcasts.colStatus')}</th>
                <th className="num">{t('broadcasts.colProgress')}</th>
                <th className="gr-hide-sm">{t('broadcasts.colWhen')}</th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/app/groups/broadcasts/${b.id}`}>{b.name || b.body.slice(0, 60) || t('broadcasts.untitled')}</Link>
                    {b.kind === 'scheduled' && <span className="ui-help"> · {t('broadcasts.kindScheduled')}</span>}
                    {b.recurringId && <span className="ui-help"> · {t('recurring.run')}</span>}
                    {b.poll && <span className="ui-help"> · {t('polls.badge')}</span>}
                  </td>
                  <td>
                    <span className={`badge ${b.status === 'done' ? 'badge-ok' : b.status === 'cancelled' ? 'badge-outline' : 'badge-info'}`}>
                      {t(`broadcastStatus.${b.status}`)}
                    </span>
                  </td>
                  <td className="num">
                    {b.sent + b.failed}/{b.total}
                    {b.failed > 0 && <span className="ui-error"> · {t('broadcasts.failedN', { n: b.failed })}</span>}
                  </td>
                  <td className="gr-hide-sm ui-help">{fmt(b.scheduledAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
