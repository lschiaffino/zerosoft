import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getCrmReports, listPipelinesWithStages, PRIORITIES, SOURCES } from '@/lib/crm';
import { listMembers } from '@/lib/teams';
import {
  defaultBucket,
  reportByOwner,
  reportKpis,
  reportRange,
  reportTimeseries,
  type ReportBucket,
  type ReportFilters,
  type ReportRangeLabel,
} from '@/lib/crm-reports';
import ReportsView from '@/components/crm/ReportsView';
import { forecastForPipeline, funnelForPipeline } from './data';

export const dynamic = 'force-dynamic';

const RANGE_LABELS: ReportRangeLabel[] = ['7d', '30d', '90d', 'quarter', '12m'];
const BUCKETS: ReportBucket[] = ['day', 'week', 'month', 'quarter'];

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export default async function CrmReportsPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });

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
  };

  const reports = await getCrmReports(user.id);
  const pipelines = await listPipelinesWithStages(user.id);

  const defaultId = pipelines[0]?.id ?? null;
  const selectedPipelineId = pipelines.some((p) => p.id === filters.pipelineId)
    ? filters.pipelineId!
    : defaultId;

  const funnel =
    selectedPipelineId && selectedPipelineId !== defaultId
      ? await funnelForPipeline(user.id, selectedPipelineId)
      : reports.funnel;
  const forecastByStage =
    selectedPipelineId && selectedPipelineId !== defaultId
      ? await forecastForPipeline(user.id, selectedPipelineId)
      : reports.forecastByStage;

  const teamMembers = user.team?.id
    ? await listMembers(user.team.id)
    : [{ user_id: user.id, email: user.email, name: user.name ?? null, role: 'owner', created_at: '' }];
  const owners = teamMembers.map((m) => ({ id: m.user_id, email: m.email, name: m.name }));

  const [kpis, timeseries, byOwner] = await Promise.all([
    reportKpis(user.id, range, filters),
    reportTimeseries(user.id, range, bucket, filters),
    reportByOwner(user.id, range, filters, owners),
  ]);

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
        selectedPipelineId={selectedPipelineId}
        locale={locale}
        range={rangeLabel}
        bucket={bucket}
        filters={filters}
        kpis={kpis}
        timeseries={timeseries}
        byOwner={byOwner}
        owners={owners}
        sources={SOURCES.map((v) => ({ value: v, label: t(`enums.source.${v}`) }))}
        priorities={PRIORITIES.map((v) => ({ value: v, label: t(`enums.priority.${v}`) }))}
      />
    </div>
  );
}
