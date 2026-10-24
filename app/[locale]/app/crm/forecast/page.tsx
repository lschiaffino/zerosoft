import { getTranslations } from 'next-intl/server';
import { isWorkspaceAdmin, realUserId, requireUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listPipelinesWithStages } from '@/lib/crm';
import { listReportOwners } from '@/lib/crm-dashboards';
import { getForecast } from '@/lib/crm-forecast';
import { getCrmSettings } from '@/lib/crm-currency';
import ForecastView from '@/components/crm/ForecastView';
import ReportsSubnav from '@/components/crm/ReportsSubnav';

export const dynamic = 'force-dynamic';

export default async function CrmForecastPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const scope = await sessionScope(user);
  const owners = await listReportOwners(user, scope);
  const people = owners.map((o) => ({ id: o.id, name: o.name || o.email }));
  const [initial, pipelines, settings] = await Promise.all([
    getForecast(user.id, { period: 'month', people, scope }),
    listPipelinesWithStages(user.id),
    getCrmSettings(user.id),
  ]);
  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('forecast.title')}</h1>
      </div>
      <ReportsSubnav locale={locale} active="forecast" />
      <ForecastView
        initial={initial}
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
        me={realUserId(user)}
        isAdmin={isWorkspaceAdmin(user)}
        locale={locale}
        baseCurrency={settings.baseCurrency}
      />
    </div>
  );
}
