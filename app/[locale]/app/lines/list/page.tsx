import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { managedAvailable } from '@/lib/groups-provider-managed';
import { listChats, listLabels, listNumbers, listPropertyDefs } from '@/lib/groups';
import { pageViewer } from '@/lib/groups-page';
import { hubspotConnected } from '@/lib/groups-hubspot';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import GroupsList from '@/components/groups/GroupsList';

export const dynamic = 'force-dynamic';

export default async function GroupsListPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ new?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const me = user.actingUser?.id ?? user.id;
  const viewer = await pageViewer(user);
  const [numbers, labels, properties, open, closed] = await Promise.all([
    listNumbers(user.id, viewer),
    listLabels(user.id),
    listPropertyDefs(user.id),
    listChats(user.id, me, { kind: 'group', limit: 200, viewer }),
    listChats(user.id, me, { kind: 'group', filter: 'closed', limit: 200, viewer }),
  ]);
  return (
    <div className="ui-page">
      <PageHeader
        title={t('list.title')}
        description={t('list.desc')}
        actions={
          // Con HubSpot conectado: los grupos que todavía no tienen empresa, para vincular de a muchos.
          user.role !== 'guest' && (await hubspotConnected(user.id).catch(() => false)) ? (
            <Link href="/app/lines/list/unlinked" className="btn btn-secondary">
              {t('hubspot.bulk.open')}
            </Link>
          ) : undefined
        }
      />
      <GroupsList
        initial={[...open.rows, ...closed.rows]}
        numbers={numbers}
        labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
        properties={properties}
        openNew={sp.new === '1'}
        managed={managedAvailable()}
        canEdit={isWorkspaceAdmin(user)}
      />
    </div>
  );
}
