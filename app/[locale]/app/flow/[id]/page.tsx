import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getFlow, lastOutputs, listFlowWebhooks } from '@/lib/flow';
import { canEditFlows } from '@/lib/flow-http';
import FlowEditor from '@/components/flow/FlowEditor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Flow' };

export default async function FlowEditorPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const flow = await getFlow(user.id, id);
  if (!flow) notFound();
  const canEdit = canEditFlows(user);
  return (
    <FlowEditor
      key={flow.id}
      flow={flow}
      canEdit={canEdit}
      webhooks={canEdit ? await listFlowWebhooks(user.id, id) : []}
      lastOutputs={await lastOutputs(user.id, id)}
    />
  );
}
