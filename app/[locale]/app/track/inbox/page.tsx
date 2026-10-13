import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import InboxClient from '@/components/track/InboxClient';

export const dynamic = 'force-dynamic';

export default async function TrackInboxPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });

  return (
    <div className="app-page track-page">
      <div className="track-page-header">
        <h1>{t('inbox.title')}</h1>
      </div>

      <InboxClient
        locale={locale}
        labels={{
          all: t('inbox.all'),
          mentions: t('inbox.mentions'),
          assigned: t('inbox.assigned'),
          updates: t('inbox.updates'),
          empty: t('inbox.empty'),
          markAllRead: t('inbox.markAllRead'),
          loadMore: t('inbox.loadMore'),
          markRead: t('notifications.markRead'),
          mentionedYou: t('activity.mentionedYou'),
          assignedYou: t('activity.assignedYou'),
          commentedOn: t('activity.commentedOn'),
          changedStatus: t('activity.changedStatus'),
        }}
      />
    </div>
  );
}
