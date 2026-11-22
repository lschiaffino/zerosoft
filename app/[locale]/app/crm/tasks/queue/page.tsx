import { getTranslations } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { workspaceTeamId } from '@/lib/workspace';
import { sessionScope } from '@/lib/crm-visibility';
import { sessionChatReader } from '@/lib/crm-chat-privacy';
import { listQueueTasks, parseQueueScope, QUEUE_SCOPES } from '@/lib/crm-work-queue';
import { listQueues, sessionQueueViewer } from '@/lib/crm-task-queues';
import { taskFilterWhere } from '@/lib/crm-tasks-index';
import { parseTaskIndexFilter } from '@/lib/crm-tasks-shared';
import { listMembers } from '@/lib/teams';
import { dayRangeUtc, getUserTimeZone } from '@/lib/user-tz';
import PageHeader from '@/components/ui/PageHeader';
import WorkQueue from '@/components/crm/WorkQueue';
import QueueFilters from '@/components/crm/QueueFilters';

export const dynamic = 'force-dynamic';

interface QueuePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Cola de trabajo: por defecto las tareas vencidas y de hoy (incluidos los
 * pasos manuales de secuencias) de la persona logueada, o de quien se elija.
 * Con `queue` trabaja una cola con nombre, y con los filtros del listado
 * (`type`, `priority`, `project`, `q`) sigue la vista desde la que se empezó.
 */
export default async function WorkQueuePage(props: QueuePageProps) {
  const [{ locale }, sp] = await Promise.all([props.params, props.searchParams]);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const scope = parseQueueScope(sp.scope);
  const me = realUserId(user);
  const rawOwner = one(sp.owner) ?? '';
  const ownerParam = rawOwner === 'me' ? me : rawOwner;
  const ownerId = ownerParam === 'all' ? null : ownerParam || me;
  const timeZone = await getUserTimeZone();
  const ownerScope = await sessionScope(user);
  const viewer = sessionQueueViewer(user);
  const queues = await listQueues(viewer);
  const queueId = queues.some((q) => q.id === one(sp.queue)) ? one(sp.queue) : undefined;
  const viewFilter = parseTaskIndexFilter({
    type: one(sp.type),
    priority: one(sp.priority),
    project: one(sp.project),
    q: one(sp.q),
  });
  const filtered = !!(ownerParam === 'unassigned' || queueId || viewFilter.kind || viewFilter.priority || viewFilter.projectId || viewFilter.q || scope === 'upcoming' || scope === 'all');
  const chatReader = await sessionChatReader(user, locale);
  const filter = filtered
    ? await taskFilterWhere(
        {
          bucket: scope === 'due' ? 'all' : scope,
          kind: viewFilter.kind,
          priority: viewFilter.priority,
          owner: ownerId === 'unassigned' ? 'unassigned' : ownerId ?? undefined,
          queueId,
          projectId: viewFilter.projectId,
          q: viewFilter.q,
        },
        { workspaceId: user.id, viewer, ownerScope, chatReader, timeZone },
      )
    : undefined;
  if (filter && scope === 'due') {
    // "Vencidas y de hoy" con filtros: lo abierto que vence hasta el final de hoy.
    filter.where.push('a.due_at IS NOT NULL AND a.due_at <= ?');
    filter.args.push(dayRangeUtc(timeZone).end);
  }
  const [tasks, members] = await Promise.all([
    listQueueTasks(user.id, { ownerId, scope, timeZone, ownerScope, chatReader, filter }),
    workspaceTeamId(user) ? listMembers(workspaceTeamId(user)!) : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null }]),
  ]);
  const extra: Record<string, string> = {};
  if (queueId) extra.queue = queueId;
  if (viewFilter.kind) extra.type = viewFilter.kind;
  if (viewFilter.priority) extra.priority = viewFilter.priority;
  if (viewFilter.projectId) extra.project = viewFilter.projectId;
  if (viewFilter.q) extra.q = viewFilter.q;
  // La cola se re-monta si cambian los filtros (vuelve a la primera tarea).
  const key = `${scope}:${ownerId ?? 'all'}:${JSON.stringify(extra)}:${tasks.map((x) => x.id).join(',').slice(0, 200)}`;
  const queueName = queueId ? queues.find((q) => q.id === queueId)?.name : undefined;
  return (
    <div className="ui-page">
      <PageHeader
        back={{ href: '/app/crm/tasks', label: t('queue.backToTasks') }}
        title={queueName ?? t('queue.title')}
        description={queueName ? t('queue.namedDesc') : t('queue.desc')}
        actions={
          <QueueFilters
            scope={scope}
            scopes={[...QUEUE_SCOPES]}
            owner={ownerParam === 'all' ? 'all' : ownerId ?? me}
            people={members.map((m) => ({ value: m.user_id, label: m.user_id === me ? t('queue.me') : m.name || m.email }))}
            queue={queueId ?? ''}
            queues={queues.map((q) => ({ value: q.id, label: q.name }))}
            extra={extra}
          />
        }
      />
      <WorkQueue key={key} tasks={tasks} locale={locale} timeZone={timeZone} />
    </div>
  );
}
