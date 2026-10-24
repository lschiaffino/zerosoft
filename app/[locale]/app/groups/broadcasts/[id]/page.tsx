import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getBroadcast } from '@/lib/groups-broadcasts';
import PageHeader from '@/components/ui/PageHeader';
import BroadcastDetail from '@/components/groups/BroadcastDetail';

export const dynamic = 'force-dynamic';

export default async function BroadcastPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const data = await getBroadcast(user.id, id);
  if (!data) notFound();
  return (
    <div className="ui-page">
      <PageHeader
        back={{ href: '/app/groups/broadcasts', label: t('broadcasts.title') }}
        title={data.broadcast.name || t('broadcasts.untitled')}
        description={t('broadcasts.detailDesc', { n: data.broadcast.total })}
      />
      <BroadcastDetail initial={data} />
    </div>
  );
}
