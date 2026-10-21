import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import InboxClient from '@/components/track/InboxClient';

export const dynamic = 'force-dynamic';

export default async function TrackInboxPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });

  return (
    <div className="app-page track-page">
      <InboxClient
        locale={locale}
        labels={{
          title: t('inbox.title'),
          all: t('inbox.all'),
          mentions: t('inbox.mentions'),
          assigned: t('inbox.assigned'),
          updates: t('inbox.updates'),
          empty: t('inbox.empty'),
          emptyBody: t('inbox.emptyBody'),
          markAllRead: t('inbox.markAllRead'),
          loadMore: t('inbox.loadMore'),
          markRead: t('notifications.markRead'),
          unread: t('inbox.unread'),
          loading: t('common.loading'),
          loadError: t('inbox.loadError'),
          retry: t('common.retry'),
          someone: t('inbox.someone'),
          mentionedYou: t.raw('activity.mentionedYou') as string,
          assignedYou: t.raw('activity.assignedYou') as string,
          commentedOn: t.raw('activity.commentedOn') as string,
          changedStatus: t.raw('activity.changedStatus') as string,
          updatedIssue: t.raw('activity.updatedIssue') as string,
        }}
      />
    </div>
  );
}
