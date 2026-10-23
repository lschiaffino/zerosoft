import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { Link } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import NotionImportPanel from '@/components/docs/NotionImportPanel';

export const dynamic = 'force-dynamic';

/** Docs › Importar desde Notion. */
export default async function DocsImportPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'docs' });
  return (
    <div className="ui-page ui-page-narrow">
      <p>
        <Link href="/app/docs" className="docs-inline-link">
          {t('notionImport.back')}
        </Link>
      </p>
      <PageHeader title={t('notionImport.title')} description={t('notionImport.lead')} />
      <NotionImportPanel blobUpload={Boolean(process.env.BLOB_READ_WRITE_TOKEN)} />
    </div>
  );
}
