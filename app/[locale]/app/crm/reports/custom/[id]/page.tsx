import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getCustomReport } from '@/lib/crm-custom-reports';
import ReportBuilderPage from '@/components/crm/ReportBuilderPage';

export const dynamic = 'force-dynamic';

export default async function CustomReportPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const report = await getCustomReport(user.id, id);
  if (!report) notFound();
  return <ReportBuilderPage key={report.id} user={user} locale={locale} report={{ id: report.id, name: report.name, config: report.config }} />;
}
