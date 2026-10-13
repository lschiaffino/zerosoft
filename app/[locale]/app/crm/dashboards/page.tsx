import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listPipelinesWithStages } from '@/lib/crm';
import {
  addWidget,
  createDashboard,
  getWidgetData,
  listDashboardsWithWidgets,
  listReportOwners,
} from '@/lib/crm-dashboards';
import {
  DASHBOARD_WIDGET_TYPES,
  type DashboardInitialData,
  type DashboardWidgetConfig,
  type DashboardWidgetType,
} from '@/lib/crm-dashboards-schema';
import DashboardsView from '@/components/crm/DashboardsView';
import { getCrmSettings, missingRates } from '@/lib/crm-currency';

export const dynamic = 'force-dynamic';

/** Seed del primer dashboard: KPIs arriba, funnel/forecast y charts debajo. */
const DEFAULT_WIDGETS: Array<{
  type: DashboardWidgetType;
  config?: DashboardWidgetConfig;
  x: number;
  y: number;
  w: number;
  h: number;
}> = [
  { type: 'kpi', config: { metric: 'newContacts' }, x: 0, y: 0, w: 3, h: 2 },
  { type: 'kpi', config: { metric: 'newDeals' }, x: 3, y: 0, w: 3, h: 2 },
  { type: 'kpi', config: { metric: 'wonAmount' }, x: 6, y: 0, w: 3, h: 2 },
  { type: 'kpi', config: { metric: 'activities' }, x: 9, y: 0, w: 3, h: 2 },
  { type: 'funnel', x: 0, y: 2, w: 6, h: 5 },
  { type: 'forecast', x: 6, y: 2, w: 6, h: 5 },
  { type: 'timeseries', x: 0, y: 7, w: 6, h: 5 },
  { type: 'wonlost', x: 6, y: 7, w: 6, h: 5 },
];

export default async function CrmDashboardsPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const scope = await sessionScope(user);
  const t = await getTranslations({ locale, namespace: 'crm' });

  let dashboards = await listDashboardsWithWidgets(user.id);
  if (dashboards.length === 0) {
    const dash = await createDashboard(user.id, t('dashboards.defaultName'));
    for (let i = 0; i < DEFAULT_WIDGETS.length; i++) {
      await addWidget(user.id, dash.id, { ...DEFAULT_WIDGETS[i], position: i });
    }
    dashboards = await listDashboardsWithWidgets(user.id);
  }

  const pipelines = await listPipelinesWithStages(user.id);
  const owners = await listReportOwners(user, scope);
  const defaultPipelineId = pipelines[0]?.id ?? null;

  // Prefetch del dataset de cada tipo de widget (pipeline default, rango 30d).
  const entries = await Promise.all(
    DASHBOARD_WIDGET_TYPES.map(
      async (type) =>
        [
          type,
          await getWidgetData(
            user.id,
            { type, pipelineId: defaultPipelineId, range: '30d' },
            owners,
            scope,
          ),
        ] as const,
    ),
  );
  const initialData = Object.fromEntries(entries) as unknown as DashboardInitialData;

  const [crmSettings, missing] = await Promise.all([getCrmSettings(user.id), missingRates(user.id)]);

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('dashboards.title')}</h1>
      </div>
      <DashboardsView
        baseCurrency={crmSettings.baseCurrency}
        missingRates={missing}
        dashboards={dashboards}
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
        defaultPipelineId={defaultPipelineId}
        initialData={initialData}
        locale={locale}
      />
    </div>
  );
}
