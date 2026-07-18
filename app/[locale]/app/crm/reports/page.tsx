import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getCrmReports, listPipelinesWithStages } from '@/lib/crm';
import ReportsView from '@/components/crm/ReportsView';
import { forecastForPipeline, funnelForPipeline } from './data';

export const dynamic = 'force-dynamic';

export default async function CrmReportsPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: { pipeline?: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

  const reports = await getCrmReports(user.id);
  const pipelines = await listPipelinesWithStages(user.id);

  // Pipeline seleccionado: el del query param si existe; si no, el default
  // (position ASC, mismo criterio que lib/crm). El funnel/forecast de
  // getCrmReports ya vienen del default; para otro pipeline se recomputan.
  const defaultId = pipelines[0]?.id ?? null;
  const selectedId = pipelines.some((p) => p.id === searchParams.pipeline)
    ? (searchParams.pipeline as string)
    : defaultId;

  const funnel =
    selectedId && selectedId !== defaultId
      ? await funnelForPipeline(user.id, selectedId)
      : reports.funnel;
  const forecastByStage =
    selectedId && selectedId !== defaultId
      ? await forecastForPipeline(user.id, selectedId)
      : reports.forecastByStage;

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('reports.title')}</h1>
      </div>
      <ReportsView
        reports={reports}
        funnel={funnel}
        forecastByStage={forecastByStage}
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
        selectedPipelineId={selectedId}
        locale={locale}
      />
    </div>
  );
}
