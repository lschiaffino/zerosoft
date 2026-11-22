import { getTranslations } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { workspaceTeamId } from '@/lib/workspace';
import { countQueueTasks } from '@/lib/crm-work-queue';
import { sessionScope } from '@/lib/crm-visibility';
import { sessionChatReader } from '@/lib/crm-chat-privacy';
import { listTaskProjects } from '@/lib/crm';
import { listQueues, sessionQueueViewer } from '@/lib/crm-task-queues';
import { listTaskIndex, openCountsByQueue } from '@/lib/crm-tasks-index';
import { parseTaskIndexFilter, queueParamsFor, TASK_PAGE_SIZE } from '@/lib/crm-tasks-shared';
import { isDefaultViewKey, SAVED_VIEW_PARAM } from '@/lib/crm-views-shared';
import { listMembers } from '@/lib/teams';
import { relDate, parseDbUtc } from '@/lib/utils';
import { getUserTimeZone } from '@/lib/user-tz';
import TasksView, { type TaskRow } from '@/components/crm/TasksView';
import TaskProjectsManager from '@/components/crm/TaskProjectsManager';
import TaskQueuesManager from '@/components/crm/TaskQueuesManager';
import TaskDigestToggle from '@/components/crm/TaskDigestToggle';
import { getTaskDigest } from '@/lib/crm-task-digest';
import ViewTabs from '@/components/crm/ViewTabs';
import CrmPager from '@/components/crm/CrmPager';
import { loadListViews } from '@/components/crm/viewTabsData';
import { primaryLink } from '@/lib/tasks-shared';
import { taskLinksFor } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

interface TasksPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Tareas como el índice de HubSpot: pestañas de vistas (Todas, Vencen hoy,
 * Vencidas, Próximas, Completadas y las guardadas), filtros, tabla con orden
 * por columna, selección y edición en masa, y "Empezar" la cola con lo que
 * muestra la vista.
 */
