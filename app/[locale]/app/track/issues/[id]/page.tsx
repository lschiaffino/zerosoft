import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { formatDate } from '@/lib/utils';
import { getIssue, listIssueComments } from '@/lib/track-data';
import StatusBadge from '@/components/track/StatusBadge';

export const dynamic = 'force-dynamic';

export default async function IssueDetailPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  const user = await requireUser(locale);
  const issue = await getIssue(id);
  if (!issue) notFound();

  const t = await getTranslations({ locale, namespace: 'track' });
  const comments = await listIssueComments(id);

  let descriptionText = '';
  try {
    const parsed = JSON.parse(issue.description);
    if (Array.isArray(parsed)) {
      descriptionText = parsed.map((b: { text?: string }) => b.text ?? '').join('\n');
    }
  } catch {
    descriptionText = issue.description;
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
            <div className="track-properties">
              <div className="track-property">
                <label>{t('issues.assignee')}</label>
                <span>{issue.assignee_name ?? issue.assignee_email ?? t('issues.noAssignee')}</span>
              </div>
              <div className="track-property">
                <label>{t('issues.cycle')}</label>
                <span>{issue.cycle_name ?? '—'}</span>
              </div>
              <div className="track-property">
                <label>{t('issues.estimate')}</label>
                <span>{issue.estimate ?? '—'}</span>
              </div>
              <div className="track-property">
                <label>{t('issues.status')}</label>
                <span>{issue.status_name ?? '—'}</span>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
