import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { quotaProgress } from '@/lib/crm-quotas';
import QuotaProgressList from '@/components/crm/QuotaProgressList';
import { getCrmReports, listPipelinesWithStages, PRIORITIES, SOURCES } from '@/lib/crm';
import { listMembers } from '@/lib/teams';
import {
  defaultBucket,
  reportActivityLeaderboard,
  reportByOwner,
  reportConversionRate,
  reportFunnel,
  funnelConversion,
  reportForecast,
  reportKpis,
  reportOwnerPerformance,
  reportRange,
  reportSourcePerformance,
  reportTimeseries,
  type FunnelReportStage,
  type ForecastReportStage,
  type ReportBucket,
  type ReportFilters,
  type ReportRangeLabel,
} from '@/lib/crm-reports';
import ReportsView from '@/components/crm/ReportsView';
import { getCrmSettings, missingRates } from '@/lib/crm-currency';

export const dynamic = 'force-dynamic';

const RANGE_LABELS: ReportRangeLabel[] = ['7d', '30d', '90d', 'quarter', '12m'];
const BUCKETS: ReportBucket[] = ['day', 'week', 'month', 'quarter'];
const REPORT_TYPES = ['overview', 'funnel', 'forecast', 'source', 'owner', 'activity', 'conversion'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export default async function CrmReportsPage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  // Visibilidad por owner: un member restringido solo ve sus owners visibles.
  const scope = await sessionScope(user);

  const rangeLabel: ReportRangeLabel = RANGE_LABELS.includes(one(searchParams.range) as ReportRangeLabel)
    ? (one(searchParams.range) as ReportRangeLabel)
    : '30d';
  const range = reportRange(rangeLabel);

  const bucketParam = one(searchParams.bucket) as ReportBucket | undefined;
  const bucket = BUCKETS.includes(bucketParam as ReportBucket)
    ? (bucketParam as ReportBucket)
    : defaultBucket(rangeLabel);

  const filters: ReportFilters = {
    pipelineId: one(searchParams.pipeline),
    source: (SOURCES as readonly string[]).includes(one(searchParams.source) ?? '')
      ? one(searchParams.source)
      : undefined,
    priority: (PRIORITIES as readonly string[]).includes(one(searchParams.priority) ?? '')
      ? one(searchParams.priority)
      : undefined,
    ownerId: one(searchParams.owner),
    ownerIds: scope ?? undefined,
  };

  const reportType: ReportType = REPORT_TYPES.includes(one(searchParams.report) as ReportType)
    ? (one(searchParams.report) as ReportType)
    : 'overview';

  const reports = await getCrmReports(user.id, scope);
  const pipelines = await listPipelinesWithStages(user.id);

  const defaultId = pipelines[0]?.id ?? null;
  const selectedPipelineId = pipelines.some((p) => p.id === filters.pipelineId)
    ? filters.pipelineId!
    : defaultId;

  const funnel: FunnelReportStage[] =
    selectedPipelineId && selectedPipelineId !== defaultId
      ? await reportFunnel(user.id, selectedPipelineId, scope ?? undefined)
      : funnelConversion(reports.funnel);

  const forecastByStage: ForecastReportStage[] =
    selectedPipelineId && selectedPipelineId !== defaultId
      ? await reportForecast(user.id, selectedPipelineId, scope ?? undefined)
      : reports.forecastByStage;

  const teamMembers = user.team?.id
    ? await listMembers(user.team.id)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];
  const owners = teamMembers
    .filter((m) => !scope || scope.includes(m.user_id))
    .map((m) => ({ id: m.user_id, email: m.email, name: m.name }));

  const [kpis, timeseries, byOwner] = await Promise.all([
    reportKpis(user.id, range, filters),
    reportTimeseries(user.id, range, bucket, filters),
    reportByOwner(user.id, range, filters, owners),
  ]);

  const [sourcePerformance, ownerPerformance, activityLeaderboard, conversionRate] = await Promise.all([
    reportSourcePerformance(user.id, range, filters),
    reportOwnerPerformance(user.id, range, filters, owners),
    reportActivityLeaderboard(user.id, range, owners),
    reportConversionRate(user.id, range, filters),
  ]);

  const [crmSettings, missing] = await Promise.all([getCrmSettings(user.id), missingRates(user.id)]);
  const quotas = await quotaProgress(user.id, {
    ownerIds: scope,
    people: teamMembers.map((m) => ({ id: m.user_id, name: m.name || m.email })),
  });

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('reports.title')}</h1>
      </div>
      <ReportsView
        baseCurrency={crmSettings.baseCurrency}
        missingRates={missing}
        reports={reports}
        funnel={funnel}
        forecastByStage={forecastByStage}
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
        selectedPipelineId={selectedPipelineId}
        locale={locale}
        range={rangeLabel}
        bucket={bucket}
        filters={filters}
        reportType={reportType}
        kpis={kpis}
        timeseries={timeseries}
        byOwner={byOwner}
        owners={owners}
        sources={SOURCES.map((v) => ({ value: v, label: t(`enums.source.${v}`) }))}
        priorities={PRIORITIES.map((v) => ({ value: v, label: t(`enums.priority.${v}`) }))}
        sourcePerformance={sourcePerformance}
        ownerPerformance={ownerPerformance}
        activityLeaderboard={activityLeaderboard}
        conversionRate={conversionRate}
      />
      {quotas.length > 0 && (
        <section className="panel report-quotas" data-testid="report-quotas">
          <p className="section-label">{t('quotas.title')}</p>
          <QuotaProgressList items={quotas} baseCurrency={crmSettings.baseCurrency} locale={locale} />
        </section>
      )}
    </div>
  );
}
