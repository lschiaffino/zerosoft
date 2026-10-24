import { requireUser } from '@/lib/session';
import ReportBuilderPage from '@/components/crm/ReportBuilderPage';

export const dynamic = 'force-dynamic';

/** Reporte nuevo sin guardar: el primer "Guardar" lo crea. */
export default async function NewCustomReportPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  return <ReportBuilderPage user={user} locale={locale} report={null} />;
}
