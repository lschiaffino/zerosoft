import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { canEditFlows } from '@/lib/flow-http';
import { listTables } from '@/lib/flow-tables';
import TablesManager from '@/components/flow/TablesManager';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Flow' };

export default async function FlowTablesPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  return <TablesManager tables={await listTables(user.id)} canEdit={canEditFlows(user)} />;
}
