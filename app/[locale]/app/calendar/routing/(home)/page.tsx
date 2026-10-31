import { requireUser } from '@/lib/session';
import { getRoutingForm, listRoutingForms } from '@/lib/calendar-routing';
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
  // Cuántas preguntas y reglas tiene cada uno: así se ve cuál está a medio armar.
  const full = await Promise.all(forms.map((f) => getRoutingForm(user.id, f.id)));

  return (
    <RoutingFormsView
      handle={user.handle ?? ''}
      items={forms.map((f, i) => ({
        id: f.id,
        title: f.title,
        slug: f.slug,
        active: f.active === 1,
        questions: full[i]?.fields.length ?? 0,
        rules: full[i]?.rules.length ?? 0,
      }))}
      openNew={searchParams.new === '1'}
    />
  );
}
