import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { listDocuments } from '@/lib/crm-media';
import { directUploadEnabled } from '@/lib/crm-media-http';
import PageHeader from '@/components/ui/PageHeader';
import DocumentsLibrary from '@/components/crm/DocumentsLibrary';
import { Link } from '@/i18n/navigation';

export const dynamic = 'force-dynamic';

/** Biblioteca de documentos del CRM: PDFs con links de seguimiento por contacto. */
export default async function DocumentsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm.media' });
  const rows = await listDocuments(user.id);
  const admin = isWorkspaceAdmin(user);
  const me = realUserId(user);
  return (
    <div className="app-page ui-page">
      <PageHeader
        title={t('docsTitle')}
        description={t('docsSubtitle')}
        actions={
          <Link href="/app/crm/videos" className="btn btn-ghost">
            {t('videosTitle')}
          </Link>
        }
      />
      <DocumentsLibrary
        direct={directUploadEnabled()}
        initial={rows.map((r) => ({
          id: r.id,
          name: r.name,
          filename: r.filename,
          size: r.size,
          links: Number(r.links),
          views: Number(r.views),
          last_viewed_at: r.last_viewed_at,
          updated_at: r.updated_at,
          canManage: admin || !r.created_by || r.created_by === me,
        }))}
      />
    </div>
  );
}
