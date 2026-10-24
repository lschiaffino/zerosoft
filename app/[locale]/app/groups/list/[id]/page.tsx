import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { loadChatPage } from '@/lib/groups-page';
import PageHeader from '@/components/ui/PageHeader';
import GroupDetail from '@/components/groups/GroupDetail';

export const dynamic = 'force-dynamic';

/** Un grupo (o chat): miembros, link de invitación, propiedades, CRM y la actividad reciente. */
export default async function GroupPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const data = await loadChatPage(user, id);
  if (!data) notFound();
  return (
    <div className="ui-page">
      <PageHeader
        back={{ href: '/app/groups/list', label: t('list.title') }}
        title={data.chat.name}
        description={data.chat.kind === 'group' ? t('thread.groupMeta', { n: data.chat.memberCount }) : `+${data.chat.phone}`}
        actions={
          <Link href={`/app/groups/inbox/${data.chat.id}`} className="btn btn-primary">
            {t('detail.openInbox')}
          </Link>
        }
      />
      <GroupDetail data={data} />
    </div>
  );
}
