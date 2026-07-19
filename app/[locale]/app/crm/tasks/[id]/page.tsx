import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { getActivity, listCompanies, listContacts, listTaskFiles, listTaskProjects, type ActivityListRow } from '@/lib/crm';
import { listMembers } from '@/lib/teams';
import PropertiesPanel, { type PropField, type PropSection } from '@/components/crm/PropertiesPanel';
import AssociationPanel from '@/components/crm/AssociationPanel';
import DangerDelete from '@/components/crm/DangerDelete';
import TaskFiles from '@/components/crm/TaskFiles';
import TaskDonePin from '@/components/crm/TaskDonePin';
import { ACTIVITY_TYPES } from '@/lib/crm-constants';
import { setTaskCompany, setTaskContact, setTaskDeal } from '@/components/crm/associationActions';

export const dynamic = 'force-dynamic';

interface TaskDetailPageProps {
  params: { locale: string; id: string };
}

function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${iso.replace(' ', 'T')}Z`));
}

function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${iso.replace(' ', 'T')}Z`),
  );
}

export default async function TaskDetailPage({ params: { locale, id } }: TaskDetailPageProps) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const task = await getActivity(user.id, id);
  if (!task || task.type !== 'task') notFound();

  const files = await listTaskFiles(id);
  const projects = await listTaskProjects(user.id, true);
  const contacts = (await listContacts(user.id, { pageSize: 200, sort: 'name' })).rows;
  const companies = (await listCompanies(user.id, { pageSize: 200, sort: 'name' })).rows;
  const deals = (await getDb()
    .prepare('SELECT id, name FROM crm_deals WHERE user_id = ? ORDER BY created_at DESC LIMIT 200')
    .all(user.id)) as Array<{ id: string; name: string }>;

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
      type: 'text',
      value: task.due_at ?? '',
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
    { title: t('tasks.detail.aboutSection'), keys: ['subject', 'type', 'body', 'dueAt'] },
    { title: t('tasks.detail.ownershipSection'), keys: ['ownerId', 'projectId'] },
  ];

  const associatedRecord = buildAssociation(task);

  return (
    <div className="app-page">
      <Link href="/app/crm/tasks" className="mono back-link">
        {t('tasks.detail.back')}
      </Link>

      <header className="detail-header">
        <div className="detail-title-row">
          <h1 className="detail-title">{task.subject || t('tasks.detail.untitled')}</h1>
          {task.done === 1 && <span className="badge task-done">{t('tasks.done')}</span>}
          {task.pinned === 1 && <span className="badge">{t('common.pinned')}</span>}
        </div>
        <div className="detail-meta">
          {associatedRecord && (
            <Link href={associatedRecord.href} className="detail-meta-item">
              {associatedRecord.label}
            </Link>
          )}
          {task.due_at && (
            <span className="detail-meta-item muted">
              {t('tasks.dueLabel')}: {formatDateTime(task.due_at, locale)}
            </span>
          )}
        </div>
      </header>

      <div className="detail-grid-3">
        <div className="detail-col">
          <section className="panel" id="properties">
            <p className="section-label">{t('tasks.detail.properties')}</p>
            <TaskDonePin taskId={task.id} done={task.done === 1} pinned={task.pinned === 1} />
            <PropertiesPanel
              endpoint={`/api/crm/activities/${task.id}`}
              fields={fields}
              sections={sections}
              compactKeys={['subject', 'type', 'dueAt', 'ownerId', 'projectId']}
              viewAllLabel={t('contacts.detail.viewAllProperties')}
            />
          </section>
        </div>

        <div className="detail-col">
          <section className="panel">
            <p className="section-label">{t('tasks.detail.files')}</p>
            <TaskFiles taskId={task.id} files={files} />
          </section>

          <section className="panel">
            <p className="section-label">{t('tasks.detail.activity')}</p>
            <div className="prop-table">
              <div className="prop-row">
                <dt className="prop-label">{t('tasks.detail.created')}</dt>
                <dd className="prop-value">{formatDateTime(task.created_at, locale)}</dd>
              </div>
              <div className="prop-row">
                <dt className="prop-label">{t('tasks.detail.updated')}</dt>
                <dd className="prop-value">{formatDateTime(task.updated_at, locale)}</dd>
              </div>
            </div>
          </section>
        </div>

        <div className="detail-col detail-col-side">
          <section className="panel">
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
              onAssociate={async (contactId) => {
                await setTaskContact(task.id, contactId);
              }}
              onRemove={async () => {
                await setTaskContact(task.id, null);
              }}
              addLabel={t('assoc.pickContact')}
              emptyLabel={t('tasks.detail.noContact')}
            />
          </section>

          <section className="panel">
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
              onAssociate={async (companyId) => {
                await setTaskCompany(task.id, companyId);
              }}
              onRemove={async () => {
                await setTaskCompany(task.id, null);
              }}
              addLabel={t('assoc.pickCompany')}
              emptyLabel={t('tasks.detail.noCompany')}
            />
          </section>

          <section className="panel">
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
              onAssociate={async (dealId) => {
                await setTaskDeal(task.id, dealId);
              }}
              onRemove={async () => {
                await setTaskDeal(task.id, null);
              }}
              addLabel={t('assoc.pickDeal')}
              emptyLabel={t('tasks.detail.noDeal')}
            />
          </section>

          <section className="panel danger-panel">
            <p className="section-label">{t('contacts.detail.dangerZone')}</p>
            <DangerDelete
              endpoint={`/api/crm/activities/${task.id}`}
              confirmToken={task.subject}
              redirectTo="/app/crm/tasks"
              title={t('tasks.detail.deleteTitle')}
              desc={t('tasks.detail.deleteDesc')}
              buttonLabel={t('tasks.detail.deleteButton')}
            />
          </section>
        </div>
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
