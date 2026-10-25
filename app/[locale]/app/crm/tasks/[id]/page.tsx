import { getUserTimeZone } from '@/lib/user-tz';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { canSeeActivity, sessionScope, scopeAnd } from '@/lib/crm-visibility';
import { getDb } from '@/lib/db';
import { getActivity, listCompanies, listContacts, listTaskFiles, listTaskProjects, type ActivityListRow } from '@/lib/crm';
import { listMembers } from '@/lib/teams';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import AssociationPanel from '@/components/crm/AssociationPanel';
import DangerDelete from '@/components/crm/DangerDelete';
import PageHeader from '@/components/ui/PageHeader';
import RecordMoreMenu from '@/components/crm/RecordMoreMenu';
import TaskFiles from '@/components/crm/TaskFiles';
import TaskDonePin from '@/components/crm/TaskDonePin';
import { ACTIVITY_TYPES } from '@/lib/crm-constants';
import { TASK_REPEATS } from '@/lib/crm-task-repeat';
import { parseDbUtc } from '@/lib/utils';
import {
  associateContactToTask,
  removeContactFromTask,
  associateCompanyToTask,
  removeCompanyFromTask,
  associateDealToTask,
  removeDealFromTask,
} from '@/components/crm/associationActions';

export const dynamic = 'force-dynamic';

interface TaskDetailPageProps {
  params: Promise<{ locale: string; id: string }>;
}

function formatDateTime(iso: string, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(parseDbUtc(iso));
}

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    parseDbUtc(iso),
  );
}

