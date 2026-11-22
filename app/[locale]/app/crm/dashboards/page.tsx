import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listPipelinesWithStages } from '@/lib/crm';
import { listSalesTeams } from '@/lib/crm-visibility';
import { listCustomReports } from '@/lib/crm-custom-reports';
import { ensureStarterDashboard, listVisibleDashboards, tilesOf } from '@/lib/crm-dashboards';
import { sessionTileViewer } from '@/lib/crm-dashboards-session';
import { parseDashboardFilters } from '@/lib/crm-dashboard-library';
import DashboardsView from '@/components/crm/DashboardsView';
import { getCrmSettings, missingRates } from '@/lib/crm-currency';

export const dynamic = 'force-dynamic';

/**
 * Dashboards del CRM. Un workspace sin dashboards arranca con "Sales" (12
 * reportes listos). Abre el de ?d=, el default de la persona o el primero, y
 * trae sus tiles ya calculados con lo que la persona ve.
 */
export default async function CrmDashboardsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const { locale } = await props.params;
  const { d } = await props.searchParams;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const tv = await sessionTileViewer(user, locale);

  await ensureStarterDashboard(tv.viewer, t('dashboards.salesName'));
  const [dashboards, pipelines, teams, reports, crmSettings, missing] = await Promise.all([
    listVisibleDashboards(tv.viewer),
    listPipelinesWithStages(user.id),
    listSalesTeams(user.id),
    listCustomReports(user.id),
    getCrmSettings(user.id),
    missingRates(user.id),
  ]);
  const active = dashboards.find((x) => x.id === d) ?? dashboards.find((x) => x.isDefault) ?? dashboards[0] ?? null;
  const initialTiles = active ? await tilesOf(tv, active, parseDashboardFilters(active.filters)) : {};

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('dashboards.title')}</h1>
      </div>
      <DashboardsView
        dashboards={dashboards}
        activeId={active?.id ?? null}
        initialTiles={initialTiles}
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
        owners={tv.owners.map((o) => ({ id: o.id, name: o.name || o.email }))}
        teams={teams.map((x) => ({ id: x.id, name: x.name }))}
        customReports={reports.map((r) => ({ id: r.id, name: r.name }))}
        locale={locale}
        baseCurrency={crmSettings.baseCurrency}
        missingRates={missing}
      />
    </div>
  );
}
