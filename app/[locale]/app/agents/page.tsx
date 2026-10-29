import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { listAgents } from '@/lib/agents';
import { canEditAgents } from '@/lib/agents-http';
import { aiEnabled } from '@/lib/ai';
import AgentsHome from '@/components/agents/AgentsHome';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Agents' };

export default async function AgentsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const agents = await listAgents(user.id, user);
  return <AgentsHome agents={agents} canEdit={canEditAgents(user)} aiEnabled={aiEnabled()} />;
}
