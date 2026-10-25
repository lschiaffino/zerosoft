import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listChats, listLabels, listNumbers, listPropertyDefs } from '@/lib/groups';
import { pageViewer } from '@/lib/groups-page';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import BroadcastComposer from '@/components/groups/BroadcastComposer';

export const dynamic = 'force-dynamic';

export default async function NewBroadcastPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ chats?: string; repeat?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const me = user.actingUser?.id ?? user.id;
  const [numbers, chats, labels, properties] = await Promise.all([
    listNumbers(user.id),
    listChats(user.id, me, { limit: 200, viewer: await pageViewer(user) }),
    listLabels(user.id),
    listPropertyDefs(user.id),
  ]);
  return (
    <div className="ui-page">
      <PageHeader back={{ href: '/app/groups/broadcasts', label: t('broadcasts.title') }} title={t('broadcasts.newTitle')} description={t('broadcasts.newDesc')} />
      {numbers.length === 0 ? (
        <EmptyState
          title={t('list.noNumbersTitle')}
          body={t('list.noNumbersBody')}
          action={{ label: t('inbox.connect'), href: '/app/groups/settings?tab=numbers&new=1' }}
          product="groups"
        />
      ) : (
        <BroadcastComposer
          numbers={numbers}
          chats={chats.rows}
          labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
          properties={properties}
          preselected={(sp.chats ?? '').split(',').filter(Boolean).slice(0, 2000)}
          initialWhen={sp.repeat === '1' ? 'repeat' : 'now'}
        />
      )}
    </div>
  );
}
