import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listAllIssues, listProjectMetas } from '@/lib/track-data';
import CrossProjectIssues from '@/components/track/CrossProjectIssues';
import { buildTrackUiLabels } from '@/components/track/ui-labels';

export const dynamic = 'force-dynamic';

export default async function IssuesPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'track' });
  const teamId = user.team?.id ?? null;
  const [{ rows: issues }, projects] = await Promise.all([
    listAllIssues(teamId, user.id, { pageSize: 50 }),
    listProjectMetas(teamId, user.id),
  ]);

  return (
    <div className="app-page track-page">
      <CrossProjectIssues
        initialIssues={issues}
        projects={projects}
        locale={locale}
        title={t('issues.pageTitle')}
        newIssueLabel={t('project.newIssue')}
        ui={buildTrackUiLabels(t)}
        labels={{
          identifier: t('issues.identifier'),
          title: t('issues.title'),
          status: t('issues.status'),
          priority: t('issues.priority'),
          assignee: t('issues.assignee'),
          cycle: t('issues.cycle'),
          created: t('issues.created'),
          dueDate: t('issues.dueDate'),
          labels: t('issues.labels'),
          noAssignee: t('issues.noAssignee'),
          empty: t('issues.empty'),
          hasSubtasks: t('subtasks.hasSubtasks'),
          project: t('quick.project'),
        }}
      />
    </div>
  );
}
