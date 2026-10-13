import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { listFlows } from '@/lib/flow';
import { canEditFlows } from '@/lib/flow-http';
import FlowsHome from '@/components/flow/FlowsHome';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Flow' };

export default async function FlowPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const flows = await listFlows(user.id);
  return <FlowsHome flows={flows} canEdit={canEditFlows(user)} />;
}
