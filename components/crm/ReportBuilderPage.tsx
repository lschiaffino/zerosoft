import { getTranslations } from 'next-intl/server';
import type { SessionUser } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listPipelinesWithStages } from '@/lib/crm';
import { listDashboards, listReportOwners } from '@/lib/crm-dashboards';
import { builderCustomFields } from '@/lib/crm-custom-reports';
import { getCrmSettings } from '@/lib/crm-currency';
import type { ReportConfig } from '@/lib/crm-report-builder';
import { Link } from '@/i18n/navigation';
import ReportBuilder from './ReportBuilder';
import ReportsSubnav from './ReportsSubnav';

/** Server: carga lo que el constructor necesita (campos propios, dashboards, personas, pipelines). */
export default async function ReportBuilderPage({
  user,
  locale,
  report,
}: {
  user: SessionUser;
  locale: string;
  report: { id: string; name: string; config: ReportConfig } | null;
}) {
  const t = await getTranslations({ locale, namespace: 'crm' });
  const scope = await sessionScope(user);
  const [customFields, dashboards, owners, pipelines, settings] = await Promise.all([
    builderCustomFields(user.id),
    listDashboards(user.id),
    listReportOwners(user, scope),
    listPipelinesWithStages(user.id),
    getCrmSettings(user.id),
  ]);
  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{report ? report.name : t('reportBuilder.newReport')}</h1>
      </div>
      <ReportsSubnav locale={locale} active="custom" />
      <p className="rb-back">
        <Link href="/app/crm/reports/custom" className="muted">
          {t('reportBuilder.back')}
        </Link>
      </p>
      <ReportBuilder
        report={report}
        customFields={customFields}
        dashboards={dashboards.map((d) => ({ id: d.id, name: d.name }))}
        people={owners.map((o) => ({ id: o.id, name: o.name || o.email }))}
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })) }))}
        locale={locale}
        baseCurrency={settings.baseCurrency}
      />
    </div>
  );
}
