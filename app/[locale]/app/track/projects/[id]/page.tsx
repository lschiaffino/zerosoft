import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getProject, listIssues, listStatuses, listCycles } from '@/lib/track-data';
import IssuesTable from '@/components/track/IssuesTable';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  const user = await requireUser(locale);
  const project = await getProject(id);
  if (!project || project.team_id !== (user.team?.id ?? null)) notFound();

  const t = await getTranslations({ locale, namespace: 'track' });
  const statuses = await listStatuses(id);
  const cycles = await listCycles(id);
  const { rows: issues } = await listIssues(id, { pageSize: 50 });

  return (
    <div className="app-page track-page">
      <div className="track-page-header">
        <div>
          <h1>
            <span style={{ marginRight: 10 }}>{project.icon || '◆'}</span>
            {project.name}
          </h1>
          {project.description ? <p>{project.description}</p> : null}
        </div>
        <div className="track-form-actions">
          <Link href={`/${locale}/app/track/projects/${id}/issues/new`} className="btn btn-solid">
            {t('project.newIssue')}
          </Link>
        </div>
      </div>

      <div className="track-toolbar">
        <div className="track-tabs">
          <span className="track-tab active">{t('project.issues')}</span>
          <span className="track-tab">{t('project.cycles')} ({cycles.length})</span>
        </div>
      </div>

      <IssuesTable
        issues={issues}
        locale={locale}
        labels={{
          identifier: t('issues.identifier'),
          title: t('issues.title'),
          status: t('issues.status'),
          priority: t('issues.priority'),
          assignee: t('issues.assignee'),
          cycle: t('issues.cycle'),
          created: t('issues.created'),
          noAssignee: t('issues.noAssignee'),
          empty: t('project.noIssues'),
        }}
      />

      {cycles.length > 0 && (
        <section className="panel" style={{ marginTop: 32 }}>
          <p className="section-label">{t('project.cycles')}</p>
          <ul className="recent-list">
            {cycles.map((c) => (
              <li key={c.id}>
                <div className="recent-row">
                  <span className="recent-name">{c.name}</span>
                  <span className="mono recent-date">
                    {c.start_at.slice(0, 10)} → {c.end_at.slice(0, 10)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
