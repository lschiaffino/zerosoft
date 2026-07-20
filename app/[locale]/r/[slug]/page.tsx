import { notFound } from 'next/navigation';
import { getRoutingFormBySlug } from '@/lib/calendar-routing';
import PublicRoutingForm from '@/components/calendar/PublicRoutingForm';
import '@/styles/calendar.css';

export const dynamic = 'force-dynamic';

export default async function RoutingFormPage({
  params: { slug, locale },
}: {
  params: { slug: string; locale: string };
}) {
  const form = await getRoutingFormBySlug(slug);
  if (!form) notFound();

  return (
    <PublicRoutingForm
      locale={locale}
      form={{
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
  );
}
