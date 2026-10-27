import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { getFlowSettings, listFlows } from '@/lib/flow';
import { canEditFlows } from '@/lib/flow-http';
import { listFolders } from '@/lib/flow-folders';
import FlowsHome from '@/components/flow/FlowsHome';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Flow' };

export default async function FlowPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const [flows, settings, folders] = await Promise.all([listFlows(user.id), getFlowSettings(user.id), listFolders(user.id)]);
  return <FlowsHome flows={flows} folders={folders} canEdit={canEditFlows(user)} settings={settings} />;
}
