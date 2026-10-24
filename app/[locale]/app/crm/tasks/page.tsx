import { getTranslations } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { countQueueTasks } from '@/lib/crm-work-queue';
import { sessionScope } from '@/lib/crm-visibility';
import { listTasks, listTaskProjects, type TaskBucket } from '@/lib/crm';
import { listMembers } from '@/lib/teams';
import { relDate } from '@/lib/utils';
import { getUserTimeZone } from '@/lib/user-tz';
import TasksView, { type TaskRow } from '@/components/crm/TasksView';
import TaskProjectsManager from '@/components/crm/TaskProjectsManager';

export const dynamic = 'force-dynamic';

const BUCKETS: readonly TaskBucket[] = ['overdue', 'today', 'upcoming', 'done'];

interface TasksPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TasksPage(props: TasksPageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const scope = await sessionScope(user);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const bucketParam = typeof searchParams.bucket === 'string' ? searchParams.bucket : '';
  const bucket: TaskBucket = (BUCKETS as readonly string[]).includes(bucketParam)
    ? (bucketParam as TaskBucket)
    : 'today';
  const ownerId = typeof searchParams.owner === 'string' ? searchParams.owner : undefined;
  const projectId = typeof searchParams.project === 'string' ? searchParams.project : undefined;

  const teamMembers = user.team?.id
    ? await listMembers(user.team.id)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];

  const projects = await listTaskProjects(user.id, true);
  const tasks = await listTasks(user.id, { bucket, ownerId, projectId, ownerScope: scope });

  const timeZone = await getUserTimeZone();
  const queueCount = await countQueueTasks(user.id, { ownerId: realUserId(user), timeZone, ownerScope: scope });
  const fmtDue = (iso: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
      new Date(`${iso.replace(' ', 'T')}Z`),
    );

  const ownerMap = new Map(teamMembers.map((m) => [m.user_id, m.name ?? m.email]));

  const rows: TaskRow[] = tasks.map((a) => {
    let record: TaskRow['record'] = null;
    if (a.contact_id) {
      record = { href: `/app/crm/contacts/${a.contact_id}`, name: a.contact_name ?? '' };
    } else if (a.company_id) {
      record = { href: `/app/crm/companies/${a.company_id}`, name: a.company_name ?? '' };
    } else if (a.deal_id) {
      record = { href: `/app/crm/deals/${a.deal_id}`, name: a.deal_name ?? '' };
    }
    return {
      id: a.id,
      subject: a.subject,
      type: a.type,
      due: a.due_at ? fmtDue(a.due_at) : null,
      dueRel: a.due_at ? relDate(a.due_at, locale) : null,
      overdue: bucket === 'overdue',
      done: a.done === 1,
      pinned: a.pinned === 1,
      record,
      ownerId: a.owner_id ?? undefined,
      ownerName: a.owner_id ? ownerMap.get(a.owner_id) ?? '' : '',
      projectId: a.project_id ?? undefined,
      projectName: a.project_name ?? undefined,
      projectColor: a.project_color ?? undefined,
      repeat: a.repeat && a.repeat !== 'none' && a.done !== 1 ? a.repeat : undefined,
    };
  });

  const memberOptions = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));
  const projectOptions = projects.map((p) => ({
    value: p.id,
    label: p.name,
    color: p.color,
    archived: p.archived === 1,
  }));

  return (
    <div className="app-page">
      <TasksView
        title={t('tasks.title')}
        bucket={bucket}
        rows={rows}
        members={memberOptions}
        projects={projectOptions}
        ownerId={ownerId}
        projectId={projectId}
        queueCount={queueCount}
      >
        <TaskProjectsManager projects={projectOptions} />
      </TasksView>
    </div>
  );
}
