import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getChat, listChats, listLabels, listNumbers, listPropertyDefs, type ChatDto } from '@/lib/groups';
import { savedListChatIds } from '@/lib/groups-org';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import BroadcastComposer from '@/components/groups/BroadcastComposer';

export const dynamic = 'force-dynamic';

export default async function NewBroadcastPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ chats?: string; list?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const me = user.actingUser?.id ?? user.id;
  const [numbers, chats, labels, properties] = await Promise.all([
    listNumbers(user.id),
    listChats(user.id, me, { limit: 200 }),
    listLabels(user.id),
    listPropertyDefs(user.id),
  ]);
  // ?list=<id>: la audiencia es una lista guardada (sus chats de hoy, hasta 500).
  let preselected = (sp.chats ?? '').split(',').filter(Boolean).slice(0, 2000);
  const rows: ChatDto[] = [...chats.rows];
  if (sp.list) {
    const fromList = await savedListChatIds(user.id, me, sp.list).catch(() => []);
    preselected = [...new Set([...preselected, ...fromList.map((c) => c.id)])];
    const known = new Set(rows.map((c) => c.id));
    for (const c of fromList) {
      if (known.has(c.id)) continue;
      const dto = await getChat(user.id, c.id);
      if (dto) rows.push(dto);
    }
  }
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
          chats={rows}
          labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
          properties={properties}
          preselected={preselected}
        />
      )}
    </div>
  );
}
