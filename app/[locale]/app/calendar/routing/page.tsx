import { requireUser } from '@/lib/session';
import { listRoutingForms } from '@/lib/calendar-routing';
import RoutingFormsView from '@/components/calendar/RoutingFormsView';

export const dynamic = 'force-dynamic';

export default async function RoutingFormsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  const searchParams = await props.searchParams;

  const user = await requireUser(locale);
  const forms = await listRoutingForms(user.id);

  return (
    <div className="app-page cal-page">
      <RoutingFormsView
        items={forms.map((f) => ({ id: f.id, title: f.title, slug: f.slug, active: f.active === 1 }))}
        openNew={searchParams.new === '1'}
      />
    </div>
  );
}
