import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { chatDisplayName, getNumberRow } from '@/lib/groups';
import { getRecurring, recurringRuns } from '@/lib/groups-recurring';
import { maskedChatName, visibleChatIds } from '@/lib/groups-access';
import { pageViewer } from '@/lib/groups-page';
import { PROVIDER_CAPS } from '@/lib/groups-provider';
import PageHeader from '@/components/ui/PageHeader';
import RecurringDetail from '@/components/groups/RecurringDetail';

export const dynamic = 'force-dynamic';

/** Un mensaje recurrente: editar, pausar, borrar, próximas corridas y las corridas anteriores. */
export default async function RecurringPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const viewer = await pageViewer(user);
  const rec = await getRecurring(user.id, id);
  const visible = await visibleChatIds(viewer);
  if (!rec || (visible && !rec.chatIds.some((c) => visible.has(c)))) notFound();
  const marks = rec.chatIds.map(() => '?').join(',') || "''";
  const chats = (await getDb()
    .prepare(`SELECT id, name, phone, provider_chat_id, kind FROM groups_chats WHERE user_id = ? AND id IN (${marks})`)
    .all(user.id, ...rec.chatIds)) as Array<{ id: string; name: string; phone: string; provider_chat_id: string; kind: 'dm' | 'group' }>;
  const number = await getNumberRow(user.id, rec.numberId);
  const runs = await recurringRuns(user.id, id);
  const title = rec.name || (rec.poll ? rec.poll.question : rec.body.slice(0, 60)) || t('broadcasts.untitled');
  return (
    <div className="ui-page">
      <PageHeader back={{ href: '/app/groups/broadcasts', label: t('broadcasts.title') }} title={title} description={t('recurring.detailDesc')} />
      <RecurringDetail
        initial={rec}
        runs={runs}
        chats={chats.map((c) => ({ id: c.id, name: viewer.mask ? maskedChatName(viewer, c) : chatDisplayName(c), kind: c.kind }))}
        numberName={number?.name ?? ''}
        pollsOk={number ? PROVIDER_CAPS[number.provider].polls : false}
      />
    </div>
  );
}
