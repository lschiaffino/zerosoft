import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listCustomFields, listPipelinesWithStages } from '@/lib/crm';
import PipelinesEditor from '@/components/crm/PipelinesEditor';
import CustomFieldsPanel from '@/components/crm/CustomFieldsPanel';
import ImportPanel from '@/components/crm/ImportPanel';
import ExportPanel from '@/components/crm/ExportPanel';

export const dynamic = 'force-dynamic';

export default async function CrmSettingsPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const pipelines = listPipelinesWithStages(user.id);
  const customFields = listCustomFields(user.id);

  return (
    <div className="app-page">
      <h1 className="app-title">{t('settings.title')}</h1>

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
