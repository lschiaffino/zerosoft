import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listAllIssues } from '@/lib/track-data';
import IssuesTable from '@/components/track/IssuesTable';

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
  const { rows: issues } = await listAllIssues(user.team?.id ?? null, user.id, { pageSize: 50 });

  return (
    <div className="app-page track-page">
      <div className="track-page-header">
        <div>
          <h1>{t('issues.pageTitle')}</h1>
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
          dueDate: t('issues.dueDate'),
          labels: t('issues.labels'),
          noAssignee: t('issues.noAssignee'),
          empty: t('issues.empty'),
          hasSubtasks: t('subtasks.hasSubtasks'),
        }}
      />
    </div>
  );
}
