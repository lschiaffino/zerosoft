import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import HubspotUnlinked from '@/components/groups/HubspotUnlinked';

export const dynamic = 'force-dynamic';

/** Grupos sin empresa de HubSpot: para vincular de a muchos, con sugerencia por nombre. */
export default async function UnlinkedGroupsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  if (user.role === 'guest') notFound();
  const t = await getTranslations({ locale, namespace: 'groups' });
  return (
    <div className="ui-page">
      <PageHeader back={{ href: '/app/lines/list', label: t('list.title') }} title={t('hubspot.bulk.title')} description={t('hubspot.bulk.desc')} />
      <HubspotUnlinked />
    </div>
  );
}
