import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listTasks, type TaskBucket } from '@/lib/crm';
import TasksView, { type TaskRow } from '@/components/crm/TasksView';

export const dynamic = 'force-dynamic';

const BUCKETS: readonly TaskBucket[] = ['overdue', 'today', 'upcoming', 'done'];

interface TasksPageProps {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function TasksPage({ params: { locale }, searchParams }: TasksPageProps) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const bucketParam = typeof searchParams.bucket === 'string' ? searchParams.bucket : '';
  const bucket: TaskBucket = (BUCKETS as readonly string[]).includes(bucketParam)
    ? (bucketParam as TaskBucket)
    : 'today';

  const tasks = listTasks(user.id, bucket);

  const fmtDue = (iso: string): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
      new Date(`${iso.replace(' ', 'T')}Z`),
    );

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
      due: a.due_at ? fmtDue(a.due_at) : null,
      overdue: bucket === 'overdue',
      done: a.done === 1,
      record,
    };
  });

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('tasks.title')}</h1>
      </div>
      <TasksView bucket={bucket} rows={rows} />
    </div>
  );
}
