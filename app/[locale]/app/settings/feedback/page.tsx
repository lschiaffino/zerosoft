import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { FEEDBACK_STATUSES, isAdminEmail, listFeedback, type FeedbackStatus } from '@/lib/feedback';
import FeedbackAdminList from '@/components/app/FeedbackAdminList';
import '@/styles/feedback.css';

export const dynamic = 'force-dynamic';

/** Feedback recibido. Solo ADMIN_EMAILS; para el resto (o sin la env) es un 404. */
export default async function FeedbackAdminPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await props.params;
  const { status } = await props.searchParams;
  const user = await requireUser(locale);
  if (!isAdminEmail(user.actingUser?.email ?? user.email)) notFound();

  const t = await getTranslations({ locale, namespace: 'feedback.admin' });
  const tr = await getTranslations({ locale, namespace: 'roadmap.admin' });
  const filter = FEEDBACK_STATUSES.includes(status as FeedbackStatus) ? (status as FeedbackStatus) : undefined;
  const rows = await listFeedback({ status: filter });

  return (
    <div className="app-page">
      <div>
        <h1 className="app-title">{t('title')}</h1>
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>{t('sub')}</p>
      </div>

      <nav className="fb-admin-filters" aria-label={t('title')}>
        <Link href="/app/settings/feedback" className={`btn btn-small ${filter ? 'btn-ghost' : 'btn-solid'}`}>
          {t('all')}
        </Link>
        {FEEDBACK_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/app/settings/feedback?status=${s}`}
            className={`btn btn-small ${filter === s ? 'btn-solid' : 'btn-ghost'}`}
          >
            {t(`status.${s}`)}
          </Link>
        ))}
        <Link href="/app/settings/roadmap" className="btn btn-small btn-ghost fb-admin-roadmap">
          {tr('feedbackLink')} →
        </Link>
      </nav>

      {rows.length === 0 ? (
        <p className="muted mono">{t('empty')}</p>
      ) : (
        <FeedbackAdminList initial={rows} locale={locale} />
      )}
    </div>
  );
}
