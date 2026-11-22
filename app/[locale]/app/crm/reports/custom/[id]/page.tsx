import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getCustomReport, reportForViewer } from '@/lib/crm-custom-reports';
import { sessionFieldViewer } from '@/lib/crm-field-perms';
import ReportBuilderPage from '@/components/crm/ReportBuilderPage';

export const dynamic = 'force-dynamic';

export default async function CustomReportPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const raw = await getCustomReport(user.id, id);
  if (!raw) notFound();
  // Sin los campos que la persona tiene ocultos (ni su nombre ni el valor de un filtro).
  const report = await reportForViewer(sessionFieldViewer(user), raw);
  return <ReportBuilderPage key={report.id} user={user} locale={locale} report={{ id: report.id, name: report.name, config: report.config }} />;
}
