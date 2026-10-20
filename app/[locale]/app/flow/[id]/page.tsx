import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { listAgents } from '@/lib/agents';
import { getFlow, lastOutputs, listFlows, listFlowWebhooks } from '@/lib/flow';
import { flowCodeAvailable } from '@/lib/flow-code';
import { listCredentials } from '@/lib/flow-credentials';
import { listRobots } from '@/lib/robots';
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
  const [credentials, flows, agents, robots] = await Promise.all([
    listCredentials(user.id),
    listFlows(user.id),
    listAgents(user.id),
    listRobots(user.id),
  ]);
  return (
    <FlowEditor
      key={flow.id}
      flow={flow}
      canEdit={canEdit}
      webhooks={canEdit ? await listFlowWebhooks(user.id, id) : []}
      lastOutputs={await lastOutputs(user.id, id)}
      refs={{
        credentials: credentials.map((c) => ({ id: c.id, name: c.name, type: c.type })),
        flows: flows.map((f) => ({ id: f.id, name: f.name })),
        agents: agents.map((a) => ({ id: a.id, name: a.name })),
        robots: robots.map((r) => ({
          id: r.id,
          name: r.name,
          inputs: r.inputs.map((d) => ({ name: d.name, label: d.label, required: d.required, default: d.default })),
        })),
        codeAvailable: flowCodeAvailable(),
      }}
    />
  );
}
