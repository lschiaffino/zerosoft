import { requireUser } from '@/lib/session';
import CustomersPage from '@/components/track/triage/CustomersPage';

export const dynamic = 'force-dynamic';

/** Track › Clientes: quién pidió qué (pedidos de clientes enlazados a issues), como Customers de Linear. */
export default async function TrackCustomersPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <div className="app-page track-page">
      <CustomersPage locale={locale} />
    </div>
  );
}
