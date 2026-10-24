import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { getRun } from '@/lib/crm-ai-agents';
import AiRunView from '@/components/crm/AiRunView';

export const dynamic = 'force-dynamic';

export default async function CrmAgentRunPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const run = await getRun(user.id, id, await sessionScope(user));
  if (!run) notFound();
  return (
    <div className="app-page">
      <AiRunView initial={run} />
    </div>
  );
}
