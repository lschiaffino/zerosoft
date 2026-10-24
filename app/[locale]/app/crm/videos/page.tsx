import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { listVideos } from '@/lib/crm-media';
import { directUploadEnabled } from '@/lib/crm-media-http';
import PageHeader from '@/components/ui/PageHeader';
import VideosLibrary from '@/components/crm/VideosLibrary';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

/** Videos 1:1 del CRM: grabados en el navegador o subidos, con página propia y seguimiento. */
export default async function VideosPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm.media' });
  const rows = await listVideos(user.id);
  const admin = isWorkspaceAdmin(user);
  const me = realUserId(user);
  const baseUrl = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  return (
    <div className="app-page ui-page">
      <PageHeader
        title={t('videosTitle')}
        description={t('videosSubtitle')}
        actions={
          <Link href="/app/crm/documents" className="btn btn-ghost">
            {t('docsTitle')}
          </Link>
        }
      />
      <VideosLibrary
        direct={directUploadEnabled()}
        baseUrl={baseUrl}
        initial={rows.map((v) => ({
          id: v.id,
          title: v.title,
          token: v.token,
          contact_id: v.contact_id,
          contact_name: v.contact_name,
          duration_sec: v.duration_sec,
          views: v.views,
          last_viewed_at: v.last_viewed_at,
          canManage: admin || !v.created_by || v.created_by === me,
        }))}
      />
    </div>
  );
}
