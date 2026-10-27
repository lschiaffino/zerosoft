import { getTranslations, setRequestLocale } from 'next-intl/server';
import { realUserId, requireUser } from '@/lib/session';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import NotionImportPanel from '@/components/docs/NotionImportPanel';
import { IMPORT_SOURCES, type ImportSource } from '@/lib/docs-import-sources';
import { listTeamspaces } from '@/lib/docs-access';
import { canCreateDocPage } from '@/lib/docs-guard';

export const dynamic = 'force-dynamic';

/**
 * Docs › Importar: exports de Notion (Markdown y CSV o HTML), espacios de
 * Confluence, Google Docs, Word, Evernote (.enex) y archivos sueltos. El
 * destino es el workspace o un teamspace donde la persona puede crear páginas.
 */
export default async function DocsImportPage(props: { params: Promise<{ locale: string }>; searchParams: Promise<{ from?: string }> }) {
  const { locale } = await props.params;
  const { from } = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'docs' });
  const all = await listTeamspaces(user.id, realUserId(user));
  const teamspaces: Array<{ id: string; name: string }> = [];
  for (const ts of all) {
    if (ts.deleted_at) continue;
    if (await canCreateDocPage(user, { teamspace_id: ts.id })) teamspaces.push({ id: ts.id, name: ts.name });
  }
  const canWorkspace = await canCreateDocPage(user, {});
  const initialSource = (IMPORT_SOURCES as readonly string[]).includes(from ?? '') ? (from as ImportSource) : 'notion';
  return (
    <div className="ui-page ui-page-narrow">
      <p>
        <Link href="/app/docs" className="docs-inline-link">
          {t('notionImport.back')}
        </Link>
      </p>
      <PageHeader title={t('notionImport.title')} description={t('notionImport.lead')} />
      {canWorkspace || teamspaces.length > 0 ? (
        <NotionImportPanel
          blobUpload={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
          teamspaces={teamspaces}
          canWorkspace={canWorkspace}
          initialSource={initialSource}
        />
      ) : (
        <p className="ximp-note" data-tone="warn" role="status">
          {t('notionImport.noDestination')}
        </p>
      )}
    </div>
  );
}
