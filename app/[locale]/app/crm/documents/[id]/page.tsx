import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { getDocument, listDocumentLinks } from '@/lib/crm-media';
import PageHeader from '@/components/ui/PageHeader';
import DocumentDetail from '@/components/crm/DocumentDetail';

export const dynamic = 'force-dynamic';

export default async function DocumentPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm.media' });
  const doc = await getDocument(user.id, id);
  if (!doc) notFound();
  const links = await listDocumentLinks(user.id, id);
  const baseUrl = (process.env.NEXTAUTH_URL ?? 'https://zerosoft.ai').replace(/\/$/, '');
  const canManage = isWorkspaceAdmin(user) || !doc.created_by || doc.created_by === realUserId(user);
  return (
    <div className="app-page ui-page">
      <PageHeader back={{ href: '/app/crm/documents', label: t('docsTitle') }} title={doc.name} description={doc.filename} />
      <DocumentDetail doc={{ id: doc.id, name: doc.name, fileUrl: doc.url }} links={links} baseUrl={baseUrl} canManage={canManage} />
    </div>
  );
}