export default async function TasksPage(props: TasksPageProps) {
  const [rawParams, { locale }] = await Promise.all([props.searchParams, props.params]);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  // Links de antes (?bucket=overdue): abren la pestaña de esa vista.
  const searchParams = { ...rawParams };
  if (!searchParams[SAVED_VIEW_PARAM] && typeof searchParams.bucket === 'string' && isDefaultViewKey('tasks', searchParams.bucket)) {
    searchParams[SAVED_VIEW_PARAM] = searchParams.bucket;
  }

  const [scope, views, timeZone, chatReader] = await Promise.all([
    sessionScope(user),
    loadListViews(user, 'tasks', searchParams, new Set(), (k) => t(k as 'tasks.title')),
    getUserTimeZone(),
    sessionChatReader(user, locale),
  ]);
  const viewer = sessionQueueViewer(user);
  const queues = await listQueues(viewer);
  // Una vista compartida que filtra por una cola privada de otra persona: ese filtro no existe para quien mira.
  if (views.state.queue && !queues.some((q) => q.id === views.state.queue)) delete views.state.queue;
  const filter = parseTaskIndexFilter(views.state);
  const page = Math.max(1, Number(typeof searchParams.page === 'string' ? searchParams.page : '1') || 1);
  const ctx = { workspaceId: user.id, viewer, ownerScope: scope, chatReader, timeZone };

  const teamId = workspaceTeamId(user);
  const [teamMembers, projects, counts, list, queueCount, digest] = await Promise.all([
    teamId
      ? listMembers(teamId)
      : Promise.resolve([{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }]),
    listTaskProjects(user.id, true),
    openCountsByQueue(ctx),
    listTaskIndex(filter, ctx, page, TASK_PAGE_SIZE),
    countQueueTasks(user.id, { ownerId: realUserId(user), timeZone, ownerScope: scope }),
    getTaskDigest(user.id, realUserId(user)),
  ]);
  const { rows: tasks, total } = list;

  const fmtDue = (iso: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(parseDbUtc(iso));
  const fmtDay = (iso: string): string => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(parseDbUtc(iso));
  const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // De dónde viene cada tarea fuera del CRM (chat de WhatsApp, página, issue).
  const links = await taskLinksFor(user, tasks.map((a) => a.id));
  const ownerMap = new Map(teamMembers.map((m) => [m.user_id, m.name ?? m.email]));

  const rows: TaskRow[] = tasks.map((a) => {
    let record: TaskRow['record'] = null;
    if (a.contact_id) record = { href: `/app/crm/contacts/${a.contact_id}`, name: a.contact_name ?? '' };
    else if (a.company_id) record = { href: `/app/crm/companies/${a.company_id}`, name: a.company_name ?? '' };
    else if (a.deal_id) record = { href: `/app/crm/deals/${a.deal_id}`, name: a.deal_name ?? '' };
    return {
      id: a.id,
      subject: a.subject,
      chatPrivate: a.chat_private === 1 || undefined,
      // Tarea de llamada o email: se muestra con su tipo (sigue siendo tarea).
      type: a.task_kind ? a.task_kind : 'task',
      due: a.due_at ? fmtDue(a.due_at) : null,
      dueRel: a.due_at ? relDate(a.due_at, locale) : null,
      overdue: a.done !== 1 && !!a.due_at && a.due_at < nowUtc,
      done: a.done === 1,
      pinned: a.pinned === 1,
      record,
      ownerId: a.owner_id ?? undefined,
      ownerName: a.owner_id ? ownerMap.get(a.owner_id) ?? '' : '',
      projectId: a.project_id ?? undefined,
      projectName: a.project_name ?? undefined,
      projectColor: a.project_color ?? undefined,
      queueId: a.queue_id ?? undefined,
      queueName: a.queue_name ?? undefined,
      reminder: a.reminder_at && !a.reminder_sent_at ? fmtDue(a.reminder_at) : undefined,
      created: fmtDay(a.created_at),
      repeat: a.repeat && a.repeat !== 'none' && a.done !== 1 ? a.repeat : undefined,
      priority: a.priority === 'low' || a.priority === 'medium' || a.priority === 'high' ? a.priority : undefined,
      source: (() => {
        const l = primaryLink(links.get(a.id));
        return l && l.href ? { href: l.href, app: l.app, label: l.label } : undefined;
      })(),
    };
  });

  const memberOptions = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name, color: p.color, archived: p.archived === 1 }));
  const queueOptions = queues.map((q) => ({ ...q, openCount: counts.get(q.id) ?? 0 }));
  const pages = Math.max(1, Math.ceil(total / TASK_PAGE_SIZE));
  const pagerQuery: Record<string, string> = { ...views.keep, ...views.state };

  return (
    <div className="app-page ui-page crm-list-page">
      <TasksView
        title={t('tasks.title')}
        rows={rows}
        total={total}
        members={memberOptions}
        projects={projectOptions}
        queues={queueOptions.map((q) => ({ value: q.id, label: q.name }))}
        state={views.state}
        keep={views.keep}
        filter={filter}
        queueCount={queueCount}
        viewQueueHref={`/app/crm/tasks/queue?${new URLSearchParams(queueParamsFor(filter)).toString()}`}
        tabs={
          <ViewTabs
            entity="tasks"
            pathname="/app/crm/tasks"
            tabs={views.tabs}
            activeKey={views.activeKey}
            defaultKey={views.defaultKey}
            activeExtra={views.activeExtra}
            modified={views.modified}
            state={views.state}
            teams={views.teams}
          />
        }
        pager={<CrmPager pathname="/app/crm/tasks" query={pagerQuery} page={Math.min(page, pages)} pages={pages} total={total} locale={locale} />}
      >
        <TaskDigestToggle enabled={digest} />
        <TaskQueuesManager queues={queueOptions} />
        <TaskProjectsManager projects={projectOptions} />
      </TasksView>
    </div>
  );
}
