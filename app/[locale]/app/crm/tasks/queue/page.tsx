import { getTranslations } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listQueueTasks, parseQueueScope, QUEUE_SCOPES } from '@/lib/crm-work-queue';
import { listMembers } from '@/lib/teams';
import { getUserTimeZone } from '@/lib/user-tz';
import PageHeader from '@/components/ui/PageHeader';
import WorkQueue from '@/components/crm/WorkQueue';
import QueueFilters from '@/components/crm/QueueFilters';

export const dynamic = 'force-dynamic';

interface QueuePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Cola de trabajo del día: tareas vencidas y de hoy (incluidos los pasos
 * manuales de secuencias) de la persona logueada, o de quien se elija.
 */
export default async function WorkQueuePage(props: QueuePageProps) {
  const [{ locale }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const scope = parseQueueScope(sp.scope);
  const me = realUserId(user);
  const ownerParam = typeof sp.owner === 'string' ? sp.owner : '';
  const ownerId = ownerParam === 'all' ? null : ownerParam || me;
  const timeZone = await getUserTimeZone();
  const [tasks, members] = await Promise.all([
    listQueueTasks(user.id, { ownerId, scope, timeZone, ownerScope: await sessionScope(user) }),
    user.team?.id ? listMembers(user.team.id) : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null }]),
  ]);
  // La cola se re-monta si cambian los filtros (vuelve a la primera tarea).
  const key = `${scope}:${ownerId ?? 'all'}:${tasks.map((x) => x.id).join(',').slice(0, 200)}`;
  return (
    <div className="ui-page">
      <PageHeader
        back={{ href: '/app/crm/tasks', label: t('queue.backToTasks') }}
        title={t('queue.title')}
        description={t('queue.desc')}
        actions={
          <QueueFilters
            scope={scope}
            scopes={[...QUEUE_SCOPES]}
            owner={ownerParam === 'all' ? 'all' : ownerId ?? me}
            people={members.map((m) => ({ value: m.user_id, label: m.user_id === me ? t('queue.me') : m.name || m.email }))}
          />
        }
      />
      <WorkQueue key={key} tasks={tasks} locale={locale} timeZone={timeZone} />
    </div>
  );
}
