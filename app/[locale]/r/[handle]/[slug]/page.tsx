import { notFound } from 'next/navigation';
import { getRoutingFormByHandle } from '@/lib/calendar-routing';
import { getWorkspaceBrand } from '@/lib/calendar';
import { resolveBrand } from '@/components/calendar/cal-utils';
import PublicRoutingForm from '@/components/calendar/PublicRoutingForm';
import PublicPageExtras from '@/components/calendar/PublicPageExtras';
import '@/styles/calendar.css';

export const dynamic = 'force-dynamic';

export default async function RoutingFormPage(props: { params: Promise<{ handle: string; slug: string; locale: string }> }) {
  const { handle, slug, locale } = await props.params;

  const form = await getRoutingFormByHandle(handle, slug);
  if (!form) notFound();
  const brand = resolveBrand(await getWorkspaceBrand(form.user_id));

  return (
    <>
      <PublicPageExtras workspaceId={form.user_id} />
      <PublicRoutingForm
        locale={locale}
        brand={brand}
        form={{
          id: form.id,
          slug: form.slug,
          title: form.title,
          description: form.description,
          fields: form.fields.map((f) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            options: f.type === 'select' ? f.optionsParsed : [],
            required: f.required === 1,
          })),
        }}
      />
    </>
  );
}
