import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listPeople } from '@/lib/groups';
import { getGroupTask, listGroupTasks } from '@/lib/groups-tasks';
import PageHeader from '@/components/ui/PageHeader';
import TasksBoard from '@/components/groups/TasksBoard';

export const dynamic = 'force-dynamic';

/** Tareas y recordatorios creados desde los chats (también están en CRM › Tareas). */
export default async function GroupsTasksPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ open?: string }> }) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'groups' });
  const me = user.actingUser?.id ?? user.id;
  const [tasks, people, opened] = await Promise.all([
    listGroupTasks(user.id, me, { status: 'open' }),
    listPeople(user.id),
    sp.open ? getGroupTask(user.id, sp.open) : Promise.resolve(null),
  ]);
  // ?open=<id> (⌘K): la tarea abierta va en la lista aunque ya esté hecha.
  const initial = opened && !tasks.some((x) => x.id === opened.id) ? [opened, ...tasks] : tasks;
  return (
    <div className="ui-page">
      <PageHeader title={t('tasks.pageTitle')} description={t('tasks.desc')} />
      <TasksBoard initial={initial} people={people} me={me} openId={opened?.id ?? null} />
    </div>
  );
}
