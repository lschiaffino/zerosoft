import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { isAdminEmail } from '@/lib/feedback';
import { listChangelogRows } from '@/lib/changelog';
import { listRoadmapItemsAdmin } from '@/lib/roadmap';
import ChangelogAdmin from '@/components/app/ChangelogAdmin';
import '@/styles/roadmap.css';

export const dynamic = 'force-dynamic';

/** Changelog publicado desde la app (sin deploy). Solo ADMIN_EMAILS; para el resto es un 404. */
export default async function ChangelogAdminPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  if (!isAdminEmail(user.actingUser?.email ?? user.email)) notFound();
  const t = await getTranslations({ locale, namespace: 'changelog.admin' });
  const [rows, items] = await Promise.all([listChangelogRows({ includeDrafts: true }), listRoadmapItemsAdmin()]);

  return (
    <div className="app-page">
      <div>
        <h1 className="app-title">{t('title')}</h1>
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>{t('sub')}</p>
      </div>
      <nav className="rm-admin-filters" aria-label={t('title')}>
        <Link href="/app/settings/roadmap" className="btn btn-small btn-ghost">
          ← {t('backToRoadmap')}
        </Link>
        <span className="rm-admin-spacer" />
        <Link href="/changelog" className="btn btn-small btn-ghost">
          {t('viewPublic')}
        </Link>
      </nav>
      <ChangelogAdmin
        initial={rows}
        items={items.map((i) => ({ id: i.id, title: i.title, status: i.status, shipped_changelog_id: i.shipped_changelog_id }))}
        locale={locale}
      />
    </div>
  );
}
