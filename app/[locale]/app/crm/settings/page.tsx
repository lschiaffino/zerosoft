import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listCustomFields, listPipelinesWithStages } from '@/lib/crm';
import { getIntegration } from '@/lib/integrations';
import PipelinesEditor from '@/components/crm/PipelinesEditor';
import CustomFieldsPanel from '@/components/crm/CustomFieldsPanel';
import ImportPanel from '@/components/crm/ImportPanel';
import ExportPanel from '@/components/crm/ExportPanel';
import GmailPanel from '@/components/crm/GmailPanel';

export const dynamic = 'force-dynamic';

export default async function CrmSettingsPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: { gmail?: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const pipelines = await listPipelinesWithStages(user.id);
  const customFields = await listCustomFields(user.id);
  const gmail = await getIntegration(user.id, 'gmail');

  const gmailLastSync = gmail?.last_sync_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(`${gmail.last_sync_at.replace(' ', 'T')}Z`),
      )
    : null;

  return (
    <div className="app-page">
      <h1 className="app-title">{t('settings.title')}</h1>

      <section className="panel">
        <p className="section-label">{t('settings.integrations')}</p>
        <p className="muted panel-desc">{t('settings.gmailDesc')}</p>
        <GmailPanel
          connected={gmail !== null}
          email={gmail?.email ?? ''}
          lastSync={gmailLastSync}
          notice={searchParams.gmail ?? null}
        />
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.pipelines')}</p>
        <p className="muted panel-desc">{t('settings.pipelinesDesc')}</p>
        <PipelinesEditor initialPipelines={pipelines} />
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.customFields')}</p>
        <p className="muted panel-desc">{t('settings.customFieldsDesc')}</p>
        <CustomFieldsPanel initialFields={customFields} />
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.importCta')}</p>
        <ImportPanel />
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.exportCta')}</p>
        <ExportPanel locale={locale} />
      </section>
    </div>
  );
}
