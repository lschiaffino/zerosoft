import { redirect } from 'next/navigation';

/** Compatibilidad: la creación es un modal rápido sobre la lista de routing forms. */
export default async function NewRoutingFormPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  redirect(`/${locale}/app/calendar/routing?new=1`);
}
