import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { isAdminEmail } from '@/lib/feedback';
import { listChangelogRows } from '@/lib/changelog';
import { listRoadmapItemsAdmin } from '@/lib/roadmap';
import ChangelogAdmin from '@/components/app/ChangelogAdmin';
import AdminNav from '@/components/app/AdminNav';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'settings' });
  return { title: `${t('admin.changelog')} · ${t('title')}` };
}

/** Changelog publicado desde la app (sin deploy). Solo ADMIN_EMAILS; para el resto es un 404. */
export default async function ChangelogAdminPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  if (!isAdminEmail(user.actingUser?.email ?? user.email)) notFound();
  const t = await getTranslations({ locale, namespace: 'changelog.admin' });
  const ts = await getTranslations({ locale, namespace: 'settings.admin' });
  const [rows, items] = await Promise.all([listChangelogRows({ includeDrafts: true }), listRoadmapItemsAdmin()]);

  return (
    <div className="st-stack">
      <AdminNav
        locale={locale}
        current="changelog"
        description={t('sub')}
        aside={
          <Link href="/changelog" className="btn btn-ghost btn-sm">
            {ts('publicChangelog')}
          </Link>
        }
      />
      <ChangelogAdmin
        initial={rows}
        items={items.map((i) => ({ id: i.id, title: i.title, status: i.status, shipped_changelog_id: i.shipped_changelog_id }))}
        locale={locale}
      />
    </div>
  );
}
