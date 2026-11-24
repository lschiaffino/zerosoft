import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import InboxClient from '@/components/track/InboxClient';

export const dynamic = 'force-dynamic';

/**
 * La bandeja queda montada mientras se abren avisos: el issue va en el panel
 * de al lado (inbox/[issueId]) y la lista conserva su lugar, la fila activa y
 * el teclado, como la Inbox de Linear. En el teléfono el issue ocupa la página.
 */
export default async function TrackInboxLayout(props: { params: Promise<{ locale: string }>; children: ReactNode }) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });

  return (
    <div className="app-page track-page track-inbox-shell">
      <InboxClient
        locale={locale}
        labels={{
          title: t('inbox.title'),
          empty: t('inbox.empty'),
          emptyBody: t('inbox.emptyBody'),
          markAllRead: t('inbox.markAllRead'),
          loadMore: t('inbox.loadMore'),
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
      >
        {props.children}
      </InboxClient>
    </div>
  );
}
