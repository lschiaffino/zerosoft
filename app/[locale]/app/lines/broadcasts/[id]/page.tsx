import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { canAccessBroadcast, getBroadcast } from '@/lib/groups-broadcasts';
import { groupsViewer, visibleChatIds } from '@/lib/groups-access';
import PageHeader from '@/components/ui/PageHeader';
import BroadcastDetail from '@/components/groups/BroadcastDetail';

export const dynamic = 'force-dynamic';

export default async function BroadcastPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  // Como la API: solo si el envío va a chats que esta persona ve.
  const viewer = await groupsViewer(user.id, user.actingUser?.id ?? user.id, user.role);
  const visible = await visibleChatIds(viewer);
  if (!(await canAccessBroadcast(user.id, id, visible))) notFound();
  const data = await getBroadcast(user.id, id, { mask: viewer.mask });
  if (!data) notFound();
  return (
    <div className="ui-page">
      <PageHeader
        back={{ href: '/app/lines/broadcasts', label: t('broadcasts.title') }}
        title={data.broadcast.name || t('broadcasts.untitled')}
        description={t('broadcasts.detailDesc', { n: data.broadcast.total })}
      />
      <BroadcastDetail initial={data} />
    </div>
  );
}
