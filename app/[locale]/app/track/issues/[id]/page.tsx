import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { formatDate } from '@/lib/utils';
import { getIssue, listIssueComments, listProjectMembers, listCycles, listStatuses } from '@/lib/track-data';
import StatusBadge from '@/components/track/StatusBadge';
import IssuePropertiesPanel from '@/components/track/IssuePropertiesPanel';

export const dynamic = 'force-dynamic';

export default async function IssueDetailPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  const user = await requireUser(locale);
  const issue = await getIssue(id);
  if (!issue) notFound();

  const project = issue.project_id;
  const [comments, statuses, cycles, members] = await Promise.all([
    listIssueComments(id),
    listStatuses(project),
    listCycles(project),
    listProjectMembers(project, user.id),
  ]);

  const t = await getTranslations({ locale, namespace: 'track' });

  let descriptionText = '';
  try {
    const parsed = JSON.parse(issue.description);
    if (Array.isArray(parsed)) {
      descriptionText = parsed.map((b: { text?: string }) => b.text ?? '').join('\n');
    }
  } catch {
    descriptionText = issue.description;
  }

  let issueLabels: Array<{ id: string; name: string; color: string }> = [];
  try {
    const parsed = JSON.parse(issue.labels);
    if (Array.isArray(parsed)) issueLabels = parsed;
  } catch {
    issueLabels = [];
  }

  return (
    <div className="app-page track-detail">
      <div className="track-detail-head">
        <div className="track-detail-meta">
          <Link href={`/${locale}/app/track/projects/${issue.project_id}`}>
            ← {t('issues.back')}
          </Link>
        </div>
        <h1>
          <span className="track-identifier">{issue.identifier}</span>{' '}
          {issue.title || t('issues.title')}
        </h1>
        <div className="track-detail-meta">
          <StatusBadge name={issue.status_name} color={issue.status_color} />
          <span>{t(`priorities.${issue.priority}`)}</span>
          <span>{formatDate(issue.created_at, locale)}</span>
        </div>
      </div>

      <div className="track-detail-grid">
        <div className="track-detail-main">
          {descriptionText ? (
            <section className="panel">
              <p className="section-label">{t('issues.form.description')}</p>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>
                {descriptionText}
              </div>
            </section>
          ) : null}

          <section className="panel">
            <p className="section-label">{t('issues.detail.comments')}</p>
            {comments.length === 0 ? (
              <p className="muted">{t('issues.detail.noComments')}</p>
            ) : (
              <div className="track-comments">
                {comments.map((c) => (
                  <div key={c.id} className="track-comment">
                    <div className="track-comment-head">
                      <span className="track-comment-author">
                        {c.user_name ?? c.user_email}
                      </span>
                      <span className="track-comment-date">
                        {formatDate(c.created_at, locale)}
                      </span>
                    </div>
                    <p className="track-comment-body">{c.body}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="track-detail-side">
          <section className="panel">
            <p className="section-label">{t('issues.detail.properties')}</p>
            <IssuePropertiesPanel
              issue={issue}
              statuses={statuses}
              cycles={cycles}
              members={members}
              locale={locale}
              labels={{
                status: t('issues.status'),
                priority: t('issues.priority'),
                assignee: t('issues.assignee'),
                cycle: t('issues.cycle'),
                estimate: t('issues.estimate'),
                dueDate: t('issues.dueDate'),
                labels: t('issues.labels'),
                noAssignee: t('issues.noAssignee'),
                none: '—',
              }}
              priorities={[
                { value: 'urgent', label: t('priorities.urgent') },
                { value: 'high', label: t('priorities.high') },
                { value: 'medium', label: t('priorities.medium') },
                { value: 'low', label: t('priorities.low') },
              ]}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}
