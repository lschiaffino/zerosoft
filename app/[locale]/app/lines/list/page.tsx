import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { managedAvailable } from '@/lib/groups-provider-managed';
import { listLabels, listNumbers, listPropertyDefs } from '@/lib/groups';
import { listGroupsTable } from '@/lib/groups-table';
import { pageViewer } from '@/lib/groups-page';
import { hubspotConnected } from '@/lib/groups-hubspot';
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
  const [numbers, labels, properties, table] = await Promise.all([
    listNumbers(user.id, viewer),
    listLabels(user.id, viewer),
    listPropertyDefs(user.id),
    // Una fila por grupo aunque esté en varias líneas (la vista guardada en el navegador se aplica al cargar).
    listGroupsTable(user.id, me, viewer),
  ]);
  return (
    <div className="ui-page">
      <PageHeader title={t('list.title')} description={t('list.desc')} />
      <GroupsList
        initial={table}
        numbers={numbers}
        labels={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
        properties={properties}
        openNew={sp.new === '1'}
        managed={managedAvailable()}
        canEdit={isWorkspaceAdmin(user)}
        // Con HubSpot conectado: los grupos que todavía no tienen empresa, para vincular de a muchos.
        hubspotBulk={user.role !== 'guest' && (await hubspotConnected(user.id).catch(() => false))}
      />
    </div>
  );
}
