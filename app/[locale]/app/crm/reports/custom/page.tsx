import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listCustomReports } from '@/lib/crm-custom-reports';
import CustomReportsList from '@/components/crm/CustomReportsList';
import ReportsSubnav from '@/components/crm/ReportsSubnav';

export const dynamic = 'force-dynamic';

export default async function CustomReportsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'crm' });
  const reports = await listCustomReports(user.id);
  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('reports.title')}</h1>
      </div>
      <ReportsSubnav locale={locale} active="custom" />
      <CustomReportsList
        locale={locale}
        reports={reports.map((r) => ({ id: r.id, name: r.name, source: r.config.source, viz: r.config.viz, updatedAt: r.updated_at }))}
      />
    </div>
  );
}
