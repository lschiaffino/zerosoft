import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listsForViewer } from '@/lib/crm-list-access';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import { sessionScope } from '@/lib/crm-visibility';
import { listRuns } from '@/lib/crm-ai-agents';
import { crmAiAvailable } from '@/lib/crm-ai';
import AiRunsIndex from '@/components/crm/AiRunsIndex';

export const dynamic = 'force-dynamic';

/** Agentes de IA del CRM: completar datos y redactar primeros emails, con sus corridas. */
export default async function CrmAgentsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm.ai' });
  const [runs, lists, available] = await Promise.all([listRuns(user.id), sessionScope(user).then((scope) => listsForViewer(sessionFieldViewer(user), scope)), crmAiAvailable()]);
  return (
    <div className="app-page">
      <AiRunsIndex
        title={t('agents.title')}
        locale={locale}
        runs={runs}
        lists={lists.map((l) => ({ id: l.id, name: l.name, count: l.memberCount }))}
        available={available}
        openNew={sp.new === '1'}
      />
    </div>
  );
}
