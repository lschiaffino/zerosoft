import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { canEditFlows } from '@/lib/flow-http';
import { getTable, listTableRows } from '@/lib/flow-tables';
import TableDetail from '@/components/flow/TableDetail';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Flow' };

export default async function FlowTablePage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const table = await getTable(user.id, id);
  if (!table) notFound();
  const { rows, total } = await listTableRows(user.id, id, { limit: 100 });
  return <TableDetail key={table.id} table={table} rows={rows} total={total} canEdit={canEditFlows(user)} />;
}