export default async function TaskDetailPage(props: TaskDetailPageProps) {
  const params = await props.params;

  const {
    locale,
    id
  } = params;

  const user = await requireUser(locale);
  const scope = await sessionScope(user);

  const timeZone = await getUserTimeZone();
  const t = await getTranslations({ locale, namespace: 'crm' });

  const task = await getActivity(user.id, id);
  if (!task || task.type !== 'task') notFound();
  if (!(await canSeeActivity(user.id, id, scope))) notFound();

  const files = await listTaskFiles(id);
  const projects = await listTaskProjects(user.id, true);
  const contacts = (await listContacts(user.id, { pageSize: 200, sort: 'name', ownerScope: scope })).rows;
  const companies = (await listCompanies(user.id, { pageSize: 200, sort: 'name', ownerScope: scope })).rows;
  const deals = (await getDb()
    .prepare(`SELECT id, name FROM crm_deals WHERE user_id = ?${scopeAnd('crm_deals', scope).sql} ORDER BY created_at DESC LIMIT 200`)
    .all(user.id, ...scopeAnd('crm_deals', scope).args)) as Array<{ id: string; name: string }>;

  const teamMembers = user.team?.id
    ? await listMembers(user.team.id)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];

  const ownerOptions = teamMembers.map((m) => ({ value: m.user_id, label: m.name ?? m.email }));
  const projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));
  const typeOptions = ACTIVITY_TYPES.map((v) => ({
    value: v,
    label: t(`enums.activityType.${v}`),
  }));

  const fields: PropField[] = [
    { key: 'subject', label: t('tasks.form.subject'), type: 'text', value: task.subject },
    {
      key: 'type',
      label: t('tasks.form.type'),
      type: 'select',
      value: task.type,
      options: typeOptions,
    },
    {
      key: 'body',
      label: t('tasks.form.body'),
      type: 'textarea',
      value: task.body,
    },
    {
      key: 'dueAt',
      label: t('tasks.form.dueAt'),
      type: 'datetime',
      value: task.due_at ?? '',
      // Misma fecha que el encabezado, en la zona de la persona (no el UTC crudo).
      display: task.due_at ? formatDateTime(task.due_at, locale, timeZone) : '',
      nullOption: true,
    },
    {
      key: 'repeat',
      label: t('tasks.form.repeat'),
      type: 'select',
      value: task.repeat ?? 'none',
      options: TASK_REPEATS.map((v) => ({ value: v, label: t(`tasks.repeat.${v}`) })),
    },
    {
      key: 'ownerId',
      label: t('tasks.form.owner'),
      type: 'select',
      value: task.owner_id ?? '',
      options: ownerOptions,
      nullOption: true,
    },
    {
      key: 'projectId',
      label: t('tasks.form.project'),
      type: 'select',
      value: task.project_id ?? '',
      options: projectOptions,
      nullOption: true,
    },
  ];

  const sections: PropSection[] = [
    { title: t('tasks.detail.aboutSection'), keys: ['subject', 'type', 'body', 'dueAt', 'repeat'] },
    { title: t('tasks.detail.ownershipSection'), keys: ['ownerId', 'projectId'] },
  ];

  const associatedRecord = buildAssociation(task);

  return (
    <div className="ui-page record-page">
      <PageHeader
        back={{ href: '/app/crm/tasks', label: t('tasks.title') }}
        title={task.subject || t('tasks.detail.untitled')}
        description={
          <span className="record-meta">
            {task.done === 1 && <span className="badge badge-ok">{t('tasks.done')}</span>}
            {task.pinned === 1 && <span className="badge badge-outline">{t('common.pinned')}</span>}
            {associatedRecord && (
              <Link href={associatedRecord.href} className="record-meta-link">
                {associatedRecord.label}
              </Link>
            )}
            {task.due_at && (
              <span>
                {t('tasks.dueLabel')}: {formatDateTime(task.due_at, locale, timeZone)}
              </span>
            )}
          </span>
        }
        actions={
          <RecordMoreMenu
            items={[
              {
                key: 'delete',
                label: t('tasks.detail.deleteTitle'),
                tone: 'danger',
                content: (
                  <DangerDelete
                    bare
                    endpoint={`/api/crm/activities/${task.id}`}
                    confirmToken={task.subject}
                    redirectTo="/app/crm/tasks"
                    title={t('tasks.detail.deleteTitle')}
                    desc={t('tasks.detail.deleteDesc')}
                    buttonLabel={t('tasks.detail.deleteButton')}
                    confirmLabel={t('record.confirmType', { token: task.subject })}
                    errorLabel={t('errors.generic')}
                  />
                ),
              },
            ]}
          />
        }
      />

      <div className="record-activity">
        <div className="record-activity-main">
          <TaskDonePin taskId={task.id} done={task.done === 1} pinned={task.pinned === 1} />
          <PropertiesPanel endpoint={`/api/crm/activities/${task.id}`} fields={fields} sections={sections} />
          <section className="record-block">
            <div className="assoc-head">
              <h2 className="assoc-title">{t('tasks.detail.files')}</h2>
            </div>
            <TaskFiles taskId={task.id} files={files} />
          </section>
        </div>

        <aside className="record-summary" aria-label={t('record.summary')}>
          <dl className="record-facts">
            <div>
              <dt>{t('tasks.detail.created')}</dt>
              <dd>{formatDateTime(task.created_at, locale, timeZone)}</dd>
            </div>
            <div>
              <dt>{t('tasks.detail.updated')}</dt>
              <dd>{formatDateTime(task.updated_at, locale, timeZone)}</dd>
            </div>
          </dl>
          <section className="record-summary-block">
            <AssociationPanel
              title={t('tasks.detail.contact')}
              records={
                task.contact_id && task.contact_name
                  ? [
                      {
                        id: task.contact_id,
                        name: task.contact_name,
                        href: `/app/crm/contacts/${task.contact_id}`,
                      },
                    ]
                  : []
              }
              options={contacts.map((c) => ({ id: c.id, value: `${c.first_name} ${c.last_name}`.trim() || c.email }))}
              onAssociate={associateContactToTask.bind(null, task.id)}
              onRemove={removeContactFromTask.bind(null, task.id)}
              addLabel={t('assoc.pickContact')}
              emptyLabel={t('tasks.detail.noContact')}
            />
          </section>

          <section className="record-summary-block">
            <AssociationPanel
              title={t('tasks.detail.company')}
              records={
                task.company_id && task.company_name
                  ? [
                      {
                        id: task.company_id,
                        name: task.company_name,
                        href: `/app/crm/companies/${task.company_id}`,
                      },
                    ]
                  : []
              }
              options={companies.map((c) => ({ id: c.id, value: c.name }))}
              onAssociate={associateCompanyToTask.bind(null, task.id)}
              onRemove={removeCompanyFromTask.bind(null, task.id)}
              addLabel={t('assoc.pickCompany')}
              emptyLabel={t('tasks.detail.noCompany')}
            />
          </section>

          <section className="record-summary-block">
            <AssociationPanel
              title={t('tasks.detail.deal')}
              records={
                task.deal_id && task.deal_name
                  ? [
                      {
                        id: task.deal_id,
                        name: task.deal_name,
                        href: `/app/crm/deals/${task.deal_id}`,
                      },
                    ]
                  : []
              }
              options={deals.map((d) => ({ id: d.id, value: d.name }))}
              onAssociate={associateDealToTask.bind(null, task.id)}
              onRemove={removeDealFromTask.bind(null, task.id)}
              addLabel={t('assoc.pickDeal')}
              emptyLabel={t('tasks.detail.noDeal')}
            />
          </section>

        </aside>
      </div>
    </div>
  );
}

function buildAssociation(task: ActivityListRow): { href: string; label: string } | null {
  if (task.contact_id && task.contact_name) {
    return { href: `/app/crm/contacts/${task.contact_id}`, label: task.contact_name };
  }
  if (task.company_id && task.company_name) {
    return { href: `/app/crm/companies/${task.company_id}`, label: task.company_name };
  }
  if (task.deal_id && task.deal_name) {
    return { href: `/app/crm/deals/${task.deal_id}`, label: task.deal_name };
  }
  return null;
}
